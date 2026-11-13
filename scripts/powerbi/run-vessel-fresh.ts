#!/usr/bin/env npx tsx
/**
 * Vessel Internal Audit — fresh end-to-end: definitions → parse (forced) → catalog link →
 * translate (compile/test expand + rule + LLM) → oracle → parity → publish.
 *
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/run-vessel-fresh.ts
 */
import prisma from '@/lib/db';
import { enqueue } from '@/lib/context/queue';
import { getDefaultOrg } from '@/lib/org';
import { buildModelRecreationSummary } from '@/lib/powerbi/recreation-summary';

const VESSEL_REPORT = '093a04a2-aff1-4acb-8e80-2906cd4605a3';
const VESSEL_MODEL = 'b7d7e779-15df-4c75-9c8a-27764fd889d2';
const SCOPE = {
  report_ids: [VESSEL_REPORT], model_ids: [VESSEL_MODEL], max_models: 1, max_reports: 1,
  fetch_models: true, fetch_reports: false, pilot: true,
  oracle_only_translated: true, llm_translate: true, max_llm_measures: 30,
};
const STEPS = ['pbi_definitions', 'pbi_parse', 'pbi_catalog_link', 'pbi_translate', 'pbi_oracle', 'pbi_parity', 'pbi_publish'] as const;

async function main() {
  const orgId = getDefaultOrg().id;
  const source = await prisma.platformContextSource.findFirst({ where: { org_id: orgId, connection_kind: 'powerbi', status: 'active' }, select: { id: true } });
  if (!source) throw new Error('No active powerbi source');
  const { runQueuedJobById } = await import('../context/orchestrator');
  for (const kind of STEPS) {
    const t0 = Date.now();
    const scope = kind === 'pbi_parse' ? { ...SCOPE, force_parse: true } : SCOPE;
    const job = await enqueue(kind, source.id, scope, 'on_demand', orgId);
    console.log(`\n[fresh] ${kind} job=${job.id}`);
    const result = await runQueuedJobById(orgId, job.id);
    console.log(`[fresh] ${kind} ${result.status} in ${Math.round((Date.now() - t0) / 1000)}s`, result.error ?? '');
    if (result.status === 'failed') throw new Error(result.error ?? `${kind} failed`);
  }
  const model = await prisma.pbiModel.findFirst({ where: { org_id: orgId, pbi_model_id: VESSEL_MODEL, lifecycle: 'active' }, select: { id: true } });
  const leaked = await prisma.pbiColumn.count({ where: { model_id: model!.id, calculated_dax: { contains: 'changedProperty' } } });
  console.log('\n[fresh] calc columns still containing changedProperty after re-parse:', leaked);
  const { summary } = await buildModelRecreationSummary(orgId, model!.id);
  console.log('\n=== Recreation summary ===\n' + JSON.stringify(summary, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
