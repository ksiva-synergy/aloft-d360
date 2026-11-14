/**
 * L1 model graph (Architecture v2): one typed, hashed picture of a Power BI model.
 *
 * Nodes: tables, warehouse columns, calculated columns, calculated tables, measures.
 * Edges: what each DAX expression reads (table-qualified, resolved like DAX does), plus each
 * column's table. Every node has a content hash; a measure's dependency hash covers its whole
 * closure, so a run recompiles only measures whose inputs actually changed.
 * Pure — built from the harvested catalog.
 */

import { createHash } from 'node:crypto';

import { collectColumnRefs, parseDax } from '@/lib/powerbi/dax-parse';
import { parseMLineage } from '@/lib/powerbi/m-lineage';
import type { MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { normalizePbiTableName } from '@/lib/powerbi/translate-dax-refs';

export type GraphNodeKind = 'table' | 'calc_table' | 'column' | 'calc_column' | 'measure' | 'missing';

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  table: string | null;
  name: string;
  /** Hash of the node's own content (DAX, source, lineage, type). */
  hash: string;
  deps: string[];
  /** DAX that failed to parse (node still present; dependents are flagged by the gate). */
  parseError?: string;
};

export type ModelGraph = {
  nodes: Map<string, GraphNode>;
  /** Hash covering a node and everything it depends on (transitively). */
  dependencyHash: (id: string) => string;
  closure: (id: string) => Set<string>;
  measureId: (name: string) => string;
};

const h = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const tkey = (t: string) => normalizePbiTableName(t).toLowerCase();

export const tableNodeId = (table: string) => `t:${tkey(table)}`;
export const columnNodeId = (table: string, column: string) => `c:${tkey(table)}/${column.trim().toLowerCase()}`;
export const measureNodeId = (name: string) => `m:${name.trim().toLowerCase()}`;

function isDaxCalculatedTable(meta: { uc_full_path: string | null; source_m: string | null }): boolean {
  const src = meta.source_m?.trim().replace(/^calculated\s+source\s*=\s*/i, '') ?? '';
  return !meta.uc_full_path && Boolean(src) && !/^let\b/i.test(src) && !/\bTable\.\w+\s*\(/.test(src);
}

export function buildModelGraph(catalog: MeasureLogicCatalog): ModelGraph {
  const nodes = new Map<string, GraphNode>();
  const relSig = h(
    (catalog.relationships ?? [])
      .map((r) => `${tkey(r.fromTable)}.${r.fromColumn}>${tkey(r.toTable)}.${r.toColumn}:${r.both}:${r.active}`)
      .sort()
      .join('|'),
  );

  const columnKey = (table: string, column: string): string | null => {
    const cols = catalog.columnsByTable.get(tkey(table));
    if (!cols) return null;
    if (cols.has(column)) return column;
    const want = column.trim().toLowerCase();
    for (const k of cols.keys()) if (k.trim().toLowerCase() === want) return k;
    return null;
  };
  const measureOf = (name: string) =>
    catalog.measures?.get(name.toLowerCase()) ?? catalog.measures?.get(name.trim().toLowerCase());

  /** Resolve DAX refs the way DAX does: Table[x] = column, else Table[Measure]; [x] = home column, else measure. */
  const depsOfDax = (dax: string, homeTable: string | null): { deps: string[]; parseError?: string } => {
    let refs: { table: string | null; column: string }[];
    try {
      refs = collectColumnRefs(parseDax(dax));
    } catch (e) {
      return { deps: [], parseError: (e as Error).message };
    }
    const deps = new Set<string>();
    for (const r of refs) {
      const table = r.table ?? homeTable;
      if (table && columnKey(table, r.column)) {
        deps.add(columnNodeId(table, r.column));
      } else if (measureOf(r.column)) {
        deps.add(measureNodeId(r.column));
      } else if (table && catalog.tableMeta.get(tkey(table)) && isDaxCalculatedTable(catalog.tableMeta.get(tkey(table))!)) {
        deps.add(tableNodeId(table)); // column produced by a calculated table expression
      } else {
        const id = `x:${r.table ? `${tkey(r.table)}/` : ''}${r.column.toLowerCase()}`;
        if (!nodes.has(id)) {
          nodes.set(id, { id, kind: 'missing', table: r.table, name: r.column, hash: 'missing', deps: [] });
        }
        deps.add(id);
      }
    }
    return { deps: [...deps] };
  };

  // tables
  for (const [key, meta] of catalog.tableMeta) {
    const calc = isDaxCalculatedTable(meta);
    const src = meta.source_m ?? '';
    const node: GraphNode = {
      id: `t:${key}`,
      kind: calc ? 'calc_table' : 'table',
      table: meta.displayName,
      name: meta.displayName,
      hash: h(`${src}\0${meta.uc_full_path ?? ''}\0${[...(meta.warehouse_columns ?? [])].sort().join(',')}`),
      deps: [],
    };
    if (calc) {
      const d = depsOfDax(src.replace(/^calculated\s+source\s*=\s*/i, ''), null);
      node.deps = d.deps;
      if (d.parseError) node.parseError = d.parseError;
    } else if (src.trim()) {
      // Power Query reads of other tables (Source = OtherQuery, merged queries) are dependencies too.
      const lin = parseMLineage(src);
      for (const ref of [lin.baseTable, ...lin.joins.map((j) => j.table)]) {
        if (ref && catalog.tableMeta.has(tkey(ref))) node.deps.push(tableNodeId(ref));
      }
    }
    nodes.set(node.id, node);
  }

  // columns (calculated or warehouse-backed)
  for (const [tk, cols] of catalog.columnsByTable) {
    const seen = new Set<string>();
    for (const [name, meta] of cols) {
      const id = columnNodeId(tk, name);
      if (seen.has(id)) continue; // map holds both exact and lower-case keys
      seen.add(id);
      const tableName = catalog.tableMeta.get(tk)?.displayName ?? tk;
      const calc = Boolean(meta.calculated_dax?.trim());
      const node: GraphNode = {
        id,
        kind: calc ? 'calc_column' : 'column',
        table: tableName,
        name,
        hash: h(`${meta.source_column ?? ''}\0${meta.calculated_dax ?? ''}\0${meta.data_type ?? ''}`),
        deps: [`t:${tk}`],
      };
      if (calc) {
        const d = depsOfDax(meta.calculated_dax!, tableName);
        node.deps.push(...d.deps);
        if (d.parseError) node.parseError = d.parseError;
      }
      nodes.set(id, node);
    }
  }

  // measures
  for (const m of catalog.measures?.values() ?? []) {
    const d = depsOfDax(m.dax, null);
    nodes.set(measureNodeId(m.name), {
      id: measureNodeId(m.name),
      kind: 'measure',
      table: m.table,
      name: m.name,
      hash: h(m.dax),
      deps: d.deps,
      ...(d.parseError ? { parseError: d.parseError } : {}),
    });
  }

  const closureCache = new Map<string, Set<string>>();
  const closure = (id: string): Set<string> => {
    const hit = closureCache.get(id);
    if (hit) return hit;
    const out = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (out.has(cur)) continue;
      out.add(cur);
      for (const d of nodes.get(cur)?.deps ?? []) stack.push(d);
    }
    closureCache.set(id, out);
    return out;
  };

  const dependencyHash = (id: string): string =>
    h(
      [...closure(id)]
        .sort()
        .map((n) => `${n}=${nodes.get(n)?.hash ?? 'missing'}`)
        .join('|') + `\0rel=${relSig}`,
    );

  return { nodes, dependencyHash, closure, measureId: measureNodeId };
}
