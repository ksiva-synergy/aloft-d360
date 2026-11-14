/**
 * Explain how a Power BI column is calculated: its DAX, every table / column / measure it
 * depends on (recursively), how warehouse-backed columns map to Databricks through Power Query
 * lineage, and the SQL the compiler generates for it. Pure — uses the harvested model only.
 */

import { collectColumnRefs, parseDax } from '@/lib/powerbi/dax-parse';
import { compileRowExpressionsToSql } from '@/lib/powerbi/dax-sql-compile';
import { parseMLineage } from '@/lib/powerbi/m-lineage';
import type { MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { normalizePbiTableName } from '@/lib/powerbi/translate-dax-refs';

export type LineageKind =
  | 'calculated_column'
  | 'measure'
  | 'warehouse_column'
  | 'pq_derived_column'
  | 'calc_table_column'
  | 'missing';

export type LineageNode = {
  ref: string;
  kind: LineageKind;
  /** DAX of a calculated column or measure. */
  dax?: string;
  /** Warehouse-backed column: SQL over the source relation + source columns it reads. */
  warehouse?: { expr: string; sourceColumns: string[]; relation: string };
  note?: string;
  children: LineageNode[];
};

function tkey(t: string): string {
  return normalizePbiTableName(t).toLowerCase();
}

function columnMeta(catalog: MeasureLogicCatalog, table: string, column: string) {
  const cols = catalog.columnsByTable.get(tkey(table));
  if (!cols) return null;
  return (
    cols.get(column) ??
    cols.get(column.toLowerCase()) ??
    [...cols.entries()].find(([k]) => k.trim().toLowerCase() === column.trim().toLowerCase())?.[1] ??
    null
  );
}

function depsOf(dax: string, homeTable: string | null): { table: string | null; column: string }[] {
  try {
    const refs = collectColumnRefs(parseDax(dax));
    const seen = new Set<string>();
    return refs
      .map((r) => ({ table: r.table ?? homeTable, column: r.column }))
      .filter((r) => {
        const k = `${(r.table ?? '').toLowerCase()}|${r.column.toLowerCase()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  } catch {
    return [];
  }
}

export function explainColumn(
  catalog: MeasureLogicCatalog,
  table: string | null,
  column: string,
  seen = new Set<string>(),
  depth = 0,
): LineageNode {
  const ref = table ? `'${normalizePbiTableName(table)}'[${column}]` : `[${column}]`;
  const meta = table ? columnMeta(catalog, table, column) : null;
  const measure = catalog.measures?.get(column.toLowerCase()) ?? catalog.measures?.get(column.trim().toLowerCase());

  if (!meta && measure) {
    const key = `measure|${measure.name.toLowerCase()}`;
    if (seen.has(key) || depth > 8) return { ref: `[${measure.name}]`, kind: 'measure', note: 'already expanded above', children: [] };
    seen.add(key);
    return {
      ref: `[${measure.name}] (measure on ${measure.table})`,
      kind: 'measure',
      dax: measure.dax,
      children: depsOf(measure.dax, null).map((d) => explainColumn(catalog, d.table, d.column, seen, depth + 1)),
    };
  }
  if (!table || !meta) {
    const tm = table ? catalog.tableMeta.get(tkey(table)) : null;
    if (tm && !tm.uc_full_path && tm.source_m && !/^let\b/i.test(tm.source_m.trim())) {
      return {
        ref,
        kind: 'calc_table_column',
        note: `column of DAX calculated table: ${tm.source_m.replace(/\s+/g, ' ').slice(0, 160)}`,
        children: [],
      };
    }
    return { ref, kind: 'missing', note: 'not in the harvested model', children: [] };
  }

  if (meta.calculated_dax?.trim()) {
    const key = `col|${tkey(table)}|${column.toLowerCase()}`;
    if (seen.has(key) || depth > 8) return { ref, kind: 'calculated_column', note: 'already expanded above', children: [] };
    seen.add(key);
    return {
      ref,
      kind: 'calculated_column',
      dax: meta.calculated_dax,
      children: depsOf(meta.calculated_dax, table).map((d) => explainColumn(catalog, d.table, d.column, seen, depth + 1)),
    };
  }

  const tm = catalog.tableMeta.get(tkey(table));
  if (tm && !tm.uc_full_path && tm.source_m && !/^let\b/i.test(tm.source_m.trim())) {
    return { ref, kind: 'calc_table_column', note: `column of DAX calculated table`, children: [] };
  }
  const lineage = parseMLineage(tm?.source_m ?? null, catalog.rules);
  const relation = lineage.nativeSql
    ? `native query: ${lineage.nativeSql.replace(/\s+/g, ' ').slice(0, 140)}`
    : (tm?.uc_full_path ?? 'unbound (no warehouse source)');
  const mName = meta.source_column?.trim() || column;
  const expr = lineage.column(mName);
  if ('error' in expr) return { ref, kind: 'pq_derived_column', note: expr.error, children: [] };
  const plain = expr.sql === `\`${mName}\``;
  const known = new Set((tm?.warehouse_columns ?? []).map((c) => c.toLowerCase()));
  const missingLeaves = known.size ? expr.leaves.filter((l) => !known.has(l.toLowerCase())) : [];
  return {
    ref,
    kind: plain ? 'warehouse_column' : 'pq_derived_column',
    warehouse: { expr: expr.sql, sourceColumns: expr.leaves, relation },
    note: missingLeaves.length ? `source column(s) not in the warehouse catalog: ${missingLeaves.join(', ')}` : undefined,
    children: [],
  };
}

export type ColumnExplanation = {
  tree: LineageNode;
  sql: string | null;
  compileError: string | null;
};

export function explainCalculatedColumn(
  catalog: MeasureLogicCatalog,
  table: string,
  column: string,
): ColumnExplanation {
  const tree = explainColumn(catalog, table, column);
  const out = compileRowExpressionsToSql({
    tableName: table,
    exprs: [`'${normalizePbiTableName(table)}'[${column}]`],
    idColumn: null,
    catalog,
  });
  return { tree, sql: out.ok ? out.sql : null, compileError: out.ok ? null : out.reason };
}

const KIND_LABEL: Record<LineageKind, string> = {
  calculated_column: 'CALC COLUMN',
  measure: 'MEASURE',
  warehouse_column: 'WAREHOUSE',
  pq_derived_column: 'POWER QUERY',
  calc_table_column: 'CALC TABLE',
  missing: 'MISSING',
};

/** Indented text rendering of the lineage tree. */
export function renderLineage(node: LineageNode, indent = ''): string {
  const lines = [`${indent}${KIND_LABEL[node.kind].padEnd(12)} ${node.ref}`];
  const pad = `${indent}             `;
  if (node.dax) lines.push(`${pad}DAX: ${node.dax.replace(/\s+/g, ' ').slice(0, 220)}`);
  if (node.warehouse) {
    lines.push(`${pad}SQL: ${node.warehouse.expr}  (source: ${node.warehouse.relation})`);
  }
  if (node.note) lines.push(`${pad}NOTE: ${node.note}`);
  for (const c of node.children) lines.push(renderLineage(c, `${indent}   `));
  return lines.join('\n');
}
