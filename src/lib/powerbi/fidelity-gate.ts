/**
 * L0 fidelity gate (Architecture v2): is the harvested model trustworthy enough to compile?
 *
 * Checks the model as data, before any SQL is generated, and attaches every issue to exactly the
 * measures whose dependency closure (L1 model graph) touches it:
 *   - DAX that does not parse / empty measure bodies / TMDL property text leaked into DAX
 *   - references the graph cannot resolve (warn — may be ADDCOLUMNS / VAR column names)
 *   - source-system classification of each table (Databricks, Snowflake, SQL Server, file, …)
 *   - replica schema check: every Power Query input column of a bound table must exist in the
 *     bound warehouse object (replica drift such as a column split or rename in the replica),
 *     with the closest warehouse columns as suggestions
 *   - Power Query steps lineage does not model (warn; the compiler reports it precisely)
 *   - tables whose data is not in any warehouse (Excel / CSV on SharePoint, web, folders,
 *     dataflows …), traced through helper queries — nothing on Databricks to compile against
 * Pure — no DB or warehouse access.
 */

import type { MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { parseMLineage } from '@/lib/powerbi/m-lineage';
import { buildModelGraph, type ModelGraph, measureNodeId } from '@/lib/powerbi/model-graph';
import { describeOrigin, describeSourceOrigins, isOutsideWarehouse, originTitle } from '@/lib/powerbi/source-origin';
import { normalizePbiTableName } from '@/lib/powerbi/translate-dax-refs';

export const FIDELITY_GATE_VERSION = '2026-11-15.source-origin';

export type FidelityIssueKind =
  | 'dax_parse_error'
  | 'empty_measure'
  | 'tmdl_leak'
  | 'unresolved_reference'
  | 'replica_drift'
  | 'pq_unsupported'
  | 'source_not_in_warehouse';

export type FidelityIssue = {
  kind: FidelityIssueKind;
  /** block: compiling would produce wrong or failing SQL; warn: informational. */
  severity: 'block' | 'warn';
  /** Graph node the issue sits on. */
  node: string;
  table: string | null;
  object: string;
  detail: string;
  suggestion?: string;
};

export type SourceSystem =
  | 'databricks'
  | 'snowflake'
  | 'sql_server'
  | 'native_query'
  | 'dataflow'
  | 'embedded'
  | 'file'
  | 'web'
  | 'dax_calculated'
  | 'unknown';

export type FidelityReport = {
  version: string;
  issues: FidelityIssue[];
  /** lower(measure name) → indexes into issues (only measures with at least one issue). */
  byMeasure: Record<string, number[]>;
  /** measure names blocked by at least one blocking issue. */
  blocked: string[];
  sources: Record<string, SourceSystem>;
  counts: Partial<Record<FidelityIssueKind, number>>;
};

const tkey = (t: string) => normalizePbiTableName(t).toLowerCase();
const normCol = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** TMDL object properties that must never appear inside a DAX body. */
const TMDL_LEAK_RE =
  /^\s*(formatString|displayFolder|lineageTag|annotation|dataType|summarizeBy|isHidden|sourceColumn|changedProperty|dataCategory)\s*[:=]/m;

export function classifySource(sourceM: string | null, ucBound: boolean): SourceSystem {
  const src = sourceM?.trim().replace(/^calculated\s+source\s*=\s*/i, '') ?? '';
  if (!src) return ucBound ? 'databricks' : 'unknown';
  if (/\bDatabricks\.(Catalogs|Query|Contents)\b/i.test(src)) return 'databricks';
  if (/\bSnowflake\.Databases\b/i.test(src)) return 'snowflake';
  if (/\b(Sql\.Databases?|AzureSql)\b/i.test(src)) return 'sql_server';
  if (/Value\.NativeQuery\s*\(/i.test(src)) return 'native_query';
  if (/\bPowerPlatform\.Dataflows\b|\bPowerBI\.Dataflows\b/i.test(src)) return 'dataflow';
  if (/\bTable\.FromRows\s*\(\s*Json\.Document\s*\(\s*Binary\.Decompress/i.test(src)) return 'embedded';
  if (/\b(Excel\.Workbook|Csv\.Document|SharePoint\.|File\.Contents|Folder\.Files)\b/i.test(src)) return 'file';
  if (/\bWeb\.Contents\b/i.test(src)) return 'web';
  if (!/^let\b/i.test(src) && !/\bTable\.\w+\s*\(/.test(src)) return 'dax_calculated';
  return ucBound ? 'databricks' : 'unknown';
}

export function isPassthroughQuery(sql: string): boolean {
  return /^\s*SELECT\s+\*\s+FROM\s+[\w."`\[\]]+\s*;?\s*$/i.test(sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
}

/**
 * A combined source column the replica split in two: `…_HEATING_OR_DISCHARGING_…` → both
 * `…_HEATING_…` and `…_DISCHARGING_…` exist. Generic over any `_OR_` / `_AND_` joiner.
 */
export function detectSplitColumn(missing: string, warehouse: string[]): [string, string] | null {
  const have = new Map(warehouse.map((c) => [c.toLowerCase(), c]));
  const parts = missing.split('_');
  for (let i = 1; i < parts.length - 1; i++) {
    if (!/^(or|and)$/i.test(parts[i]!)) continue;
    const a = [...parts.slice(0, i), ...parts.slice(i + 2)].join('_');
    const b = [...parts.slice(0, i - 1), ...parts.slice(i + 1)].join('_');
    const ha = have.get(a.toLowerCase());
    const hb = have.get(b.toLowerCase());
    if (ha && hb) return [ha, hb];
  }
  return null;
}

function driftSuggestion(leaf: string, warehouse: string[]): string {
  const split = detectSplitColumn(leaf, warehouse);
  if (split) {
    return `Replica split this column: likely ${split[0]} + ${split[1]} (sum, NULL as 0) — confirm with the data steward, then register the mapping`;
  }
  const near = suggestColumns(leaf, warehouse);
  return near.length
    ? `Replica schema differs from the Power BI source. Closest warehouse columns: ${near.join(', ')} — confirm the mapping with the data steward`
    : 'Replica schema differs from the Power BI source — add the column to the replica or map it (steward)';
}

/** Warehouse columns sharing the most name tokens with a missing column (e.g. a split column). */
export function suggestColumns(missing: string, warehouse: string[], max = 3): string[] {
  const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1));
  const want = tokens(missing);
  if (!want.size) return [];
  return warehouse
    .map((c) => {
      const have = tokens(c);
      let shared = 0;
      for (const t of want) if (have.has(t)) shared++;
      return { c, score: shared / Math.max(want.size, have.size) };
    })
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.c.localeCompare(b.c))
    .slice(0, max)
    .map((x) => x.c);
}

export function buildFidelityReport(
  catalog: MeasureLogicCatalog,
  opts: {
    graph?: ModelGraph;
    /** Resolver-approved leaf → warehouse column mappings (table key → lower leaf → column). */
    columnOverrides?: Record<string, Record<string, string>>;
  } = {},
): FidelityReport {
  const graph = opts.graph ?? buildModelGraph(catalog);
  const issues: FidelityIssue[] = [];
  const sources: Record<string, SourceSystem> = {};

  const stripComments = (dax: string) =>
    dax.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(\/\/|--).*$/gm, '').trim();
  const emptyBodies = new Set(
    [...(catalog.measures?.values() ?? [])].filter((m) => !stripComments(m.dax)).map((m) => m.name.toLowerCase()),
  );

  // DAX-level checks on every node that carries DAX
  for (const node of graph.nodes.values()) {
    if (node.kind === 'missing') {
      issues.push({
        kind: 'unresolved_reference',
        severity: 'warn',
        node: node.id,
        table: node.table,
        object: node.table ? `${node.table}[${node.name}]` : `[${node.name}]`,
        detail: 'Reference matches no column, measure or calculated-table column in the harvested model',
        suggestion: 'If it is not an ADDCOLUMNS/SELECTCOLUMNS name, re-run pbi_definitions + pbi_parse (force_parse)',
      });
    }
    const emptyMeasure = node.kind === 'measure' && emptyBodies.has(node.name.toLowerCase());
    if (node.parseError && !emptyMeasure) {
      issues.push({
        kind: 'dax_parse_error',
        severity: 'block',
        node: node.id,
        table: node.table,
        object: node.kind === 'measure' ? node.name : `${node.table}[${node.name}]`,
        detail: node.parseError.slice(0, 300),
        suggestion: 'Check the harvested DAX for truncation or leaked TMDL text; re-run pbi_parse (force_parse)',
      });
    }
  }
  for (const m of catalog.measures?.values() ?? []) {
    if (emptyBodies.has(m.name.toLowerCase())) {
      issues.push({
        kind: 'empty_measure',
        severity: 'block',
        node: measureNodeId(m.name),
        table: m.table,
        object: m.name,
        detail: 'Measure body is empty or fully commented out',
        suggestion: 'Retire the measure or restore its DAX in Power BI',
      });
    }
    if (TMDL_LEAK_RE.test(m.dax)) {
      issues.push({
        kind: 'tmdl_leak',
        severity: 'block',
        node: measureNodeId(m.name),
        table: m.table,
        object: m.name,
        detail: `TMDL property text inside the DAX body: ${m.dax.match(TMDL_LEAK_RE)![0].trim()}`,
        suggestion: 'Harvest parser bug — re-run pbi_parse (force_parse) after updating tmdl-parse',
      });
    }
  }

  // Table-level checks: source system + replica schema
  for (const [tk, meta] of catalog.tableMeta) {
    sources[meta.displayName] = classifySource(meta.source_m, Boolean(meta.uc_full_path));
    if (!meta.uc_full_path && meta.source_m) {
      const origins = describeSourceOrigins(meta.source_m, catalog.sourceQueries, { selfName: meta.displayName });
      const outside = origins.filter(isOutsideWarehouse);
      if (outside.length && outside.length === origins.length) {
        issues.push({
          kind: 'source_not_in_warehouse',
          severity: 'block',
          node: `t:${tk}`,
          table: meta.displayName,
          object: meta.displayName,
          detail: `${meta.displayName} is loaded from ${outside.map(describeOrigin).join('; ')} — not in the warehouse`,
          suggestion: `Load this ${originTitle(outside[0]!).toLowerCase()} into Databricks (a Unity Catalog table), then point the Power BI query at it or bind the table in Catalog link`,
        });
      }
    }
    if (!meta.uc_full_path || !meta.source_m) continue;
    const warehouse = meta.warehouse_columns ?? [];
    if (!warehouse.length) continue; // warehouse schema unknown — nothing to compare against
    const lineage = parseMLineage(meta.source_m, catalog.rules);
    // A native query defines its own columns; only a plain passthrough (SELECT * FROM one table)
    // exposes exactly the bound object's columns and can be checked against it.
    if (lineage.nativeSql && !isPassthroughQuery(lineage.nativeSql)) continue;
    const tableNode = `t:${tk}`;
    if (lineage.unsupported.length) {
      issues.push({
        kind: 'pq_unsupported',
        severity: 'warn',
        node: tableNode,
        table: meta.displayName,
        object: meta.displayName,
        detail: lineage.unsupported.join('; ').slice(0, 300),
      });
      continue;
    }
    const known = new Set(warehouse.map((c) => c.toLowerCase()));
    const knownNorm = new Set(warehouse.map(normCol));
    const overrides = opts.columnOverrides?.[tk] ?? {};
    const isMissing = (leaf: string) => {
      const ll = leaf.toLowerCase();
      return !(known.has(ll) || knownNorm.has(normCol(leaf)) || overrides[ll]);
    };
    // Row filters apply to every row of the table, so a drifted filter column blocks all its measures.
    for (const leaf of new Set(lineage.where.flatMap((w) => w.leaves))) {
      if (!isMissing(leaf)) continue;
      issues.push({
        kind: 'replica_drift',
        severity: 'block',
        node: tableNode,
        table: meta.displayName,
        object: meta.displayName,
        detail: `Power Query row filter reads source column ${leaf}, which does not exist in ${meta.uc_full_path}`,
        suggestion: driftSuggestion(leaf, warehouse),
      });
    }
    const cols = catalog.columnsByTable.get(tk);
    if (!cols) continue;
    const seen = new Set<string>();
    for (const [name, col] of cols) {
      const lk = name.trim().toLowerCase();
      if (seen.has(lk) || col.calculated_dax?.trim()) continue;
      seen.add(lk);
      const expr = lineage.column(col.source_column?.trim() || name);
      if ('error' in expr) continue; // compiler reports lineage errors precisely
      for (const leaf of new Set(expr.leaves)) {
        if (!isMissing(leaf)) continue;
        issues.push({
          kind: 'replica_drift',
          severity: 'block',
          node: `c:${tk}/${lk}`,
          table: meta.displayName,
          object: `${meta.displayName}[${name}]`,
          detail: `Power Query reads source column ${leaf}, which does not exist in ${meta.uc_full_path}`,
          suggestion: driftSuggestion(leaf, warehouse),
        });
      }
    }
  }

  // Attach issues to measures through their dependency closure.
  const issuesByNode = new Map<string, number[]>();
  issues.forEach((iss, i) => {
    const list = issuesByNode.get(iss.node) ?? [];
    list.push(i);
    issuesByNode.set(iss.node, list);
  });
  const byMeasure: Record<string, number[]> = {};
  const blocked: string[] = [];
  for (const m of catalog.measures?.values() ?? []) {
    const hit: number[] = [];
    for (const id of graph.closure(measureNodeId(m.name))) hit.push(...(issuesByNode.get(id) ?? []));
    if (!hit.length) continue;
    byMeasure[m.name.toLowerCase()] = [...new Set(hit)].sort((a, b) => a - b);
    if (hit.some((i) => issues[i]!.severity === 'block')) blocked.push(m.name);
  }

  const counts: Partial<Record<FidelityIssueKind, number>> = {};
  for (const iss of issues) counts[iss.kind] = (counts[iss.kind] ?? 0) + 1;
  return { version: FIDELITY_GATE_VERSION, issues, byMeasure, blocked: blocked.sort(), sources, counts };
}

/** The blocking issues behind one measure (empty when it may be compiled). */
export function blockingIssuesFor(report: FidelityReport, measureName: string): FidelityIssue[] {
  return (report.byMeasure[measureName.toLowerCase()] ?? [])
    .map((i) => report.issues[i]!)
    .filter((iss) => iss.severity === 'block');
}
