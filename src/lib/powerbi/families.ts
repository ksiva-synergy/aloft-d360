import 'server-only';

import prisma from '@/lib/db';
import { PowerBiApiError } from '@/lib/powerbi/client';
import {
  clusterModelFamilies,
  pickCanonicalMemberId,
  type ModelFamilyMember,
} from '@/lib/powerbi/family-cluster';

export interface PbiFamiliesResult {
  families_upserted: number;
  models_linked: number;
  singletons_cleared: number;
  run_id: string;
}

export async function runPbiFamilies(
  orgId: string,
  sourceId: string,
  opts: { runId: string; modelIds?: string[] },
): Promise<PbiFamiliesResult> {
  const source = await prisma.platformContextSource.findFirst({
    where: { id: sourceId, org_id: orgId, connection_kind: 'powerbi', status: 'active' },
  });
  if (!source) {
    throw new PowerBiApiError(`No active Power BI context source ${sourceId}`);
  }

  const models = await prisma.pbiModel.findMany({
    where: {
      org_id: orgId,
      lifecycle: 'active',
      ...(opts.modelIds?.length ? { pbi_model_id: { in: opts.modelIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      pbi_model_id: true,
      workspace_id: true,
      family_id: true,
      props: true,
      _count: { select: { measures: true } },
    },
  });

  const members: ModelFamilyMember[] = models.map((m) => ({
    model_id: m.id,
    name: m.name,
    pbi_model_id: m.pbi_model_id,
    workspace_id: m.workspace_id,
    measure_count: m._count.measures,
  }));

  const clusters = clusterModelFamilies(members);
  const memberIdsInFamily = new Set<string>();

  let familiesUpserted = 0;
  let modelsLinked = 0;

  for (const cluster of clusters) {
    const row = await prisma.pbiFamily.upsert({
      where: { org_id_family_key: { org_id: orgId, family_key: cluster.family_key } },
      create: {
        org_id: orgId,
        family_key: cluster.family_key,
        name: cluster.display_name,
        varying_parameter: cluster.varying_parameter,
        member_constants: cluster.member_constants,
        props: { member_count: cluster.members.length, run_id: opts.runId },
      },
      update: {
        name: cluster.display_name,
        varying_parameter: cluster.varying_parameter,
        member_constants: cluster.member_constants,
        props: { member_count: cluster.members.length, run_id: opts.runId },
        updated_at: new Date(),
      },
    });
    familiesUpserted += 1;

    const canonicalId = pickCanonicalMemberId(cluster.members);

    for (const m of cluster.members) {
      memberIdsInFamily.add(m.model_id);
      const base = models.find((x) => x.id === m.model_id);
      const props = {
        ...((base?.props as Record<string, unknown>) ?? {}),
        family_assignment: {
          family_key: cluster.family_key,
          varying_parameter: cluster.varying_parameter,
          is_canonical: m.model_id === canonicalId,
          assigned_at: new Date().toISOString(),
          run_id: opts.runId,
        },
      };

      await prisma.pbiModel.update({
        where: { id: m.model_id },
        data: {
          family_id: row.id,
          props: props as object,
          updated_at: new Date(),
        },
      });
      modelsLinked += 1;
    }
  }

  let singletonsCleared = 0;
  for (const m of models) {
    if (memberIdsInFamily.has(m.id) || !m.family_id) continue;

    const nextProps = { ...(m.props as Record<string, unknown>) };
    delete nextProps.family_assignment;

    await prisma.pbiModel.update({
      where: { id: m.id },
      data: {
        family_id: null,
        props: nextProps as object,
        updated_at: new Date(),
      },
    });
    singletonsCleared += 1;
  }

  return {
    families_upserted: familiesUpserted,
    models_linked: modelsLinked,
    singletons_cleared: singletonsCleared,
    run_id: opts.runId,
  };
}
