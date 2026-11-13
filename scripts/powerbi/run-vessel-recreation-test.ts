#!/usr/bin/env npx tsx
/**
 * Vessel Internal Audit report — oracle → parity → publish (measures with draft SQL).
 */
import prisma from '@/lib/db';
import { enqueue } from '@/lib/context/queue';
import { getDefaultOrg } from '@/lib/org';
import { buildModelRecreationSummary } from '@/lib/powerbi/recreation-summary';

const VESSEL_REPORT = '093a04a2-aff1-4acb-8e80-2906cd4605a3';
const VESSEL_MODEL = 'b7d7e779-15df-4c75-9c8a-27764fd889d2';

const STEPS = ['pbi_oracle', 'pbi_parity', 'pbi_publish'] as const;

async function main() {
  const orgId = getDefaultOrg().id;
  const source = await prisma.platformContextSource.findFirst({
    where: { org_id: orgId, connection_kind: 'powerbi', status: 'active' },
    select: { id: true, display_name: true },
  });
  if (!source) throw new Error('No active powerbi source');

  const scope = {
    report_ids: [VESSEL_REPORT],
    model_ids: [VESSEL_MODEL],
    max_models: 1,
    max_reports: 1,
    pilot: true,
    oracle_only_translated: true,
  };

  const { runQueuedJobById } = await import('../context/orchestrator');

  for (const kind of STEPS) {
    const job = await enqueue(kind, source.id, scope, 'on_demand', orgId);
    console.log(`[vessel-test] ${kind} job=${job.id}`);
    const result = await runQueuedJobById(orgId, job.id);
    if (result.status === 'failed') throw new Error(result.error ?? `${kind} failed`);
    console.log(`[vessel-test] ${kind} ok`, result.stats ?? '');
  }

  const model = await prisma.pbiModel.findFirst({
    where: { org_id: orgId, pbi_model_id: VESSEL_MODEL, lifecycle: 'active' },
    select: { id: true, name: true },
  });
  if (!model) return;

  const { summary, measures } = await buildModelRecreationSummary(orgId, model.id);
  console.log('\n=== Vessel Internal Audit recreation ===\n');
  console.log(summary);

  const withSql = measures.filter((m) => m.stage === 'draft_sql' || m.stage === 'recreated' || m.stage === 'published');
  console.log(`\n--- Measures with SQL (${withSql.length}) ---\n`);
  for (const m of withSql.slice(0, 25)) {
    console.log(
      `${m.measure_name} | stage=${m.stage} | tier=${m.translation_tier ?? '-'} | parity=${m.parity_verdict ?? '-'}`,
    );
  }
  if (withSql.length > 25) console.log(`... +${withSql.length - 25} more`);

  const report = await prisma.pbiReport.findFirst({
    where: { org_id: orgId, pbi_report_id: VESSEL_REPORT },
    select: { name: true },
  });
  console.log(
    `\nEstate UI: Agent Lab → Estate → Power BI → model "${model.name}" (report: ${report?.name ?? VESSEL_REPORT})`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
