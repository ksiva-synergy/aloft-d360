import 'server-only';

import prisma from '@/lib/db';
import { PowerBiApiError } from '@/lib/powerbi/client';
import { DEFAULT_PBI_DOMAINS } from '@/lib/powerbi/domain-registry';
import {
  detectMeasureNameConflicts,
  pickPrimaryDomain,
  scoreModelDomains,
} from '@/lib/powerbi/domain-score';

export interface PbiDomainsResult {
  domains_upserted: number;
  models_scored: number;
  models_assigned: number;
  conflicts: number;
  run_id: string;
}

async function ensureOrgDomains(orgId: string): Promise<Map<string, string>> {
  const keyToId = new Map<string, string>();
  for (const def of DEFAULT_PBI_DOMAINS) {
    const row = await prisma.pbiDomain.upsert({
      where: { org_id_domain_key: { org_id: orgId, domain_key: def.domain_key } },
      create: {
        org_id: orgId,
        domain_key: def.domain_key,
        name: def.name,
        steward_group: def.steward_group,
        sensitivity: def.sensitivity,
        rollout_wave: def.rollout_wave,
        lexicon: def.lexicon,
      },
      update: {
        name: def.name,
        steward_group: def.steward_group,
        sensitivity: def.sensitivity,
        rollout_wave: def.rollout_wave,
        lexicon: def.lexicon,
        updated_at: new Date(),
      },
    });
    keyToId.set(def.domain_key, row.id);
  }
  return keyToId;
}

export async function runPbiDomains(
  orgId: string,
  sourceId: string,
  opts: { runId: string; modelIds?: string[] },
): Promise<PbiDomainsResult> {
  const source = await prisma.platformContextSource.findFirst({
    where: { id: sourceId, org_id: orgId, connection_kind: 'powerbi', status: 'active' },
  });
  if (!source) {
    throw new PowerBiApiError(`No active Power BI context source ${sourceId}`);
  }

  const domainIdByKey = await ensureOrgDomains(orgId);

  const domainRows = await prisma.pbiDomain.findMany({ where: { org_id: orgId } });
  const domainDefs = domainRows.map((d) => ({
    domain_key: d.domain_key,
    name: d.name,
    steward_group: d.steward_group,
    sensitivity: d.sensitivity,
    rollout_wave: d.rollout_wave,
    lexicon: Array.isArray(d.lexicon) ? (d.lexicon as string[]) : [],
  }));

  const models = await prisma.pbiModel.findMany({
    where: {
      org_id: orgId,
      lifecycle: 'active',
      ...(opts.modelIds?.length ? { pbi_model_id: { in: opts.modelIds } } : {}),
    },
    include: {
      workspace: { select: { name: true, domain_hint: true } },
      measures: { select: { name: true, display_folder: true, dax_hash: true } },
      sourceBindings: {
        where: { bind_status: 'matched', context_object_id: { not: null } },
        include: {
          contextObject: { select: { domain_keywords: true } },
        },
      },
    },
  });

  let modelsAssigned = 0;
  const measureRowsForConflicts: Array<{
    model_id: string;
    domain_key: string | null;
    measure_name: string;
    dax_hash: string | null;
  }> = [];

  for (const model of models) {
    const catalogKeywords = model.sourceBindings.flatMap((b) =>
      Array.isArray(b.contextObject?.domain_keywords)
        ? (b.contextObject!.domain_keywords as string[])
        : [],
    );

    const scores = scoreModelDomains({
      domains: domainDefs,
      modelName: model.name,
      workspaceName: model.workspace.name,
      workspaceDomainHint: model.workspace.domain_hint,
      measureNames: model.measures.map((m) => m.name),
      measureFolders: model.measures.map((m) => m.display_folder ?? '').filter(Boolean),
      catalogDomainKeywords: catalogKeywords,
    });

    const primary = pickPrimaryDomain(scores);
    const domainKey = primary?.domain_key ?? null;
    const domainUuid = domainKey ? domainIdByKey.get(domainKey) ?? null : null;

    const props = {
      ...(model.props as Record<string, unknown>),
      domain_assignment: {
        domain_key: domainKey,
        confidence: primary?.confidence ?? 0,
        signals: primary?.signals ?? scores.slice(0, 3),
        assigned_at: new Date().toISOString(),
        run_id: opts.runId,
      },
    };

    await prisma.pbiModel.update({
      where: { id: model.id },
      data: {
        domain_id: domainUuid,
        props: props as object,
        updated_at: new Date(),
      },
    });

    if (domainKey) modelsAssigned += 1;

    for (const m of model.measures) {
      measureRowsForConflicts.push({
        model_id: model.id,
        domain_key: domainKey,
        measure_name: m.name,
        dax_hash: m.dax_hash,
      });
    }
  }

  const conflicts = detectMeasureNameConflicts(measureRowsForConflicts);
  for (const c of conflicts) {
    await prisma.pbiConflict.upsert({
      where: { org_id_metric_key: { org_id: orgId, metric_key: c.metric_key } },
      create: {
        org_id: orgId,
        metric_name: c.metric_name,
        metric_key: c.metric_key,
        model_ids: c.model_ids,
        domain_keys: c.domain_keys,
        dax_hashes: c.dax_hashes,
        summary: c.summary,
        first_seen_run: opts.runId,
        last_seen_run: opts.runId,
      },
      update: {
        metric_name: c.metric_name,
        model_ids: c.model_ids,
        domain_keys: c.domain_keys,
        dax_hashes: c.dax_hashes,
        summary: c.summary,
        last_seen_run: opts.runId,
        updated_at: new Date(),
      },
    });
  }

  return {
    domains_upserted: domainIdByKey.size,
    models_scored: models.length,
    models_assigned: modelsAssigned,
    conflicts: conflicts.length,
    run_id: opts.runId,
  };
}
