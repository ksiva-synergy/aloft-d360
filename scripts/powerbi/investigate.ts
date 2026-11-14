#!/usr/bin/env npx tsx
/**
 * Differential decomposition (Architecture v2 L5): find the first part of a measure whose value
 * differs between Power BI and the compiled SQL, and store it on the translation.
 *
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/investigate.ts --model "Vessel Internal Audit" --measure "Last_Record_Updated"
 *   … investigate.ts --model "CII SDK-2026" --failing          (every parity mismatch in the model, max 15)
 *   … --plan-only                                              (print probes, run nothing)
 */
import prisma from '@/lib/db';
import { getDefaultOrg } from '@/lib/org';
import { planDecomposition } from '@/lib/powerbi/decompose-plan';
import { investigateMeasure } from '@/lib/powerbi/decompose-run';
import { loadMeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { buildModelGraph } from '@/lib/powerbi/model-graph';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const orgId = getDefaultOrg().id;
  const modelName = arg('--model');
  if (!modelName) throw new Error('--model is required');
  const model = await prisma.pbiModel.findFirst({
    where: { org_id: orgId, name: modelName, lifecycle: 'active' },
    select: { id: true },
  });
  if (!model) throw new Error(`Model not found: ${modelName}`);

  let measures: string[] = [];
  if (arg('--measure')) measures = [arg('--measure')!];
  else if (process.argv.includes('--failing')) {
    const rows = await prisma.pbiTranslation.findMany({
      where: { org_id: orgId, model_id: model.id, parity_verdict: 'fail' },
      select: { measure_name: true },
      orderBy: { measure_name: 'asc' },
      take: 15,
    });
    measures = rows.map((r) => r.measure_name);
  }
  if (!measures.length) throw new Error('Nothing to investigate (use --measure or --failing)');

  if (process.argv.includes('--plan-only')) {
    const catalog = await loadMeasureLogicCatalog(orgId, model.id);
    const graph = buildModelGraph(catalog);
    for (const m of measures) {
      console.log(`\n=== ${m} ===`);
      for (const p of planDecomposition({ measure: m, catalog, graph })) console.log(`  [${p.kind}] ${p.label}\n      ${p.dax.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
    return;
  }

  for (const m of measures) {
    const inv = await investigateMeasure({ orgId, modelId: model.id, measure: m });
    console.log(`\n=== ${m} (${Math.round(inv.ms / 1000)} s, ${inv.probes.length} probes) ===`);
    for (const p of inv.probes) {
      const mark = { match: '✓', differ: '✗', pbi_error: '?', sql_error: '!' }[p.status];
      console.log(`  ${mark} [${p.kind}] ${p.label}: PBI=${String(p.pbi ?? '—')} SQL=${String(p.sql ?? '—')}${p.error ? `  (${p.error.slice(0, 120)})` : ''}`);
    }
    console.log(`  → ${inv.conclusion}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
