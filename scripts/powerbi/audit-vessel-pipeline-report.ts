#!/usr/bin/env npx tsx
/**
 * Vessel Internal Audit — pipeline coverage report (analysis-driven, no measure-name hardcoding).
 */
import prisma from '@/lib/db';
import { getDefaultOrg } from '@/lib/org';
import {
  analyzeMeasureLogic,
  loadMeasureLogicCatalog,
} from '@/lib/powerbi/measure-logic-analyze';
import { tryExpandMeasureSql } from '@/lib/powerbi/measure-sql-expand';
import {
  normalizePbiTableName,
  resolveUcForMeasure,
  type TableUcRow,
} from '@/lib/powerbi/translate-dax-refs';

const VESSEL_MODEL = 'b7d7e779-15df-4c75-9c8a-27764fd889d2';
const VESSEL_REPORT = '093a04a2-aff1-4acb-8e80-2906cd4605a3';

type Row = {
  name: string;
  table: string;
  uc_ok: boolean;
  strategy: string;
  complexity: string;
  tier: string | null;
  has_sql: boolean;
  expand_possible: boolean;
  expand_pattern: string | null;
  block_reason: string | null;
};

async function main() {
  const orgId = getDefaultOrg().id;
  const model = await prisma.pbiModel.findFirst({
    where: { org_id: orgId, pbi_model_id: VESSEL_MODEL, lifecycle: 'active' },
    select: { id: true, name: true },
  });
  if (!model) throw new Error('model not found');

  const catalog = await loadMeasureLogicCatalog(orgId, model.id);
  const tables = await prisma.pbiTable.findMany({
    where: { org_id: orgId, model_id: model.id },
    select: {
      name: true,
      sourceBinding: {
        select: { bind_status: true, uc_full_path: true, native_sql: true },
      },
    },
  });
  const ucMap = new Map<string, TableUcRow>();
  for (const t of tables) {
    const b = t.sourceBinding;
    if (b?.bind_status === 'matched' && b.uc_full_path?.trim()) {
      ucMap.set(normalizePbiTableName(t.name), {
        uc: b.uc_full_path.trim(),
        nativeSql: b.native_sql ?? null,
      });
    }
  }

  const measures = await prisma.pbiMeasure.findMany({
    where: { org_id: orgId, model_id: model.id },
    select: {
      id: true,
      name: true,
      dax: true,
      table: { select: { name: true, sourceBinding: { select: { bind_status: true, uc_full_path: true } } } },
    },
    orderBy: { name: 'asc' },
  });

  const translations = await prisma.pbiTranslation.findMany({
    where: { org_id: orgId, model_id: model.id },
    select: { measure_id: true, tier: true, sql_text: true },
  });
  const trByMeasure = new Map(translations.map((t) => [t.measure_id, t]));

  const rows: Row[] = [];
  const noTr: Row[] = [];
  for (const m of measures) {
    const hb = m.table.sourceBinding;
    const homeUc =
      hb?.bind_status === 'matched' && hb.uc_full_path?.trim() ? hb.uc_full_path.trim() : null;
    const resolved = resolveUcForMeasure({
      dax: m.dax ?? '',
      homeTableName: m.table.name,
      homeUc,
      homeNativeSql: null,
      modelTables: ucMap,
    });
    const logic = analyzeMeasureLogic({
      dax: m.dax ?? '',
      catalog,
      hasUc: Boolean(resolved),
    });
    const expand = resolved
      ? tryExpandMeasureSql({ measureDax: m.dax ?? '', measureLogic: logic, catalog })
      : null;
    const tr = trByMeasure.get(m.id);

    if (resolved && !tr) noTr.push({
      name: m.name,
      table: m.table.name,
      uc_ok: true,
      strategy: logic.reproduction_strategy,
      complexity: logic.complexity_class,
      tier: null,
      has_sql: false,
      expand_possible: Boolean(expand),
      expand_pattern: expand?.pattern ?? null,
      block_reason: logic.block_reason,
    } as Row);

    rows.push({
      name: m.name,
      table: m.table.name,
      uc_ok: Boolean(resolved),
      strategy: logic.reproduction_strategy,
      complexity: logic.complexity_class,
      tier: tr?.tier ?? null,
      has_sql: Boolean(tr?.sql_text?.trim()),
      expand_possible: Boolean(expand),
      expand_pattern: expand?.pattern ?? null,
      block_reason: logic.block_reason,
    });
  }

  const withSql = rows.filter((r) => r.has_sql);
  const expanded = rows.filter((r) => r.tier === 'expand' && r.has_sql);
  const expandGap = rows.filter((r) => r.expand_possible && !r.has_sql);
  const expandGapWrongTier = rows.filter(
    (r) => r.expand_possible && r.tier === 'logic_gate',
  );
  const logicGateNoExpand = rows.filter(
    (r) => r.tier === 'logic_gate' && !r.expand_possible && !r.has_sql,
  );
  const noUc = rows.filter((r) => !r.uc_ok);
  console.log(`\n=== ${model.name} pipeline report ===`);
  console.log(`Report: ${VESSEL_REPORT}`);
  console.log(`Measures: ${rows.length}`);
  console.log(`UC resolved: ${rows.filter((r) => r.uc_ok).length}`);
  console.log(`With SQL (any tier): ${withSql.length}`);
  console.log(`  tier expand: ${expanded.length}`);
  console.log(`  tier rule: ${rows.filter((r) => r.tier === 'rule' && r.has_sql).length}`);
  console.log(`  tier llm: ${rows.filter((r) => r.tier === 'llm' && r.has_sql).length}`);
  console.log(`\n--- Analysis can expand, but no SQL yet (re-run translate) ---\n`);
  if (expandGap.length === 0) console.log('(none)');
  else expandGap.forEach((r) => console.log(`  ${r.name} @ ${r.table} pattern=${r.expand_pattern}`));

  console.log(`\n--- Has expand pattern but stuck logic_gate (stale translate) ---\n`);
  if (expandGapWrongTier.length === 0) console.log('(none)');
  else expandGapWrongTier.forEach((r) => console.log(`  ${r.name} @ ${r.table}`));

  console.log(`\n--- Blocked by analysis (no matching expand pattern) ---\n`);
  const byReason = new Map<string, string[]>();
  for (const r of logicGateNoExpand) {
    const key = r.block_reason?.slice(0, 80) ?? r.strategy;
    if (!byReason.has(key)) byReason.set(key, []);
    byReason.get(key)!.push(`${r.name} (${r.complexity})`);
  }
  for (const [reason, names] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  [${names.length}] ${reason}`);
    for (const n of names.slice(0, 8)) console.log(`      - ${n}`);
    if (names.length > 8) console.log(`      ... +${names.length - 8}`);
  }

  console.log(`\n--- No UC binding (${noUc.length}) ---\n`);
  noUc.slice(0, 15).forEach((r) => console.log(`  ${r.name} @ ${r.table}`));
  if (noUc.length > 15) console.log(`  ... +${noUc.length - 15}`);

  console.log(`\n--- UC ok, no translation row (${noTr.length}) ---\n`);
  noTr.slice(0, 12).forEach((r) => console.log(`  ${r.name} @ ${r.table} strategy=${r.strategy}`));
  if (noTr.length > 12) console.log(`  ... +${noTr.length - 12}`);

  console.log('\n--- Successfully expanded (audit_bridge_distinct) ---\n');
  rows
    .filter((r) => r.expand_possible && r.has_sql && r.tier === 'expand')
    .forEach((r) => console.log(`  ${r.name} @ ${r.table}`));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
