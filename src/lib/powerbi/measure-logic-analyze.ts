import prisma from '@/lib/db';
import { extractColumnNamesFromNativeSql } from '@/lib/powerbi/catalog-column-parse';
import { parseMLineage } from '@/lib/powerbi/m-lineage';
import { stripTrailingTmdlProperties } from '@/lib/powerbi/tmdl-parse';
import { extractPqRowFilters } from '@/lib/powerbi/pq-filter-parse';
import {
  extractDaxColumnRefs,
  normalizePbiTableName,
  type DaxColumnRef,
} from '@/lib/powerbi/translate-dax-refs';

export type ColumnKind = 'warehouse' | 'calculated' | 'missing' | 'harvest_gap';

export type MeasureLogicRef = {
  table: string;
  column: string;
  kind: ColumnKind;
  source_column: string | null;
  calculated_dax_preview: string | null;
};

export type MeasureLogicTableContext = {
  table: string;
  uc_full_path: string | null;
  pq_filters: string[];
};

export type MeasureLogicComplexity =
  | 'scalar_physical'
  | 'scalar_calc'
  | 'multi_table_calc'
  | 'filter_heavy'
  | 'unbound';

export type ReproductionStrategy =
  | 'rule'
  | 'llm_single_table'
  | 'calc_expand'
  | 'multi_table_expand'
  | 'steward_required'
  | 'reparse_required'
  | 'not_reproducible';

export type MeasureLogicAnalysis = {
  complexity_class: MeasureLogicComplexity;
  reproduction_strategy: ReproductionStrategy;
  block_automated_sql: boolean;
  block_reason: string | null;
  measure_refs: MeasureLogicRef[];
  calc_closure: MeasureLogicRef[];
  harvest_gap_refs: string[];
  tables_involved: string[];
  table_context: MeasureLogicTableContext[];
  aggregation_hint: string | null;
};

export type MeasureLogicColumnMeta = {
  source_column: string | null;
  calculated_dax: string | null;
  data_type?: string | null;
};

export type MeasureLogicTableMeta = {
  displayName: string;
  uc_full_path: string | null;
  source_m: string | null;
  /** Column names of the bound UC object (warehouse truth for lineage checks). */
  warehouse_columns?: string[];
};

export type MeasureLogicRelationship = {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  both: boolean;
  active: boolean;
};

export type MeasureLogicCatalog = {
  columnsByTable: Map<string, Map<string, MeasureLogicColumnMeta>>;
  tableMeta: Map<string, MeasureLogicTableMeta>;
  /** lower(measure name) → definition (for inlining measure references). */
  measures?: Map<string, { name: string; table: string; dax: string }>;
  relationships?: MeasureLogicRelationship[];
};

const DAX_AGG_RE =
  /\b(DISTINCTCOUNTNOBLANK|DISTINCTCOUNT|COUNTROWS|COUNT|SUM|AVERAGE|MIN|MAX|COUNTA)\s*\(/i;

function colKey(table: string, column: string): string {
  return `${normalizePbiTableName(table).toLowerCase()}\0${column.toLowerCase()}`;
}

function tableInHarvest(table: string, catalog: MeasureLogicCatalog): boolean {
  const tKey = normalizePbiTableName(table).toLowerCase();
  if (catalog.tableMeta.has(tKey)) return true;
  return [...catalog.tableMeta.keys()].some(
    (k) => normalizePbiTableName(k).toLowerCase() === tKey,
  );
}

function markHarvestGaps(
  refs: MeasureLogicRef[],
  catalog: MeasureLogicCatalog,
): MeasureLogicRef[] {
  return refs.map((r) => {
    if (r.kind !== 'missing') return r;
    if (!tableInHarvest(r.table, catalog)) return r;
    return { ...r, kind: 'harvest_gap' as const };
  });
}

function resolveColumn(
  ref: DaxColumnRef,
  catalog: MeasureLogicCatalog,
): MeasureLogicRef {
  const tKey = normalizePbiTableName(ref.table).toLowerCase();
  const cols =
    catalog.columnsByTable.get(tKey) ??
    [...catalog.columnsByTable.entries()].find(
      ([k]) => normalizePbiTableName(k).toLowerCase() === tKey,
    )?.[1];
  const meta = cols?.get(ref.column) ?? cols?.get(ref.column.toLowerCase());
  if (!meta) {
    return {
      table: ref.table,
      column: ref.column,
      kind: 'missing',
      source_column: null,
      calculated_dax_preview: null,
    };
  }
  if (meta.calculated_dax?.trim()) {
    return {
      table: ref.table,
      column: ref.column,
      kind: 'calculated',
      source_column: null,
      calculated_dax_preview:
        meta.calculated_dax.length > 280
          ? `${meta.calculated_dax.slice(0, 280)}…`
          : meta.calculated_dax,
    };
  }
  if (meta.source_column?.trim()) {
    return {
      table: ref.table,
      column: ref.column,
      kind: 'warehouse',
      source_column: meta.source_column.trim(),
      calculated_dax_preview: null,
    };
  }
  return {
    table: ref.table,
    column: ref.column,
    kind: 'warehouse',
    source_column: ref.column,
    calculated_dax_preview: null,
  };
}

function buildCalcClosure(
  seedRefs: DaxColumnRef[],
  catalog: MeasureLogicCatalog,
): MeasureLogicRef[] {
  const out: MeasureLogicRef[] = [];
  const seen = new Set<string>();
  const queue: DaxColumnRef[] = [...seedRefs];

  while (queue.length > 0) {
    const ref = queue.shift()!;
    const key = colKey(ref.table, ref.column);
    if (seen.has(key)) continue;
    seen.add(key);

    const resolved = resolveColumn(ref, catalog);
    out.push(resolved);

    const tKey = normalizePbiTableName(ref.table).toLowerCase();
    const cols = catalog.columnsByTable.get(tKey);
    const fullDax =
      cols?.get(ref.column)?.calculated_dax ?? cols?.get(ref.column.toLowerCase())?.calculated_dax;
    if (resolved.kind === 'calculated' && fullDax?.trim()) {
      const inner = extractDaxColumnRefs(fullDax);
      for (const innerRef of inner) {
        if (!seen.has(colKey(innerRef.table, innerRef.column))) {
          queue.push(innerRef);
        }
      }
    }
  }
  return out;
}

function uniqueTables(refs: MeasureLogicRef[]): string[] {
  const s = new Set<string>();
  for (const r of refs) {
    s.add(normalizePbiTableName(r.table));
  }
  return [...s].sort();
}

function tableContextFor(
  tables: string[],
  catalog: MeasureLogicCatalog,
): MeasureLogicTableContext[] {
  return tables.map((t) => {
    const key = normalizePbiTableName(t).toLowerCase();
    const meta =
      catalog.tableMeta.get(key) ??
      [...catalog.tableMeta.entries()].find(
        ([k]) => normalizePbiTableName(k).toLowerCase() === key,
      )?.[1];
    const display = meta?.displayName ?? t;
    return {
      table: display,
      uc_full_path: meta?.uc_full_path ?? null,
      pq_filters: extractPqRowFilters(meta?.source_m),
    };
  });
}

function classifyAndStrategy(input: {
  measureRefs: MeasureLogicRef[];
  closure: MeasureLogicRef[];
  tables: string[];
  tableContext: MeasureLogicTableContext[];
  dax: string;
  hasUc: boolean;
}): Pick<
  MeasureLogicAnalysis,
  'complexity_class' | 'reproduction_strategy' | 'block_automated_sql' | 'block_reason'
> {
  const { measureRefs, closure, tables, tableContext, dax, hasUc } = input;

  if (!dax.trim()) {
    return {
      complexity_class: 'unbound',
      reproduction_strategy: 'not_reproducible',
      block_automated_sql: true,
      block_reason: 'Empty measure DAX',
    };
  }
  if (!hasUc) {
    return {
      complexity_class: 'unbound',
      reproduction_strategy: 'not_reproducible',
      block_automated_sql: true,
      block_reason: 'No Unity Catalog binding for measure tables',
    };
  }

  const hasCalcInMeasure = measureRefs.some((r) => r.kind === 'calculated');
  const hasCalcInClosure = closure.some((r) => r.kind === 'calculated');
  const harvestGaps = [...measureRefs, ...closure].filter((r) => r.kind === 'harvest_gap');
  const hasMissing = [...measureRefs, ...closure].some((r) => r.kind === 'missing');
  const multiTable = tables.length > 1;
  const filterHeavy = tableContext.some((t) => t.pq_filters.length > 0);

  let complexity: MeasureLogicComplexity = 'scalar_physical';
  if (multiTable && (hasCalcInMeasure || hasCalcInClosure)) {
    complexity = 'multi_table_calc';
  } else if (hasCalcInMeasure || hasCalcInClosure) {
    complexity = 'scalar_calc';
  } else if (filterHeavy) {
    complexity = 'filter_heavy';
  }

  let strategy: ReproductionStrategy = 'rule';
  let block = false;
  let blockReason: string | null = null;

  if (harvestGaps.length > 0) {
    const labels = harvestGaps.map((r) => `${normalizePbiTableName(r.table)}[${r.column}]`);
    strategy = 'reparse_required';
    block = true;
    blockReason = `Harvest gap: ${labels.join(', ')} in DAX but not in pbi_columns — re-run pbi_definitions + pbi_parse (often a calculated column in Power BI)`;
  } else if (hasMissing) {
    strategy = 'steward_required';
    block = true;
    blockReason = 'DAX references columns on tables not in harvested model';
  } else if (complexity === 'multi_table_calc') {
    strategy = 'multi_table_expand';
    block = true;
    blockReason =
      'Measure uses calculated and/or multi-table logic — expand calc + PQ filters before SQL';
  } else if (hasCalcInMeasure || hasCalcInClosure) {
    strategy = 'calc_expand';
    block = true;
    blockReason =
      'Measure references calculated columns — inline calc (and PQ import filters) before SQL';
  } else if (filterHeavy) {
    strategy = 'llm_single_table';
    block = false;
  } else if (measureRefs.length === 0) {
    strategy = 'steward_required';
    block = true;
    blockReason = 'No column references detected in DAX — needs manual review';
  } else {
    strategy = measureRefs.length === 1 ? 'rule' : 'llm_single_table';
  }

  return {
    complexity_class: complexity,
    reproduction_strategy: strategy,
    block_automated_sql: block,
    block_reason: blockReason,
  };
}

export function analyzeMeasureLogic(input: {
  dax: string;
  catalog: MeasureLogicCatalog;
  hasUc: boolean;
}): MeasureLogicAnalysis {
  const dax = input.dax ?? '';
  const measureRefsRaw = extractDaxColumnRefs(dax);
  let measureRefs = measureRefsRaw.map((r) => resolveColumn(r, input.catalog));
  let closure = buildCalcClosure(measureRefsRaw, input.catalog);
  measureRefs = markHarvestGaps(measureRefs, input.catalog);
  closure = markHarvestGaps(closure, input.catalog);
  const harvest_gap_refs = [...measureRefs, ...closure]
    .filter((r) => r.kind === 'harvest_gap')
    .map((r) => `${normalizePbiTableName(r.table)}[${r.column}]`);
  const uniqueHarvestGaps = [...new Set(harvest_gap_refs)];
  const tables = uniqueTables([...measureRefs, ...closure]);
  const tableContext = tableContextFor(tables, input.catalog);
  const agg = dax.match(DAX_AGG_RE);
  const classified = classifyAndStrategy({
    measureRefs,
    closure,
    tables,
    tableContext,
    dax,
    hasUc: input.hasUc,
  });

  return {
    ...classified,
    measure_refs: measureRefs,
    calc_closure: closure,
    harvest_gap_refs: uniqueHarvestGaps,
    tables_involved: tables,
    table_context: tableContext,
    aggregation_hint: agg ? agg[1].toUpperCase() : null,
  };
}

export function measureLogicAnalysisProps(
  analysis: MeasureLogicAnalysis,
): Record<string, unknown> {
  return { measure_logic_analysis: analysis };
}

export type MeasureLogicSummary = {
  complexity_class: MeasureLogicComplexity;
  reproduction_strategy: ReproductionStrategy;
  block_automated_sql: boolean;
  block_reason: string | null;
  tables_involved: string[];
  calc_columns: string[];
  harvest_gap_refs: string[];
  pq_filter_count: number;
  aggregation_hint: string | null;
};

export function summarizeMeasureLogic(analysis: MeasureLogicAnalysis): MeasureLogicSummary {
  const calcCols = [
    ...analysis.measure_refs.filter((r) => r.kind === 'calculated'),
    ...analysis.calc_closure.filter((r) => r.kind === 'calculated'),
  ].map((r) => `${normalizePbiTableName(r.table)}[${r.column}]`);
  const uniqueCalc = [...new Set(calcCols)];
  const pqCount = analysis.table_context.reduce((n, t) => n + t.pq_filters.length, 0);

  return {
    complexity_class: analysis.complexity_class,
    reproduction_strategy: analysis.reproduction_strategy,
    block_automated_sql: analysis.block_automated_sql,
    block_reason: analysis.block_reason,
    tables_involved: analysis.tables_involved,
    calc_columns: uniqueCalc,
    harvest_gap_refs: analysis.harvest_gap_refs,
    pq_filter_count: pqCount,
    aggregation_hint: analysis.aggregation_hint,
  };
}

export async function loadMeasureLogicCatalog(
  orgId: string,
  internalModelId: string,
): Promise<MeasureLogicCatalog> {
  const [tables, columns, measures, relationships] = await Promise.all([
    prisma.pbiTable.findMany({
      where: { org_id: orgId, model_id: internalModelId, lifecycle: 'active' },
      select: {
        name: true,
        source_m: true,
        sourceBinding: {
          select: { uc_full_path: true, bind_status: true, context_object_id: true },
        },
      },
    }),
    prisma.pbiColumn.findMany({
      where: { org_id: orgId, model_id: internalModelId, lifecycle: 'active' },
      select: {
        name: true,
        source_column: true,
        calculated_dax: true,
        data_type: true,
        table: { select: { name: true } },
      },
    }),
    prisma.pbiMeasure.findMany({
      where: { org_id: orgId, model_id: internalModelId },
      select: { name: true, dax: true, table: { select: { name: true } } },
    }),
    prisma.pbiRelationship.findMany({
      where: { org_id: orgId, model_id: internalModelId, lifecycle: 'active' },
      select: { from_column: true, to_column: true, cross_filtering: true, is_active: true },
    }),
  ]);

  const columnsByTable = new Map<string, Map<string, MeasureLogicColumnMeta>>();
  for (const c of columns) {
    const tKey = normalizePbiTableName(c.table.name).toLowerCase();
    let m = columnsByTable.get(tKey);
    if (!m) {
      m = new Map();
      columnsByTable.set(tKey, m);
    }
    const meta = {
      source_column: c.source_column,
      calculated_dax: stripTrailingTmdlProperties(c.calculated_dax),
      data_type: c.data_type,
    };
    m.set(c.name, meta);
    m.set(c.name.toLowerCase(), meta);
  }

  const objectIds = [
    ...new Set(
      tables
        .map((t) => t.sourceBinding?.context_object_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const warehouseCols = new Map<string, string[]>();
  if (objectIds.length) {
    const ucCols = await prisma.platformContextColumn.findMany({
      where: { org_id: orgId, object_id: { in: objectIds }, lifecycle: 'active' },
      select: { object_id: true, name: true },
    });
    for (const c of ucCols) {
      warehouseCols.set(c.object_id, [...(warehouseCols.get(c.object_id) ?? []), c.name]);
    }
  }

  const tableMeta = new Map<string, MeasureLogicTableMeta>();
  for (const t of tables) {
    const tKey = normalizePbiTableName(t.name).toLowerCase();
    const uc =
      t.sourceBinding?.bind_status === 'matched' && t.sourceBinding.uc_full_path?.trim()
        ? t.sourceBinding.uc_full_path.trim()
        : null;
    const objectId = t.sourceBinding?.context_object_id ?? null;
    const lineage = t.source_m ? parseMLineage(t.source_m) : null;
    tableMeta.set(tKey, {
      displayName: t.name,
      uc_full_path: uc,
      source_m: t.source_m,
      warehouse_columns: [
        ...(objectId ? (warehouseCols.get(objectId) ?? []) : []),
        ...extractColumnNamesFromNativeSql(lineage?.nativeSql ?? null),
      ],
    });
  }

  const measureMap = new Map<string, { name: string; table: string; dax: string }>();
  for (const m of measures) {
    if (!m.dax?.trim()) continue;
    measureMap.set(m.name.toLowerCase(), {
      name: m.name,
      table: m.table.name,
      dax: stripTrailingTmdlProperties(m.dax) ?? m.dax,
    });
  }

  const rels: MeasureLogicRelationship[] = [];
  for (const r of relationships) {
    const from = parseRelationshipEnd(r.from_column);
    const to = parseRelationshipEnd(r.to_column);
    if (!from || !to) continue;
    rels.push({
      fromTable: from.table,
      fromColumn: from.column,
      toTable: to.table,
      toColumn: to.column,
      both: (r.cross_filtering ?? '').toLowerCase() === 'bothdirections',
      active: r.is_active !== false,
    });
  }

  return { columnsByTable, tableMeta, measures: measureMap, relationships: rels };
}

/** `'Vessel Internal Audit'.imono`, `PSC.'Key Column'`, `IMO_Master_List.KEY` → table + column. */
export function parseRelationshipEnd(
  raw: string | null | undefined,
): { table: string; column: string } | null {
  const s = raw?.trim();
  if (!s) return null;
  const m = s.match(/^(?:'((?:[^']|'')+)'|([^.']+))\.(?:'((?:[^']|'')+)'|(.+))$/);
  if (!m) return null;
  const table = (m[1] ?? m[2] ?? '').replace(/''/g, "'").trim();
  const column = (m[3] ?? m[4] ?? '').replace(/''/g, "'").trim();
  return table && column ? { table, column } : null;
}
