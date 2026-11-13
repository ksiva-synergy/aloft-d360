#!/usr/bin/env npx tsx
/**
 * Vessel Internal Audit — catalog link → translate (expand + LLM) → oracle → parity → publish.
 */
import prisma from '@/lib/db';
import { enqueue } from '@/lib/context/queue';
import { getDefaultOrg } from '@/lib/org';
import { buildModelRecreationSummary } from '@/lib/powerbi/recreation-summary';

const VESSEL_REPORT = '093a04a2-aff1-4acb-8e80-2906cd4605a3';
const VESSEL_MODEL = 'b7d7e779-15df-4c75-9c8a-27764fd889d2';

const SCOPE = {
  report_ids: [VESSEL_REPORT],
  model_ids: [VESSEL_MODEL],
  max_models: 1,
  max_reports: 1,
  pilot: true,
  oracle_only_translated: true,
  llm_translate: true,
  max_llm_measures: 30,
};

async function main() {
  const orgId = getDefaultOrg().id;
  const source = await prisma.platformContextSource.findFirst({
    where: { org_id: orgId, connection_kind: 'powerbi', status: 'active' },
    select: { id: true },
  });
  if (!source) throw new Error('No active powerbi source');

  const { runQueuedJobById } = await import('../context/orchestrator');
  const steps = [
    'pbi_catalog_link',
    'pbi_translate',
    'pbi_oracle',
    'pbi_parity',
    'pbi_publish',
  ] as const;

  for (const kind of steps) {
    const job = await enqueue(kind, source.id, SCOPE, 'on_demand', orgId);
    console.log(`[vessel-full] ${kind} job=${job.id}`);
    const result = await runQueuedJobById(orgId, job.id);
    if (result.status === 'failed') throw new Error(result.error ?? `${kind} failed`);
    console.log(`[vessel-full] ${kind} ok`, JSON.stringify(result.stats ?? {}));
  }

  const model = await prisma.pbiModel.findFirst({
    where: { org_id: orgId, pbi_model_id: VESSEL_MODEL, lifecycle: 'active' },
    select: { id: true, name: true },
  });
  if (!model) return;

  const { summary } = await buildModelRecreationSummary(orgId, model.id);
  console.log('\n=== Recreation after full pipeline ===\n');
  console.log(summary);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
