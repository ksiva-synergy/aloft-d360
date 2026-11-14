#!/usr/bin/env npx tsx
/**
 * Explain how Power BI calculated columns are built and how we compute them in SQL:
 * DAX → dependency tree (tables / columns / measures, recursive) → warehouse lineage → SQL.
 *
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/explain-calc-column.ts \
 *     --model "CII SDK" --table CII_Enerva --columns "FC_Electrical,LNG,MGO"
 */
import prisma from '@/lib/db';
import { getDefaultOrg } from '@/lib/org';
import { explainCalculatedColumn, renderLineage } from '@/lib/powerbi/calc-column-explain';
import { loadMeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const modelName = arg('--model');
  const table = arg('--table');
  const columns = arg('--columns')?.split(',').map((s) => s.trim()).filter(Boolean);
  if (!modelName || !table || !columns?.length) {
    throw new Error('usage: --model <name> --table <table> --columns <a,b,…>');
  }
  const orgId = getDefaultOrg().id;
  const model = await prisma.pbiModel.findFirst({
    where: { org_id: orgId, name: modelName, lifecycle: 'active' },
    select: { id: true },
  });
  if (!model) throw new Error(`model not found: ${modelName}`);
  const catalog = await loadMeasureLogicCatalog(orgId, model.id);
  const maxSql = Number(arg('--sql-lines') ?? '40');

  for (const column of columns) {
    const ex = explainCalculatedColumn(catalog, table, column);
    console.log(`\n${'='.repeat(100)}\n${modelName} :: '${table}'[${column}]\n${'='.repeat(100)}`);
    console.log(renderLineage(ex.tree));
    if (ex.compileError) {
      console.log(`\nCOMPILE: ✗ ${ex.compileError}`);
    } else if (ex.sql) {
      const lines = ex.sql.split('\n');
      console.log(`\nCOMPILED SQL (${ex.sql.length} chars${lines.length > maxSql ? `, first ${maxSql} lines` : ''}):`);
      console.log(lines.slice(0, maxSql).join('\n'));
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
