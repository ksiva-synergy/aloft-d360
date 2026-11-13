/**
 * Harvest Orchestrator — ECS/Fargate entry point.
 *
 * Usage (local):
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/context/orchestrator.ts [--sweep]
 *
 * --sweep          Enqueue a change_detect job for every active source before the
 *                  main dispatch loop runs.
 * --child-job <id> Run a single specific child job (auto-split mode). The container
 *                  claims only that job, processes it, then calls advanceChildren.
 */

import prisma from '@/lib/db';
import { enqueue, claimNext, claimById, failStale, finalize, advanceChildren } from '@/lib/context/queue';
import { runT0Harvest, runT1Profile } from '@/lib/context/harvest';
import { runT2Enrich } from '@/lib/context/enrich';
import { runEstateInventory } from '@/lib/context/estate';
import { runT3Usage } from '@/lib/context/usage';
import { syncObjectToKnowledge, syncSourceToKnowledge } from '@/lib/context/knowledge-sync';
import { embedSubjects, TITAN_MODEL } from '@/lib/context/embed';
import { DatabricksAdapter } from '@/lib/context/databricks-adapter';
import { resolveDefaultOrgId } from '@/lib/platform/agents';
import type { ContextSource } from '@/lib/context/types';
import type { PlatformContextSource, PlatformContextJob } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { JobKind } from '@/lib/context/queue';
import { runT4Scan, runT4EntityPropose, runT4DimPropose } from './t4-handlers';
import { acquireOrchestratorLock } from '@/lib/memory/lock';
import { launchHarvesterTask } from '@/lib/context/launch-harvester';
import {
  objectMatchesJobScope,
  pathToIncludePattern,
  resolveEffectiveScope,
} from '@/lib/context/job-scope';
import { copyRunnerFlagsToChildScope, readJobScopeRunnerFlags } from '@/lib/context/job-scope-flags';
import { runScheduledEstateHarvest } from '@/lib/context/scheduled-estate-harvest';
import { runPbiInventory } from '@/lib/powerbi/inventory';
import { runPbiDefinitions } from '@/lib/powerbi/definitions';
import { runPbiParse } from '@/lib/powerbi/parse';
import { runPbiCatalogLink } from '@/lib/powerbi/catalog-link';
import { runPbiDomains } from '@/lib/powerbi/domains';
import { runPbiFamilies } from '@/lib/powerbi/families';
import { runPbiOracle } from '@/lib/powerbi/oracle';
import { runPbiTranslate } from '@/lib/powerbi/translate';
import { runPbiParity } from '@/lib/powerbi/parity';
import { runPbiPublish } from '@/lib/powerbi/publish';
import {
  copyPipelineChainMetadata,
  shouldAdvanceChainAfterT3,
} from '@/lib/context/pipeline-chain';

/**
 * Enqueue the next kind in a sequential chain and launch a worker for it.
 * Copies excludeSchemas, includePatterns and the remaining chain tail from the
 * parent job's scope so the new container continues with the same settings.
 *
 * The harvester task role cannot call RunTask (no ECS network env on the task).
 * When that launch fails, the next job id is queued for this same process.
 */
function shouldAdvanceJobChain(status: 'succeeded' | 'failed' | 'partial'): boolean {
  return status === 'succeeded' || status === 'partial';
}

const inlineChainJobIds: string[] = [];

async function advanceChain(
  orgId: string,
  parentScope: Record<string, unknown>,
  sourceId: string,
  parentJobId: string,
) {
  const row = await prisma.platformContextJob.findUnique({
    where: { id: parentJobId },
    select: { scope: true },
  });
  const dbScope = (row?.scope ?? {}) as Record<string, unknown>;
  const mergedScope: Record<string, unknown> = { ...dbScope, ...parentScope };
  if (Array.isArray(dbScope.includePatterns) && (dbScope.includePatterns as string[]).length > 0) {
    mergedScope.includePatterns = dbScope.includePatterns;
  }
  if (Array.isArray(dbScope.excludeSchemas) && (dbScope.excludeSchemas as string[]).length > 0) {
    mergedScope.excludeSchemas = dbScope.excludeSchemas;
  }
  if (dbScope.allowFullSourceLaunch === true) {
    mergedScope.allowFullSourceLaunch = true;
  }

  const chain = Array.isArray(mergedScope.chain) ? (mergedScope.chain as string[]) : [];
  if (chain.length === 0) return;

  const [nextKind, ...remaining] = chain as JobKind[];

  const childScope: Record<string, unknown> = {};
  if (Array.isArray(mergedScope.excludeSchemas) && (mergedScope.excludeSchemas as string[]).length > 0) {
    childScope.excludeSchemas = mergedScope.excludeSchemas;
  }
  if (Array.isArray(mergedScope.includePatterns) && (mergedScope.includePatterns as string[]).length > 0) {
    childScope.includePatterns = mergedScope.includePatterns;
  }
  if (remaining.length > 0) childScope.chain = remaining;
  if (typeof mergedScope.pipeline_run_id === 'string') {
    childScope.pipeline_run_id = mergedScope.pipeline_run_id;
  }
  if (typeof mergedScope.ui_surface === 'string') {
    childScope.ui_surface = mergedScope.ui_surface;
  }
  const childScopeWithFlags = copyRunnerFlagsToChildScope(mergedScope, childScope);

  const scopeOrNull = Object.keys(childScopeWithFlags).length > 0 ? childScopeWithFlags : null;
  const created = await enqueue(nextKind, sourceId, scopeOrNull, 'on_demand', orgId);
  console.log(`[orchestrator] chain: enqueued ${nextKind} id=${created.id} (remaining: ${remaining.join(', ') || 'none'})`);

  const { taskId, error } = await launchHarvesterTask(['--kind', nextKind]);
  console.log(`[orchestrator] chain: launched ${nextKind} task=${taskId ?? 'none'}${error ? ` error=${error}` : ''}`);

  if (taskId) {
    await prisma.$executeRaw`
      UPDATE platform_context_jobs
      SET scope = COALESCE(scope, '{}'::jsonb) || jsonb_build_object('fargate_task_id', ${taskId}::text)
      WHERE id = ${created.id}::uuid
    `;
    return;
  }

  console.error(
    `[orchestrator] chain: no worker for ${nextKind} (${error ?? 'RunTask returned no task'}) — continuing in this process`,
  );
  inlineChainJobIds.push(created.id);
}

/** Run chain follow-ups whose Fargate launch failed, in this process. */
async function drainInlineChain(orgId: string): Promise<void> {
  while (inlineChainJobIds.length > 0) {
    const jobId = inlineChainJobIds.shift();
    if (!jobId) break;
    const job = await claimById(jobId);
    if (!job) {
      console.log(`[orchestrator] chain: inline job ${jobId} already claimed`);
      continue;
    }
    console.log(`[orchestrator] chain: inline job=${job.id} kind=${job.job_kind}`);
    try {
      await dispatchSingleJob(job, orgId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[orchestrator] chain: inline job=${job.id} error:`, msg);
      try { await finalize(job.id, 'failed', {}, msg); } catch { /* best-effort */ }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toContextSource(row: PlatformContextSource): ContextSource {
  return {
    id: row.id,
    org_id: row.org_id,
    connection_kind: row.connection_kind,
    connection_ref: row.connection_ref,
    display_name: row.display_name,
    scope_include: Array.isArray(row.scope_include)
      ? (row.scope_include as string[])
      : null,
    scope_exclude: Array.isArray(row.scope_exclude)
      ? (row.scope_exclude as string[])
      : null,
    harvest_config: null,
    status: row.status,
    last_sweep_at: row.last_sweep_at,
  };
}

// ── Single-job dispatch (used by both full loop and --child-job mode) ─────────

async function dispatchSingleJob(
  job: PlatformContextJob,
  orgId: string,
): Promise<{ status: 'succeeded' | 'failed' | 'partial'; error?: string }> {
  const scope = (job.scope ?? {}) as Record<string, unknown>;
  const pathResolved = resolveEffectiveScope(scope);
  const runnerFlags = readJobScopeRunnerFlags(scope);

  // Extract partition scope injected by auto-split (partition_catalog / partition_schema)
  const partitionCatalog = typeof scope.partition_catalog === 'string' ? scope.partition_catalog : undefined;
  const partitionSchema = typeof scope.partition_schema === 'string' ? scope.partition_schema : undefined;
  const partitionObjects = Array.isArray(scope.partition_objects) ? (scope.partition_objects as string[]) : undefined;

  // Build effective excludeSchemas + includePatterns respecting partition scope.
  // Keep the full "catalog.schema" format as sent by the UI — stripping the catalog
  // prefix here caused cross-catalog bleed (landing_zone.digital_desk → *.digital_desk.*
  // which also silently excluded reporting_layer.digital_desk etc).
  let effectiveExcludeSchemas = pathResolved.excludeSchemas;
  let effectiveIncludePatterns = pathResolved.includePatterns;

  if (partitionCatalog && partitionSchema) {
    if (partitionObjects && partitionObjects.length > 0) {
      // Explicit object list — use glob patterns per object
      effectiveIncludePatterns = partitionObjects.map(n => `${partitionCatalog}.${partitionSchema}.${n}`);
    } else {
      // All objects in schema
      effectiveIncludePatterns = [`${partitionCatalog}.${partitionSchema}.*`];
    }
    effectiveExcludeSchemas = []; // partition replaces exclude logic
    console.log(`[orchestrator] child partition=${partitionCatalog}.${partitionSchema} objects=${partitionObjects?.length ?? 'all'}`);
  }

  switch (job.job_kind) {
    case 'change_detect': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'change_detect missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      const sourceRow = await prisma.platformContextSource.findUniqueOrThrow({ where: { id: job.source_id } });
      const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
        where: { id: sourceRow.connection_ref },
        select: { id: true, workspace_host: true, default_warehouse_id: true },
      });
      const adapter = new DatabricksAdapter(conn);
      const since = sourceRow.last_sweep_at ?? new Date(0);
      const changedRefs = await adapter.detectChanges(toContextSource(sourceRow), since);
      for (const ref of changedRefs) {
        await enqueue(
          't0_structural',
          job.source_id,
          { includePatterns: [pathToIncludePattern(ref.full_path)] },
          'scheduled',
          orgId,
        );
      }
      await finalize(job.id, 'succeeded', { changed_refs: changedRefs.length });
      console.log(`[change_detect] source=${job.source_id} flagged=${changedRefs.length} → t0_structural enqueued`);
      return { status: 'succeeded' };
    }

    case 't0_structural': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 't0_structural missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      const result = await runT0Harvest(job.source_id, {
        excludeSchemas: effectiveExcludeSchemas,
        includePatterns: effectiveIncludePatterns,
        existingJobId: job.id,
        ...(runnerFlags.forceFullScan ? { forceFullScan: true } : {}),
      });
      await finalize(job.id, result.status, {
        objects_swept: result.objectsSwept,
        queries_issued: result.queriesIssued,
      }, result.error);
      console.log(`[t0_structural] source=${job.source_id} objects=${result.objectsSwept} status=${result.status}`);
      if (shouldAdvanceJobChain(result.status) && !job.parent_job_id) {
        await advanceChain(orgId, scope, job.source_id, job.id);
      }
      return { status: result.status, error: result.error };
    }

    case 't1_profile': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 't1_profile missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      const result = await runT1Profile(job.source_id, {
        excludeSchemas: effectiveExcludeSchemas,
        includePatterns: effectiveIncludePatterns,
        existingJobId: job.id,
        ...(runnerFlags.forceReprofile ? { forceReprofile: true } : {}),
        ...(partitionCatalog ? { partitionCatalog } : {}),
        ...(partitionSchema ? { partitionSchema } : {}),
        ...(partitionObjects ? { partitionObjects } : {}),
      });
      await finalize(job.id, result.status, {
        dispatched_to_job: result.jobId,
        objects_profiled: result.objectsSwept,
        queries_issued: result.queriesIssued,
      }, result.error);
      console.log(`[t1_profile] source=${job.source_id} objects=${result.objectsSwept} status=${result.status}`);
      if (shouldAdvanceJobChain(result.status) && !job.parent_job_id) {
        await advanceChain(orgId, scope, job.source_id, job.id);
      }
      return { status: result.status, error: result.error };
    }

    case 't2_semantic': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 't2_semantic missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      const result = await runT2Enrich(job.source_id, job.id, {
        excludeSchemas: effectiveExcludeSchemas,
        includePatterns: effectiveIncludePatterns,
        ...(runnerFlags.forceReEnrich ? { forceReEnrich: true } : {}),
        ...(runnerFlags.allowFullSourceLaunch ? { allowFullSourceLaunch: true } : {}),
        ...(partitionCatalog ? { partitionCatalog } : {}),
        ...(partitionSchema ? { partitionSchema } : {}),
        ...(partitionObjects ? { partitionObjects } : {}),
      });
      console.log(`[t2_semantic] source=${job.source_id} objects=${result.objectsEnriched} columns=${result.columnsEnriched} cost=$${result.costUsd.toFixed(4)} status=${result.status}`);
      if (shouldAdvanceJobChain(result.status) && !job.parent_job_id) {
        await advanceChain(orgId, scope, job.source_id, job.id);
      }
      return { status: result.status };
    }

    case 'estate_inventory': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'estate_inventory missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      const estateResult = await runEstateInventory(job.source_id, orgId, {
        existingJobId: job.id,
        includePatterns: effectiveIncludePatterns,
        excludeSchemas: effectiveExcludeSchemas,
      });
      await finalize(job.id, 'succeeded', estateResult as unknown as Record<string, unknown>);
      console.log(`[estate_inventory] source=${job.source_id} inserted=${estateResult.inserted} updated=${estateResult.updated} removed=${estateResult.removed} catalogs=${estateResult.catalogs} mode=${estateResult.mode}`);
      return { status: 'succeeded' };
    }

    case 'embed': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'embed missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }

      const embedObjectRows = await prisma.platformContextObject.findMany({
        where: {
          source_id: job.source_id,
          org_id: orgId,
          lifecycle: 'active',
          last_t2_at: { not: null },
        },
        select: { id: true, full_path: true, catalog_name: true, schema_name: true },
      });
      const embedScopePatterns = effectiveIncludePatterns;
      const embedObjectIds = embedObjectRows
        .filter(o =>
          objectMatchesJobScope(o.full_path, o.catalog_name, o.schema_name, {
            includePatterns: embedScopePatterns,
            excludeSchemas: effectiveExcludeSchemas,
          }),
        )
        .map((o) => o.id);

      const embedAllColRows = embedObjectIds.length === 0 ? [] : await prisma.platformContextColumn.findMany({
        where: {
          org_id: orgId,
          lifecycle: 'active',
          object: {
            source_id: job.source_id,
            id: { in: embedObjectIds },
          },
        },
        select: { id: true, semantic: true },
      });
      const embedColumnIds = embedAllColRows.filter((c) => c.semantic !== null).map((c) => c.id);

      const embedErrors: string[] = [];
      let embedObjResult = { embedded: 0, skipped: 0, failed: 0 };
      let embedColResult = { embedded: 0, skipped: 0, failed: 0 };

      try {
        embedObjResult = await embedSubjects(orgId, 'object', embedObjectIds);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        embedErrors.push(`objects: ${msg}`);
      }

      try {
        embedColResult = await embedSubjects(orgId, 'column', embedColumnIds);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        embedErrors.push(`columns: ${msg}`);
      }

      const totalEmbedded = embedObjResult.embedded + embedColResult.embedded;
      const embedStatus =
        embedErrors.length === 0 ? 'succeeded' : totalEmbedded > 0 ? 'partial' : 'failed';

      await finalize(
        job.id,
        embedStatus,
        {
          objects_embedded: embedObjResult.embedded,
          columns_embedded: embedColResult.embedded,
          skipped: embedObjResult.skipped + embedColResult.skipped,
          failed: embedObjResult.failed + embedColResult.failed,
          model_id: TITAN_MODEL,
        },
        embedErrors.length > 0 ? embedErrors.join('\n') : undefined,
      );
      console.log(
        `[embed] source=${job.source_id} objects=${embedObjResult.embedded} columns=${embedColResult.embedded}` +
        ` skipped=${embedObjResult.skipped + embedColResult.skipped} failed=${embedObjResult.failed + embedColResult.failed} status=${embedStatus}`,
      );
      if (shouldAdvanceJobChain(embedStatus) && !job.parent_job_id) {
        await advanceChain(orgId, scope, job.source_id, job.id);
      }
      return { status: embedStatus };
    }

    case 't3_usage': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 't3_usage missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      // Pass `since` and `until` from scope if this is a continuation job
      const scopeObj = (job.scope ?? {}) as Record<string, unknown>;
      const since = typeof scopeObj.since === 'string' ? new Date(scopeObj.since) : undefined;
      const until = typeof scopeObj.until === 'string' ? new Date(scopeObj.until) : undefined;
      console.log(`[t3_usage] orchestrator dispatching sourceId=${job.source_id} orgId=${orgId}${since ? ` since=${since.toISOString()}` : ''}${until ? ` until=${until.toISOString()}` : ''}`);
      const t3Opts: { since?: Date; until?: Date; includePatterns?: string[]; excludeSchemas?: string[] } = {};
      if (since) t3Opts.since = since;
      if (until) t3Opts.until = until;
      if (effectiveIncludePatterns.length > 0) t3Opts.includePatterns = effectiveIncludePatterns;
      if (effectiveExcludeSchemas.length > 0) t3Opts.excludeSchemas = effectiveExcludeSchemas;
      const t3Result = await runT3Usage(orgId, job.source_id, Object.keys(t3Opts).length > 0 ? t3Opts : undefined);
      await finalize(job.id, 'succeeded', t3Result as unknown as Record<string, unknown>);
      console.log(`[t3_usage] source=${job.source_id} objects=${t3Result.objectsProcessed} snapshots=${t3Result.snapshotsWritten} narratives=${t3Result.narrativesApplied} window=${t3Result.windowStart}→${t3Result.windowEnd}${t3Result.nextCursor ? ` nextCursor=${t3Result.nextCursor}` : ''}`);

      if (
        shouldAdvanceJobChain('succeeded')
        && !t3Result.nextCursor
        && shouldAdvanceChainAfterT3(t3Result, scopeObj)
      ) {
        await advanceChain(orgId, scope, job.source_id, job.id);
      }

      // Spawn continuation job covering the remaining older slice of the window.
      // First job: since=Jun22 → until=now, stops at Jul2T07:55 (nextCursor)
      // Continuation: since=Jun22 → until=Jul2T07:55 (picks up the older half)
      // Enqueue the DB row AND launch a Fargate task so it runs immediately
      // (plain enqueue() leaves the row queued with no task to claim it).
      if (t3Result.nextCursor) {
        const contScope: Record<string, unknown> = {
          since: t3Result.windowStart,
          until: t3Result.nextCursor,
        };
        if (effectiveIncludePatterns.length > 0) {
          contScope.includePatterns = effectiveIncludePatterns;
        }
        if (effectiveExcludeSchemas.length > 0) {
          contScope.excludeSchemas = effectiveExcludeSchemas;
        }
        copyPipelineChainMetadata(scopeObj, contScope);
        const contScopeWithFlags = copyRunnerFlagsToChildScope(scopeObj, contScope);
        const contJob = await enqueue(
          't3_usage',
          job.source_id,
          contScopeWithFlags,
          'on_demand',
          orgId,
        );
        console.log(`[t3_usage] continuation job enqueued id=${contJob.id} since=${t3Result.windowStart} until=${t3Result.nextCursor}`);

        // Launch a dedicated worker for the continuation job
        try {
          const { taskId: contTaskId, error: launchErr } = await launchHarvesterTask([
            '--kind',
            't3_usage',
          ]);
          if (contTaskId) {
            await prisma.platformContextJob.update({
              where: { id: contJob.id },
              data: {
                scope: {
                  ...contScopeWithFlags,
                  fargate_task_id: contTaskId,
                } as unknown as Prisma.InputJsonValue,
              },
            });
          }
          console.log(`[t3_usage] continuation task launched id=${contJob.id} taskId=${contTaskId ?? 'none'}${launchErr ? ` error=${launchErr}` : ''}`);
        } catch (launchErr) {
          // Non-fatal — the queued row remains and can be launched manually
          console.error(`[t3_usage] continuation task launch failed (job=${contJob.id}): ${launchErr instanceof Error ? launchErr.message : String(launchErr)}`);
        }
      }
      return { status: 'succeeded' };
    }

    case 'knowledge_sync': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'knowledge_sync missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      const contextObjectId =
        typeof scope.context_object_id === 'string' ? scope.context_object_id : undefined;
      if (contextObjectId) {
        const one = await syncObjectToKnowledge(contextObjectId, { includeSamples: true });
        const status = one.error ? 'failed' : one.skipped ? 'succeeded' : 'succeeded';
        await finalize(job.id, status, {
          objects_synced: one.skipped ? 0 : 1,
          chunks_ingested: one.chunksIngested,
          skipped: one.skipped,
        }, one.error);
        return { status, error: one.error };
      }
      const batch = await syncSourceToKnowledge(job.source_id, orgId, {
        includeSamples: true,
        includePatterns: effectiveIncludePatterns,
      });
      const status = batch.errors > 0 && batch.synced === 0 ? 'failed' : batch.errors > 0 ? 'partial' : 'succeeded';
      await finalize(job.id, status, batch as unknown as Record<string, unknown>);
      if (shouldAdvanceJobChain(status) && !job.parent_job_id) {
        await advanceChain(orgId, scope, job.source_id, job.id);
      }
      return { status };
    }

    case 'mapping':
    case 't3_connected': {
      const reason = `${job.job_kind}: not implemented in harvest orchestrator`;
      console.warn(`[orchestrator] ${reason}`);
      await finalize(job.id, 'failed', { objects_processed: 0 }, reason);
      return { status: 'failed', error: reason };
    }

    case 'silo_scan':
    case 'recompute_entity_tags': {
      console.log(`[orchestrator] ${job.job_kind}: not yet implemented in this container — skipping`);
      await finalize(job.id, 'failed', { note: 'not yet implemented in harvester' }, 'not implemented');
      return { status: 'failed', error: 'not implemented' };
    }

    case 't4_scan': {
      const scanStats = await runT4Scan(job, orgId);
      if (scanStats.clusters_enqueued === 0) {
        await finalize(job.id, 'succeeded', scanStats as unknown as Record<string, unknown>);
        console.log(`[t4_scan] no eligible tables — succeeded empty`);
        return { status: 'succeeded' };
      }
      await prisma.platformContextJob.update({
        where: { id: job.id },
        data: { stats: scanStats as unknown as Prisma.InputJsonValue },
      });
      const { launched } = await advanceChildren(job.id, orgId, 't4_entity_propose');
      console.log(
        `[t4_scan] clusters=${scanStats.clusters_enqueued} tables=${scanStats.tables_total} children_launched=${launched}`,
      );
      return { status: 'succeeded' };
    }

    case 't4_entity_propose': {
      const entityStats = await runT4EntityPropose(job, orgId);
      if (entityStats.dim_jobs_enqueued === 0) {
        await finalize(job.id, 'succeeded', entityStats as unknown as Record<string, unknown>);
        return { status: 'succeeded' };
      }
      await prisma.platformContextJob.update({
        where: { id: job.id },
        data: { stats: entityStats as unknown as Record<string, unknown> },
      });
      const { launched } = await advanceChildren(job.id, orgId, 't4_dim_propose');
      console.log(
        `[t4_entity_propose] entities=${entityStats.entities_proposed} dims_queued=${entityStats.dim_jobs_enqueued} launched=${launched}`,
      );
      return { status: 'succeeded' };
    }

    case 't4_dim_propose': {
      const dimStats = await runT4DimPropose(job, orgId);
      await finalize(job.id, 'succeeded', dimStats as unknown as Record<string, unknown>);
      console.log(
        `[t4_dim_propose] object=${(job.scope as Record<string, unknown>)?.context_object_id} dims=${dimStats.dimensions_written} measures=${dimStats.measures_written}`,
      );
      return { status: 'succeeded' };
    }

    case 'pbi_inventory': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'pbi_inventory missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      try {
        const inv = await runPbiInventory(orgId, job.source_id, { runId: job.id });
        await finalize(job.id, 'succeeded', inv as unknown as Record<string, unknown>);
        console.log(
          `[pbi_inventory] source=${job.source_id} workspaces=${inv.workspaces} models=${inv.models} reports=${inv.reports}`,
        );
        return { status: 'succeeded' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await finalize(job.id, 'failed', {}, msg);
        return { status: 'failed', error: msg };
      }
    }

    case 'pbi_definitions': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'pbi_definitions missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      try {
        const scope = (job.scope ?? {}) as Record<string, unknown>;
        const modelIds = Array.isArray(scope.model_ids)
          ? scope.model_ids.filter((x): x is string => typeof x === 'string')
          : undefined;
        const reportIds = Array.isArray(scope.report_ids)
          ? scope.report_ids.filter((x): x is string => typeof x === 'string')
          : undefined;
        const stats = await runPbiDefinitions(orgId, job.source_id, {
          runId: job.id,
          modelIds,
          reportIds,
          fetchModels: scope.fetch_models !== false,
          fetchReports: scope.fetch_reports !== false,
          maxModels: typeof scope.max_models === 'number' ? scope.max_models : undefined,
          maxReports: typeof scope.max_reports === 'number' ? scope.max_reports : undefined,
        });
        await finalize(job.id, 'succeeded', stats as unknown as Record<string, unknown>);
        console.log(
          `[pbi_definitions] models=${stats.models_fetched}/${stats.models_skipped}/${stats.models_failed} reports=${stats.reports_fetched}/${stats.reports_skipped}/${stats.reports_failed} capped=${stats.capped}`,
        );
        return { status: 'succeeded' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await finalize(job.id, 'failed', {}, msg);
        return { status: 'failed', error: msg };
      }
    }

    case 'pbi_parse': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'pbi_parse missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      try {
        const scope = (job.scope ?? {}) as Record<string, unknown>;
        const modelIds = Array.isArray(scope.model_ids)
          ? scope.model_ids.filter((x): x is string => typeof x === 'string')
          : undefined;
        const reportIds = Array.isArray(scope.report_ids)
          ? scope.report_ids.filter((x): x is string => typeof x === 'string')
          : undefined;
        const stats = await runPbiParse(orgId, job.source_id, {
          runId: job.id,
          modelIds,
          reportIds,
          maxModels: typeof scope.max_models === 'number' ? scope.max_models : undefined,
          maxReports: typeof scope.max_reports === 'number' ? scope.max_reports : undefined,
        });
        await finalize(job.id, 'succeeded', stats as unknown as Record<string, unknown>);
        console.log(
          `[pbi_parse] models=${stats.models_parsed}/${stats.models_skipped}/${stats.models_failed} reports=${stats.reports_parsed}/${stats.reports_skipped}/${stats.reports_failed}`,
        );
        return { status: 'succeeded' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await finalize(job.id, 'failed', {}, msg);
        return { status: 'failed', error: msg };
      }
    }

    case 'pbi_catalog_link': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'pbi_catalog_link missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      try {
        const scope = (job.scope ?? {}) as Record<string, unknown>;
        const modelIds = Array.isArray(scope.model_ids)
          ? scope.model_ids.filter((x): x is string => typeof x === 'string')
          : undefined;
        const stats = await runPbiCatalogLink(orgId, job.source_id, { runId: job.id, modelIds });
        await finalize(job.id, 'succeeded', stats as unknown as Record<string, unknown>);
        console.log(
          `[pbi_catalog_link] matched=${stats.matched} unscanned=${stats.unscanned} ambiguous=${stats.ambiguous}`,
        );
        return { status: 'succeeded' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await finalize(job.id, 'failed', {}, msg);
        return { status: 'failed', error: msg };
      }
    }

    case 'pbi_domains': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'pbi_domains missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      try {
        const scope = (job.scope ?? {}) as Record<string, unknown>;
        const modelIds = Array.isArray(scope.model_ids)
          ? scope.model_ids.filter((x): x is string => typeof x === 'string')
          : undefined;
        const stats = await runPbiDomains(orgId, job.source_id, { runId: job.id, modelIds });
        await finalize(job.id, 'succeeded', stats as unknown as Record<string, unknown>);
        console.log(
          `[pbi_domains] models=${stats.models_assigned}/${stats.models_scored} conflicts=${stats.conflicts}`,
        );
        return { status: 'succeeded' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await finalize(job.id, 'failed', {}, msg);
        return { status: 'failed', error: msg };
      }
    }

    case 'pbi_families': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'pbi_families missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      try {
        const scope = (job.scope ?? {}) as Record<string, unknown>;
        const modelIds = Array.isArray(scope.model_ids)
          ? scope.model_ids.filter((x): x is string => typeof x === 'string')
          : undefined;
        const stats = await runPbiFamilies(orgId, job.source_id, { runId: job.id, modelIds });
        await finalize(job.id, 'succeeded', stats as unknown as Record<string, unknown>);
        console.log(
          `[pbi_families] families=${stats.families_upserted} models=${stats.models_linked} cleared=${stats.singletons_cleared}`,
        );
        return { status: 'succeeded' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await finalize(job.id, 'failed', {}, msg);
        return { status: 'failed', error: msg };
      }
    }

    case 'pbi_oracle': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'pbi_oracle missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      try {
        const scope = (job.scope ?? {}) as Record<string, unknown>;
        const modelIds = Array.isArray(scope.model_ids)
          ? scope.model_ids.filter((x): x is string => typeof x === 'string')
          : undefined;
        const maxMeasuresPerModel =
          typeof scope.max_measures_per_model === 'number' ? scope.max_measures_per_model : undefined;
        const stats = await runPbiOracle(orgId, job.source_id, {
          runId: job.id,
          modelIds,
          maxMeasuresPerModel,
          onlyCanonicalFamily: scope.only_canonical_family === true,
          onlyWithTranslation: scope.oracle_only_translated === true,
        });
        await finalize(job.id, 'succeeded', stats as unknown as Record<string, unknown>);
        console.log(
          `[pbi_oracle] mode=${stats.oracle_mode} written=${stats.results_written} failed=${stats.measures_failed} skipped_rls=${stats.models_skipped_rls} run=${stats.measures_run}`,
        );
        return { status: 'succeeded' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await finalize(job.id, 'failed', {}, msg);
        return { status: 'failed', error: msg };
      }
    }

    case 'pbi_translate': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'pbi_translate missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      try {
        const scope = (job.scope ?? {}) as Record<string, unknown>;
        const modelIds = Array.isArray(scope.model_ids)
          ? scope.model_ids.filter((x): x is string => typeof x === 'string')
          : undefined;
        const maxLlmMeasures =
          typeof scope.max_llm_measures === 'number' ? scope.max_llm_measures : undefined;
        const stats = await runPbiTranslate(orgId, job.source_id, {
          runId: job.id,
          modelIds,
          maxLlmMeasures,
          llmEnabled: scope.llm_translate !== false,
          pilot: scope.pilot === true,
        });
        await finalize(job.id, 'succeeded', stats as unknown as Record<string, unknown>);
        console.log(
          `[pbi_translate] rule=${stats.rule_translated} llm=${stats.llm_translated}/${stats.measures_scanned} dax_uc=${stats.uc_via_dax_refs ?? 0} no_bind=${stats.skipped_no_binding} unsupported=${stats.skipped_unsupported_dax} cost_usd=${stats.cost_usd.toFixed(4)}`,
        );
        return { status: 'succeeded' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await finalize(job.id, 'failed', {}, msg);
        return { status: 'failed', error: msg };
      }
    }

    case 'pbi_parity': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'pbi_parity missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      try {
        const scope = (job.scope ?? {}) as Record<string, unknown>;
        const modelIds = Array.isArray(scope.model_ids)
          ? scope.model_ids.filter((x): x is string => typeof x === 'string')
          : undefined;
        const stats = await runPbiParity(orgId, job.source_id, { runId: job.id, modelIds });
        await finalize(job.id, 'succeeded', stats as unknown as Record<string, unknown>);
        console.log(
          `[pbi_parity] pass=${stats.passed} fail=${stats.failed} skip=${stats.skipped} err=${stats.errors}`,
        );
        return { status: 'succeeded' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await finalize(job.id, 'failed', {}, msg);
        return { status: 'failed', error: msg };
      }
    }

    case 'pbi_publish': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'pbi_publish missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      try {
        const scope = (job.scope ?? {}) as Record<string, unknown>;
        const modelIds = Array.isArray(scope.model_ids)
          ? scope.model_ids.filter((x): x is string => typeof x === 'string')
          : undefined;
        const requireApproved = scope.require_approved === true;
        const stats = await runPbiPublish(orgId, job.source_id, {
          runId: job.id,
          modelIds,
          requireApproved,
        });
        await finalize(job.id, 'succeeded', stats as unknown as Record<string, unknown>);
        console.log(
          `[pbi_publish] published=${stats.published} skip=${stats.skipped} demoted=${stats.demoted}`,
        );
        return { status: 'succeeded' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await finalize(job.id, 'failed', {}, msg);
        return { status: 'failed', error: msg };
      }
    }

    default: {
      await finalize(job.id, 'failed', {}, `unknown job_kind: ${String(job.job_kind)}`);
      return { status: 'failed', error: `unknown job_kind: ${String(job.job_kind)}` };
    }
  }
}

// ── Core loop (exported for in-process testing) ───────────────────────────────

export interface OrchestratorResult {
  processed: number;
  t1JobsCreated: number;
}

export async function runOrchestratorLoop(
  orgId: string,
  opts: {
    sweep?: boolean;
    kindFilter?: string;
    childJobId?: string;
    processScheduled?: boolean;
  } = {},
): Promise<OrchestratorResult> {
  // 1. Reap stale running jobs from prior crashed containers
  const reaped = await failStale(30);
  if (reaped > 0) console.log(`[orchestrator] reaped ${reaped} stale job(s)`);

  if (opts.processScheduled && !opts.childJobId) {
    const activeSources = await prisma.platformContextSource.findMany({
      where: { org_id: orgId, status: 'active' },
      select: { id: true },
    });
    for (const src of activeSources) {
      try {
        const r = await runScheduledEstateHarvest({
          orgId,
          sourceId: src.id,
          maxSchemas: 3,
        });
        if (r.schemasStarted > 0) {
          console.log(
            `[orchestrator] process-scheduled source=${src.id} schemas=${r.schemasStarted} pathsQueued=${r.pathsMarkedQueued}`,
          );
        }
      } catch (err) {
        console.warn(
          `[orchestrator] process-scheduled failed source=${src.id}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  // 2. --child-job mode: process exactly one specific child job then advance the split queue
  if (opts.childJobId) {
    const job = await prisma.platformContextJob.findUnique({ where: { id: opts.childJobId } });
    if (!job) {
      console.error(`[orchestrator] child-job=${opts.childJobId} not found`);
      return { processed: 0, t1JobsCreated: 0 };
    }
    if (job.status !== 'queued' && job.status !== 'running') {
      console.log(`[orchestrator] child-job=${opts.childJobId} already ${job.status} — skipping`);
      return { processed: 0, t1JobsCreated: 0 };
    }

    // advanceChildren now marks the row 'running' atomically before launching the
    // Fargate task, so the status may already be 'running' by the time we arrive here.
    // Only write started_at if we're claiming a still-queued row.
    if (job.status === 'queued') {
      await prisma.platformContextJob.update({
        where: { id: job.id },
        data: { status: 'running', started_at: new Date() },
      });
    }

    console.log(`[orchestrator] child-job mode: job=${job.id} kind=${job.job_kind} partition=${(job.scope as any)?.partition_schema ?? 'full'}`);

    try {
      await dispatchSingleJob(job, orgId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[orchestrator] child-job=${job.id} error:`, msg);
      try { await finalize(job.id, 'failed', {}, msg); } catch { /* best-effort */ }
    }

    // Advance the parent's queue: launch next batch of children
    if (job.parent_job_id) {
      const { launched, parentFinalized } = await advanceChildren(
        job.parent_job_id,
        orgId,
        job.job_kind as JobKind,
      );
      console.log(`[orchestrator] advanceChildren parent=${job.parent_job_id} launched=${launched} parentFinalized=${parentFinalized}`);

      // If parent just finalized AND it has a chain, advance chain from parent
      if (parentFinalized) {
        const parent = await prisma.platformContextJob.findUnique({ where: { id: job.parent_job_id } });
        if (parent && shouldAdvanceJobChain(parent.status as 'succeeded' | 'failed' | 'partial') && parent.source_id) {
          const parentScope = (parent.scope ?? {}) as Record<string, unknown>;
          if (Array.isArray(parentScope.chain) && (parentScope.chain as string[]).length > 0) {
            await advanceChain(orgId, parentScope, parent.source_id, parent.id);
          }
        }
      }
    }

    await drainInlineChain(orgId);

    return { processed: 1, t1JobsCreated: job.job_kind === 't1_profile' ? 1 : 0 };
  }

  // 3. --sweep: enqueue change_detect for every active source
  if (opts.sweep) {
    const sources = await prisma.platformContextSource.findMany({
      where: { org_id: orgId, status: 'active' },
      select: { id: true },
    });
    for (const src of sources) {
      await enqueue('change_detect', src.id, null, 'scheduled', orgId);
    }
    console.log(`[orchestrator] enqueued ${sources.length} change_detect job(s) for sweep`);
  }

  // 4. Main dispatch loop (non-split top-level jobs)
  let processed = 0;
  let t1JobsCreated = 0;
  const kindFilter = opts.kindFilter ?? null;

  if (kindFilter) {
    console.log(`[orchestrator] filtering to kind=${kindFilter}`);
  }

  while (true) {
    const job = await claimNext(orgId, kindFilter ?? undefined);
    if (!job) break;

    console.log(`[orchestrator] claimed job=${job.id} kind=${job.job_kind}`);
    processed++;

    try {
      const result = await dispatchSingleJob(job, orgId);
      if (job.job_kind === 't1_profile' && result.status !== 'failed') t1JobsCreated++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[orchestrator] job=${job.id} kind=${job.job_kind} error:`, msg);
      try {
        await finalize(job.id, 'failed', {}, msg);
      } catch { /* best-effort */ }
    }

    await drainInlineChain(orgId);
  }

  console.log(`[orchestrator] done — processed=${processed} t1_profile_dispatched=${t1JobsCreated}`);
  return { processed, t1JobsCreated };
}

/** Run one queued/running job by id (local pilots — avoids spawning a second Node process). */
export async function runQueuedJobById(
  orgId: string,
  jobId: string,
): Promise<{ status: string; error?: string | null }> {
  const job = await prisma.platformContextJob.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new Error(`job not found: ${jobId}`);
  }
  if (job.status === 'queued') {
    await prisma.platformContextJob.update({
      where: { id: job.id },
      data: { status: 'running', started_at: new Date() },
    });
  }
  console.log(`[orchestrator] pilot-job=${job.id} kind=${job.job_kind}`);
  try {
    const result = await dispatchSingleJob(job, orgId);
    return { status: result.status, error: result.error ?? null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await finalize(job.id, 'failed', {}, msg);
    } catch {
      /* best-effort */
    }
    return { status: 'failed', error: msg };
  }
}

// ── CLI entry point ───────────────────────────────────────────────────────────

async function main() {
  const sweep = process.argv.includes('--sweep');
  const processScheduled = process.argv.includes('--process-scheduled');
  const kindIdx = process.argv.indexOf('--kind');
  const kindFilter = kindIdx >= 0 ? process.argv[kindIdx + 1] : undefined;
  const childJobIdx = process.argv.indexOf('--child-job');
  const childJobId = childJobIdx >= 0 ? process.argv[childJobIdx + 1] : undefined;

  const orgId = await resolveDefaultOrgId();

  console.log(`[orchestrator] starting  org=${orgId} sweep=${sweep}${kindFilter ? ` kind=${kindFilter}` : ''}${childJobId ? ` child-job=${childJobId}` : ''}`);

  // Advisory lock for t4_scan: prevents two overlapping coordinator runs from
  // each scanning the estate and creating duplicate child job trees.
  // Other job kinds rely on SELECT FOR UPDATE SKIP LOCKED in claimNext() for
  // per-job deduplication — that is insufficient for t4_scan which is a
  // coordinator that spawns children and must not overlap at the run level.
  if (kindFilter === 't4_scan') {
    const lock = await acquireOrchestratorLock(orgId, 't4_scan');
    if (!lock.acquired) {
      console.log('[orchestrator] t4_scan skipped: locked by another process');
      process.exit(0);
    }
    try {
      await runOrchestratorLoop(orgId, { kindFilter });
    } finally {
      await lock.release();
    }
    return;
  }

  await runOrchestratorLoop(orgId, { sweep, kindFilter, childJobId, processScheduled });
}

// Guard so the CLI block doesn't fire when imported by verify-ch4.ts
if (require.main === module) {
  main()
    .catch((e) => { console.error('[orchestrator] fatal:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
