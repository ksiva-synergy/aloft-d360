#!/usr/bin/env npx tsx
/** Re-run pbi_translate for Vessel Internal Audit model only. */
import prisma from '@/lib/db';
import { enqueue } from '@/lib/context/queue';
import { getDefaultOrg } from '@/lib/org';
import { analyzeMeasureLogic, loadMeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';

const VESSEL_REPORT = '093a04a2-aff1-4acb-8e80-2906cd4605a3';
const VESSEL_MODEL = 'b7d7e779-15df-4c75-9c8a-27764fd889d2';

async function main() {
  const orgId = getDefaultOrg().id;
  const source = await prisma.platformContextSource.findFirst({
    where: { org_id: orgId, connection_kind: 'powerbi', status: 'active' },
    select: { id: true },
  });
  if (!source) throw new Error('No active powerbi source');

  const scope = {
    report_ids: [VESSEL_REPORT],
    model_ids: [VESSEL_MODEL],
    max_models: 1,
    pilot: true,
    llm_translate: false,
  };

  const { runQueuedJobById } = await import('../context/orchestrator');
  for (const kind of ['pbi_catalog_link', 'pbi_translate'] as const) {
    const jobScope = kind === 'pbi_catalog_link' ? { ...scope, max_models: 1 } : scope;
    const job = await enqueue(kind, source.id, jobScope, 'on_demand', orgId);
    console.log(`[vessel] ${kind} job=${job.id}`);
    const result = await runQueuedJobById(orgId, job.id);
    if (result.status === 'failed') throw new Error(result.error ?? `${kind} failed`);
    console.log(`[vessel] ${kind} ok`, result.stats ?? '');
  }

  const model = await prisma.pbiModel.findFirst({
    where: { org_id: orgId, pbi_model_id: VESSEL_MODEL, lifecycle: 'active' },
    select: { id: true },
  });
  if (!model) return;

  const catalog = await loadMeasureLogicCatalog(orgId, model.id);
  const measures = await prisma.pbiMeasure.findMany({
    where: { org_id: orgId, model_id: model.id },
    select: { name: true, dax: true },
    orderBy: { name: 'asc' },
  });
  const trans = await prisma.pbiTranslation.findMany({
    where: { org_id: orgId, model_id: model.id },
    select: { measure_name: true, tier: true, status: true },
  });
  const byTier: Record<string, number> = {};
  for (const t of trans) byTier[t.tier] = (byTier[t.tier] ?? 0) + 1;
  console.log('\n=== translation tiers ===\n', byTier);

  const gaps: string[] = [];
  for (const m of measures) {
    const logic = analyzeMeasureLogic({ dax: m.dax, catalog, hasUc: true });
    if (logic.harvest_gap_refs.length) gaps.push(`${m.name}: ${logic.harvest_gap_refs.join(', ')}`);
  }
  console.log('\n=== harvest_gap after translate ===\n');
  if (gaps.length) gaps.forEach((g) => console.log(g));
  else console.log('(none)');

  for (const name of ['PSC_Det', 'SIRE_Fin', 'PSC_Fin']) {
    const t = trans.find((x) => x.measure_name === name);
    const logic = analyzeMeasureLogic({
      dax: measures.find((m) => m.name === name)!.dax,
      catalog,
      hasUc: true,
    });
    console.log(`${name} tier=${t?.tier ?? '—'} strategy=${logic.reproduction_strategy}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
