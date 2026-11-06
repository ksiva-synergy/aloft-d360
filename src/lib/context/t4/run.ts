import 'server-only';
import prisma from '@/lib/db';
import type { PlatformContextJob } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { resolveEffectiveScope } from '../job-scope';
import { ensureAutoBootstrapModel } from './model';
import { groupObjectsBySchemaCluster, scanEstateForT4 } from './scan-estate';
import { proposeEntitiesAndJoinsForCluster } from './entity-propose-logic';
import { proposeDimensionsAndMeasures } from './dim-propose-logic';

export interface T4ScanResult {
  clusters_enqueued: number;
  tables_total: number;
  model_id: string;
}

export async function runT4Scan(job: PlatformContextJob, orgId: string): Promise<T4ScanResult> {
  const modelId = await ensureAutoBootstrapModel(orgId);
  const { includePatterns, excludeSchemas } = resolveEffectiveScope(
    (job.scope ?? {}) as Record<string, unknown>,
  );
  const objects = await scanEstateForT4(orgId, job.source_id, { includePatterns, excludeSchemas });
  const clusters = groupObjectsBySchemaCluster(objects);

  const baseScope = (job.scope ?? {}) as Record<string, unknown>;
  await prisma.platformContextJob.update({
    where: { id: job.id },
    data: {
      scope: { ...baseScope, model_id: modelId } as Prisma.InputJsonValue,
    },
  });

  if (clusters.length === 0) {
    return { clusters_enqueued: 0, tables_total: 0, model_id: modelId };
  }

  let childIndex = 0;
  for (const cluster of clusters) {
    await prisma.platformContextJob.create({
      data: {
        org_id: orgId,
        source_id: cluster.sourceId,
        job_kind: 't4_entity_propose',
        trigger: job.trigger,
        status: 'queued',
        parent_job_id: job.id,
        child_index: childIndex++,
        scope: {
          cluster_catalog: cluster.catalog,
          cluster_schema: cluster.schema,
          context_object_ids: cluster.objectIds,
          model_id: modelId,
          ...(includePatterns.length > 0 ? { includePatterns } : {}),
          ...(excludeSchemas.length > 0 ? { excludeSchemas } : {}),
        } as Prisma.InputJsonValue,
      },
    });
  }

  await prisma.platformContextJob.update({
    where: { id: job.id },
    data: { status: 'orchestrating' },
  });

  return {
    clusters_enqueued: clusters.length,
    tables_total: objects.length,
    model_id: modelId,
  };
}

export interface T4EntityProposeResult {
  entities_proposed: number;
  joins_proposed: number;
  dim_jobs_enqueued: number;
}

export async function runT4EntityPropose(
  job: PlatformContextJob,
  orgId: string,
): Promise<T4EntityProposeResult> {
  const scope = (job.scope ?? {}) as Record<string, unknown>;
  const modelId = typeof scope.model_id === 'string' ? scope.model_id : await ensureAutoBootstrapModel(orgId);
  const catalog = typeof scope.cluster_catalog === 'string' ? scope.cluster_catalog : 'unknown';
  const schema = typeof scope.cluster_schema === 'string' ? scope.cluster_schema : 'unknown';
  const objectIds = Array.isArray(scope.context_object_ids)
    ? (scope.context_object_ids as string[]).filter(Boolean)
    : [];

  const { entities_proposed, joins_proposed } = await proposeEntitiesAndJoinsForCluster(
    orgId,
    modelId,
    objectIds,
    catalog,
    schema,
  );

  if (objectIds.length === 0) {
    return { entities_proposed, joins_proposed, dim_jobs_enqueued: 0 };
  }

  let childIndex = 0;
  for (const objectId of objectIds) {
    await prisma.platformContextJob.create({
      data: {
        org_id: orgId,
        source_id: job.source_id,
        job_kind: 't4_dim_propose',
        trigger: job.trigger,
        status: 'queued',
        parent_job_id: job.id,
        child_index: childIndex++,
        scope: {
          context_object_id: objectId,
          model_id: modelId,
        } as Prisma.InputJsonValue,
      },
    });
  }

  await prisma.platformContextJob.update({
    where: { id: job.id },
    data: { status: 'orchestrating' },
  });

  return {
    entities_proposed,
    joins_proposed,
    dim_jobs_enqueued: objectIds.length,
  };
}

export async function runT4DimPropose(
  job: PlatformContextJob,
  orgId: string,
): Promise<{ dimensions_written: number; measures_written: number }> {
  const scope = (job.scope ?? {}) as Record<string, unknown>;
  const contextObjectId =
    typeof scope.context_object_id === 'string' ? scope.context_object_id : '';
  const modelId =
    typeof scope.model_id === 'string' ? scope.model_id : await ensureAutoBootstrapModel(orgId);

  if (!contextObjectId) {
    return { dimensions_written: 0, measures_written: 0 };
  }

  return proposeDimensionsAndMeasures(orgId, modelId, contextObjectId);
}
