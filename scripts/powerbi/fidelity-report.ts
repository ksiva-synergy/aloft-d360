#!/usr/bin/env npx tsx
/**
 * L0 fidelity gate report for harvested models (read-only: no translate, no writes).
 *
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/fidelity-report.ts --models "CII SDK"
 *   … fidelity-report.ts --models "Vessel Internal Audit" --json
 */
import prisma from '@/lib/db';
import { getDefaultOrg } from '@/lib/org';
import { buildFidelityReport } from '@/lib/powerbi/fidelity-gate';
import { loadMeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { buildModelGraph } from '@/lib/powerbi/model-graph';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const orgId = getDefaultOrg().id;
  const wanted = arg('--models')?.split(',').map((s) => s.trim()).filter(Boolean);
  const models = await prisma.pbiModel.findMany({
    where: { org_id: orgId, lifecycle: 'active', ...(wanted ? { name: { in: wanted } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  if (!models.length) throw new Error('No matching models');
  for (const m of models) {
    const catalog = await loadMeasureLogicCatalog(orgId, m.id);
    const graph = buildModelGraph(catalog);
    const report = buildFidelityReport(catalog, { graph });
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ model: m.name, ...report }, null, 2));
      continue;
    }
    const kinds = new Map<string, number>();
    for (const n of graph.nodes.values()) kinds.set(n.kind, (kinds.get(n.kind) ?? 0) + 1);
    console.log(`\n=== ${m.name} ===`);
    console.log(`graph: ${JSON.stringify(Object.fromEntries(kinds))}`);
    console.log(`sources: ${JSON.stringify(countBy(Object.values(report.sources)))}`);
    console.log(`issues: ${JSON.stringify(report.counts)}  blocked measures: ${report.blocked.length}`);
    let unused = 0;
    report.issues.forEach((iss, i) => {
      if (iss.severity !== 'block') return;
      const affected = Object.entries(report.byMeasure)
        .filter(([, idx]) => idx.includes(i))
        .map(([key]) => catalog.measures?.get(key)?.name ?? key);
      if (!affected.length) {
        unused += 1; // defect on an object no measure depends on
        return;
      }
      console.log(`  [${iss.kind}] ${iss.object}: ${iss.detail}`);
      if (iss.suggestion) console.log(`      → ${iss.suggestion}`);
      console.log(`      measures (${affected.length}): ${affected.slice(0, 8).join(', ')}${affected.length > 8 ? ', …' : ''}`);
    });
    if (unused) console.log(`  + ${unused} blocking issues on objects no measure uses (see --json)`);
    const warns = report.issues.filter((i) => i.severity === 'warn');
    if (warns.length) {
      console.log(`  warnings: ${warns.length} (${warns.slice(0, 6).map((w) => `${w.kind}:${w.object}`).join('; ')}${warns.length > 6 ? '; …' : ''})`);
    }
  }
}

function countBy(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
