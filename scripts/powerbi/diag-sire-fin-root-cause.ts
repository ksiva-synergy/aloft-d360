#!/usr/bin/env npx tsx
import prisma from '@/lib/db';
import { getDefaultOrg } from '@/lib/org';
import { analyzeMeasureLogic, loadMeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { resolveUcForMeasure, extractDaxColumnRefs, normalizePbiTableName } from '@/lib/powerbi/translate-dax-refs';

const MODEL = 'b7d7e779-15df-4c75-9c8a-27764fd889d2';

async function main() {
  const orgId = getDefaultOrg().id;
  const model = await prisma.pbiModel.findFirst({
    where: { pbi_model_id: MODEL, lifecycle: 'active' },
    select: { id: true },
  });
  const m = await prisma.pbiMeasure.findFirst({
    where: { model_id: model!.id, name: 'SIRE_Fin' },
    select: { dax: true, table: { select: { name: true } } },
  });
  const tr = await prisma.pbiTranslation.findFirst({
    where: { model_id: model!.id, measure_name: 'SIRE_Fin' },
    select: { tier: true, sql_text: true, props: true },
  });
  const sireCol = await prisma.pbiColumn.findFirst({
    where: {
      model_id: model!.id,
      name: 'SIRE_Check',
      table: { name: { contains: 'Vessel Internal' } },
    },
    select: { calculated_dax: true },
  });

  const tables = await prisma.pbiTable.findMany({
    where: { model_id: model!.id },
    select: {
      name: true,
      sourceBinding: { select: { uc_full_path: true, bind_status: true } },
    },
  });
  const ucMap = new Map<string, { uc: string }>();
  for (const t of tables) {
    const b = t.sourceBinding;
    if (b?.bind_status === 'matched' && b.uc_full_path) {
      ucMap.set(normalizePbiTableName(t.name), { uc: b.uc_full_path });
    }
  }

  const resolved = resolveUcForMeasure({
    dax: m!.dax,
    homeTableName: m!.table.name,
    homeUc: null,
    homeNativeSql: null,
    modelTables: new Map([...ucMap.entries()].map(([k, v]) => [k, { uc: v.uc, nativeSql: null }])),
  });

  const catalog = await loadMeasureLogicCatalog(orgId, model!.id);
  const logic = analyzeMeasureLogic({ dax: m!.dax, catalog, hasUc: Boolean(resolved?.uc) });

  console.log('=== SIRE_Fin measure DAX ===\n', m?.dax);
  console.log('\n=== UC resolve ===\n', resolved);
  console.log('\n=== Translation row ===\n', { tier: tr?.tier, has_sql: Boolean(tr?.sql_text?.trim()) });
  const props = tr?.props as Record<string, unknown> | undefined;
  const ml = props?.measure_logic_analysis as Record<string, unknown> | undefined;
  console.log('\n=== Analyzer (stored) ===\n', {
    complexity: ml?.complexity_class,
    strategy: ml?.reproduction_strategy,
    block: ml?.block_automated_sql,
    reason: ml?.block_reason,
    tables: ml?.tables_involved,
    pq_count: ml?.pq_filter_count,
  });
  console.log('\n=== Analyzer (live) ===\n', {
    complexity: logic.complexity_class,
    strategy: logic.reproduction_strategy,
    block: logic.block_automated_sql,
    reason: logic.block_reason,
    tables: logic.tables_involved,
    closure_cols: logic.closure_refs?.map((r) => `${r.table}[${r.column}](${r.kind})`),
    table_context: logic.table_context.map((t) => ({
      table: t.table,
      uc: t.uc_full_path,
      pq: t.pq_filters.length,
    })),
  });

  console.log('\n=== SIRE_Check calc (harvested) ===\n', sireCol?.calculated_dax?.slice(0, 400));
  console.log('\n=== Tables in SIRE_Check DAX ===\n', extractDaxColumnRefs(sireCol?.calculated_dax ?? ''));
  console.log('\n=== SIRE 2_0 binding ===\n', tables.find((t) => t.name.includes('SIRE')));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
