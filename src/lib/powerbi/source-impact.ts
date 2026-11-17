/**
 * Reverse lineage across the estate, browsable by each source system's own hierarchy:
 *   Databricks → workspace → catalog → schema → table
 *   SQL Server / Oracle / … → server → database → schema → table
 *   SharePoint → site → folder → file → sheet
 * For any node of that tree (a whole schema, a site, one table), every model table that reads
 * it, the report measures that use those tables, and the reports. Built from stored report
 * lineage snapshots; pure (the SQL lives in the impact route). Generic over connectors: levels
 * come only from the parsed origin fields (location, database, object, folder, file, items).
 */

import { originClass, systemLabel, type OriginClass, type OriginSystem, type SourceOrigin } from '@/lib/powerbi/source-origin';
import {
  ORIGIN_CLASS_ORDER,
  isShareableOrigin,
  originGroup,
  originKey,
  originNodeSubtitle,
  originNodeTitle,
  relativeFolder,
  shortLocation,
  tableKey,
} from '@/lib/powerbi/report-lineage-graph';

/** One snapshot source table × origin, as extracted from `pbi_report_lineage.lineage`. */
export type ImpactRow = {
  report_id: string;
  report_name: string;
  status: string;
  model_id: string | null;
  model_name: string | null;
  table: string;
  refs: unknown;
  origin: unknown;
};

export type PathSegment = { level: string; label: string };

export type SourceTreeNode = {
  id: string;
  parent: string | null;
  depth: number;
  level: string;
  label: string;
  system: string;
  system_label: string;
  cls: OriginClass;
  leaf: boolean;
  /** Distinct original sources (tables, files, sheets) at or under this node. */
  sources: number;
  /** The level of the leaves under this node ("Table", "Sheet"...), or null when they are mixed. */
  leaf_level: string | null;
  reports: number;
  models: number;
  tables: number;
  /** Distinct report measures reading the model tables under this node. */
  measures: number;
};

export type ImpactSource = {
  id: string; key: string; title: string; subtitle: string | null; group: string;
  /** Levels between the scope and this source (the schema under a catalog), for grouping the lane. */
  path: string | null;
  cls: OriginClass; system: string;
};

export type ImpactFocusKind = 'source' | 'table' | 'measure' | 'report';

/** One leaf of the tree under the scope (a table, file, sheet...) with what depends on it. */
export type ImpactSourceRow = {
  id: string;
  label: string;
  /** Levels between the scope and the leaf, e.g. the schema when the scope is a catalog ("prod › gold" for a workspace). */
  path: string | null;
  /** The same levels as tree nodes, outermost first (for grouping the list by catalog / schema). */
  parents: { id: string; level: string; label: string }[];
  level: string;
  models: number;
  tables: number;
  measures: number;
  reports: number;
};

/** One affected report, with how much of the scope it reads. */
export type ImpactReportRow = {
  id: string;
  name: string;
  status: string;
  model_name: string | null;
  /** Leaves under the scope the report reads. */
  sources: number;
  measures: number;
};

export type SourceImpact = {
  scope: { id: string; level: string; label: string; leaf: boolean; system: string; system_label: string; cls: OriginClass };
  breadcrumb: { id: string; level: string; label: string }[];
  /** Level of the leaves under the scope ("Table"...), or null when mixed. */
  leaf_level: string | null;
  /** Everything under the scope. The graph lanes below are capped; these are not. */
  totals: { sources: number; leaves: number; tables: number; measures: number; reports: number; models: number };
  /** The graph node the graph is narrowed to (only paths through it are drawn), or null for the whole scope. */
  focus: { id: string; kind: ImpactFocusKind; label: string } | null;
  // Graph lanes: the most-used nodes only (MAX_DRAWN per lane), each connected to something drawn upstream.
  sources: ImpactSource[];
  hidden_sources: number;
  tables: { id: string; name: string; model_id: string | null; model_name: string | null }[];
  hidden_tables: number;
  measures: { id: string; name: string; model_name: string | null; table_ids: string[] }[];
  hidden_measures: number;
  /** `measure_ids` / `model_wide_table_ids` hold drawn nodes only; `measure_count` counts every detected measure. */
  reports: { id: string; name: string; status: string; model_name: string | null; measure_ids: string[]; model_wide_table_ids: string[]; measure_count: number }[];
  hidden_reports: number;
  edges: { from: string; to: string; kind: 'detected' | 'model_wide'; cls: OriginClass }[];
  /** Every leaf under the scope, most-used first (up to MAX_LIST_ROWS). */
  source_rows: ImpactSourceRow[];
  /** Every affected report, reading the most of the scope first (up to MAX_LIST_ROWS). */
  report_rows: ImpactReportRow[];
};

/** Separator between path labels in node ids (never appears in names; URL-encoded in links). */
export const NODE_SEP = '\u001f';
/** Nodes drawn per graph lane. Broad scopes (a catalog of hundreds of tables) are browsed as lists instead. */
export const MAX_DRAWN = 40;
export const MAX_LIST_ROWS = 5000;

const DB_LEVELS: Partial<Record<OriginSystem, [string, string]>> = {
  databricks: ['Workspace', 'Catalog'],
  fabric: ['Workspace', 'Item'],
  snowflake: ['Account', 'Database'],
};

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/** Snapshot JSON → a complete SourceOrigin (older snapshots may omit list fields). */
export function normalizeOrigin(value: unknown): SourceOrigin | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const system = str(o.system);
  if (!system) return null;
  return {
    system: system as SourceOrigin['system'],
    connector: str(o.connector),
    format: (str(o.format) as SourceOrigin['format']) ?? null,
    location: str(o.location),
    folder: str(o.folder),
    file: str(o.file),
    items: Array.isArray(o.items)
      ? o.items.flatMap((item) => (item && typeof item === 'object' && str((item as Record<string, unknown>).name)
        ? [{ name: str((item as Record<string, unknown>).name)!, kind: str((item as Record<string, unknown>).kind) }] : []))
      : [],
    database: str(o.database),
    object: str(o.object),
    query: str(o.query),
    via: Array.isArray(o.via) ? o.via.filter((v): v is string => typeof v === 'string') : [],
  };
}

const seg = (level: string, label: string | null | undefined): PathSegment[] => (label?.trim() ? [{ level, label: label.trim() }] : []);

function parentPath(path: string | null): string | null {
  if (!path) return null;
  const trimmed = path.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return cut > 0 ? trimmed.slice(0, cut) : null;
}

function urlPath(url: string | null): string | null {
  const path = url?.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+([^?#]*)/i)?.[1]?.replace(/^\/+|\/+$/g, '');
  return path || null;
}

/** Where a source sits in its system's hierarchy, from the system down to the table / file / sheet. */
export function originPath(origin: SourceOrigin): PathSegment[] {
  const system: PathSegment = { level: 'System', label: systemLabel(origin.system) };
  const items = origin.items.map((item) => item.name).join(', ') || null;
  if (originClass(origin) === 'file') {
    switch (origin.system) {
      case 'dataflow':
        return [system, ...seg('Workspace', origin.location ?? 'Workspace not recorded'), ...seg('Dataflow', origin.database), ...seg('Entity', origin.object ?? 'All entities')];
      case 'sharepoint':
      case 'onedrive':
        return [system, ...seg('Site', shortLocation(origin.location) ?? 'Site not recorded'), ...seg('Folder', relativeFolder(origin.folder, origin.location)),
          ...seg('File', origin.file ?? (origin.format === 'list' ? 'List' : 'All files')), ...seg('Sheet', items)];
      case 'web':
      case 'odata':
        return [system, ...seg('Host', shortLocation(origin.location) ?? 'URL not recorded'),
          ...seg(origin.system === 'odata' ? 'Feed' : 'File', origin.file ?? urlPath(origin.location) ?? 'Root'), ...seg('Sheet', items)];
      default: {
        const folder = origin.system === 'local_file' ? parentPath(origin.location) : origin.location;
        return [system, ...seg('Folder', folder ?? 'Path not recorded'), ...seg('File', origin.file ?? 'All files'), ...seg('Sheet', items)];
      }
    }
  }
  const [hostLevel, dbLevel] = DB_LEVELS[origin.system] ?? ['Server', 'Database'];
  let object = origin.object;
  if (object && origin.database && object.toLowerCase().startsWith(`${origin.database.toLowerCase()}.`)) object = object.slice(origin.database.length + 1);
  const parts = object ? object.split('.').map((part) => part.trim()).filter(Boolean) : [];
  const table = parts.at(-1) ?? (origin.query ? 'Native query' : 'Whole database');
  return [
    system,
    ...seg(hostLevel, shortLocation(origin.location) ?? `${hostLevel} not recorded`),
    ...seg(dbLevel, origin.database),
    ...seg('Schema', parts.length > 1 ? parts.slice(0, -1).join('.') : null),
    ...seg('Table', table),
  ];
}

const pathIds = (origin: SourceOrigin, path: PathSegment[]) =>
  path.map((_, depth) => [origin.system, ...path.slice(1, depth + 1).map((s) => s.label)].join(NODE_SEP));

type Keyed = { row: ImpactRow; origin: SourceOrigin; key: string; path: PathSegment[]; ids: string[] };

// Derived once per rows array (the route caches rows briefly, so repeated clicks reuse this).
const keyedCache = new WeakMap<ImpactRow[], Keyed[]>();
const treeCache = new WeakMap<ImpactRow[], SourceTreeNode[]>();

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}

function setAdd<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  const set = map.get(key);
  if (set) set.add(value); else map.set(key, new Set([value]));
}

function keyed(rows: ImpactRow[]): Keyed[] {
  const cached = keyedCache.get(rows);
  if (cached) return cached;
  const out: Keyed[] = [];
  for (const row of rows) {
    const origin = normalizeOrigin(row.origin);
    if (!origin || !isShareableOrigin(origin)) continue;
    const path = originPath(origin);
    out.push({ row, origin, key: originKey(origin), path, ids: pathIds(origin, path) });
  }
  keyedCache.set(rows, out);
  return out;
}

const modelTableId = (row: ImpactRow) => `t:${row.model_id ?? row.model_name ?? '?'}|${tableKey(row.table)}`;
const modelOf = (row: ImpactRow) => row.model_id ?? row.model_name ?? '?';
const refsOf = (row: ImpactRow) => (Array.isArray(row.refs) ? row.refs.filter((v): v is string => typeof v === 'string') : []);
const measureIdOf = (row: ImpactRow, name: string) => `m:${modelOf(row)}|${name.trim().toLowerCase()}`;
const measureIdsOf = (row: ImpactRow) => refsOf(row).map((name) => measureIdOf(row, name));

/** The browse tree: every node with its counts, in display order (depth-first, most-used first). */
export function buildSourceTree(rows: ImpactRow[]): SourceTreeNode[] {
  const cached = treeCache.get(rows);
  if (cached) return cached;
  type Agg = Omit<SourceTreeNode, 'sources' | 'leaf_level' | 'reports' | 'models' | 'tables' | 'measures'>
    & { keys: Set<string>; levels: Set<string>; r: Set<string>; m: Set<string>; t: Set<string>; ms: Set<string> };
  const nodes = new Map<string, Agg>();
  for (const entry of keyed(rows)) {
    const leafLevel = entry.path.at(-1)!.level;
    const measureIds = measureIdsOf(entry.row);
    entry.path.forEach((segment, depth) => {
      const id = entry.ids[depth]!;
      let node = nodes.get(id);
      if (!node) {
        node = {
          id, parent: depth ? entry.ids[depth - 1]! : null, depth, level: segment.level, label: segment.label,
          system: entry.origin.system, system_label: systemLabel(entry.origin.system), cls: originClass(entry.origin),
          leaf: true, keys: new Set(), levels: new Set(), r: new Set(), m: new Set(), t: new Set(), ms: new Set(),
        };
        nodes.set(id, node);
      }
      if (depth < entry.path.length - 1) node.leaf = false;
      node.keys.add(entry.key);
      node.levels.add(leafLevel);
      node.r.add(entry.row.report_id);
      node.m.add(modelOf(entry.row));
      node.t.add(modelTableId(entry.row));
      for (const measureId of measureIds) node.ms.add(measureId);
    });
  }
  const children = new Map<string | null, Agg[]>();
  for (const node of nodes.values()) push(children, node.parent, node);
  const order = (list: Agg[]) => list.sort((a, b) => (a.depth === 0 ? ORIGIN_CLASS_ORDER.indexOf(a.cls) - ORIGIN_CLASS_ORDER.indexOf(b.cls) : 0)
    || b.r.size - a.r.size || a.label.localeCompare(b.label));
  const out: SourceTreeNode[] = [];
  const visit = (parent: string | null) => {
    for (const node of order(children.get(parent) ?? [])) {
      const { keys, levels, r, m, t, ms, ...rest } = node;
      out.push({
        ...rest, sources: keys.size, leaf_level: levels.size === 1 ? [...levels][0]! : null,
        reports: r.size, models: m.size, tables: t.size, measures: ms.size,
      });
      visit(node.id);
    }
  };
  visit(null);
  treeCache.set(rows, out);
  return out;
}

/** The tree node id holding a source key (used by links from a report's lineage page). */
export function nodeIdForKey(rows: ImpactRow[], key: string): string | null {
  const entry = keyed(rows).find((candidate) => candidate.key === key);
  return entry ? entry.ids.at(-1)! : null;
}

type TableAcc = { id: string; name: string; model_id: string | null; model_name: string | null; reports: Set<string> };
type MeasureAcc = { id: string; name: string; model_name: string | null; tables: Set<string>; reports: Set<string> };
type ReportAcc = { id: string; name: string; status: string; model_name: string | null; measures: Set<string>; wide: Set<string>; leaves: Set<string> };
type LeafAcc = {
  id: string; label: string; path: string | null; parents: ImpactSourceRow['parents']; level: string;
  models: Set<string>; tables: Set<string>; measures: Set<string>; reports: Set<string>;
};
type Acc = {
  tables: Map<string, TableAcc>;
  measures: Map<string, MeasureAcc>;
  reports: Map<string, ReportAcc>;
  leaves: Map<string, LeafAcc>;
  byKey: Map<string, Keyed[]>;
  keyTables: Map<string, Set<string>>;
  models: Set<string>;
};

/** The full dependency graph of some entries (uncapped). `onlyMeasure` keeps a single measure (a measure focus). */
function accumulate(entries: Keyed[], depth: number, onlyMeasure: string | null = null): Acc {
  const acc: Acc = { tables: new Map(), measures: new Map(), reports: new Map(), leaves: new Map(), byKey: new Map(), keyTables: new Map(), models: new Set() };
  for (const entry of entries) {
    const { row, key } = entry;
    push(acc.byKey, key, entry);
    const tableId = modelTableId(row);
    setAdd(acc.keyTables, key, tableId);
    acc.models.add(modelOf(row));
    let table = acc.tables.get(tableId);
    if (!table) acc.tables.set(tableId, (table = { id: tableId, name: row.table, model_id: row.model_id, model_name: row.model_name, reports: new Set() }));
    table.reports.add(row.report_id);
    let report = acc.reports.get(row.report_id);
    if (!report) {
      report = { id: row.report_id, name: row.report_name, status: row.status, model_name: row.model_name, measures: new Set(), wide: new Set(), leaves: new Set() };
      acc.reports.set(row.report_id, report);
    }
    const leafId = entry.ids.at(-1)!;
    report.leaves.add(leafId);
    let leaf = acc.leaves.get(leafId);
    if (!leaf) {
      const last = entry.path.at(-1)!;
      leaf = {
        id: leafId, label: last.label, level: last.level, path: innerPath(entry, depth),
        parents: entry.path.slice(depth + 1, -1).map((s, i) => ({ id: entry.ids[depth + 1 + i]!, level: s.level, label: s.label })),
        models: new Set(), tables: new Set(), measures: new Set(), reports: new Set(),
      };
      acc.leaves.set(leafId, leaf);
    }
    leaf.models.add(modelOf(row));
    leaf.tables.add(tableId);
    leaf.reports.add(row.report_id);
    const refs = refsOf(row);
    if (!refs.length) report.wide.add(tableId);
    for (const name of refs) {
      const measureId = measureIdOf(row, name);
      if (onlyMeasure && measureId !== onlyMeasure) continue;
      let measure = acc.measures.get(measureId);
      if (!measure) acc.measures.set(measureId, (measure = { id: measureId, name, model_name: row.model_name, tables: new Set(), reports: new Set() }));
      measure.tables.add(tableId);
      measure.reports.add(row.report_id);
      report.measures.add(measureId);
      leaf.measures.add(measureId);
    }
  }
  // Model-wide links only count when the report has no detected measure on that table.
  for (const report of acc.reports.values()) {
    if (!report.wide.size || !report.measures.size) continue;
    for (const measureId of report.measures) for (const tableId of acc.measures.get(measureId)!.tables) report.wide.delete(tableId);
  }
  return acc;
}

const innerPath = (entry: Keyed, depth: number) => entry.path.slice(depth + 1, -1).map((s) => s.label).join(' › ') || null;

type Graph = Pick<SourceImpact, 'sources' | 'hidden_sources' | 'tables' | 'hidden_tables' | 'measures' | 'hidden_measures' | 'reports' | 'hidden_reports' | 'edges'>;

/** The drawn graph: per lane, the most-used nodes that connect to something drawn upstream. */
function drawGraph(acc: Acc, depth: number, scopeCls: OriginClass): Graph {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const ranked = [...acc.byKey.entries()].map(([key, list]) => ({ key, list, reports: new Set(list.map((e) => e.row.report_id)).size }))
    .sort((a, b) => b.reports - a.reports || originNodeTitle(a.list[0]!.origin).localeCompare(originNodeTitle(b.list[0]!.origin)));
  const sources: ImpactSource[] = ranked.slice(0, MAX_DRAWN).map(({ key, list }) => {
    const origin = list[0]!.origin;
    return {
      id: `s:${key}`, key, title: originNodeTitle(origin), subtitle: originNodeSubtitle(origin), group: originGroup(origin),
      path: innerPath(list[0]!, depth), cls: originClass(origin), system: origin.system,
    };
  });

  const tableCandidates = new Set<string>();
  for (const source of sources) for (const tableId of acc.keyTables.get(source.key) ?? []) tableCandidates.add(tableId);
  const drawnTables = new Set([...tableCandidates].map((id) => acc.tables.get(id)!)
    .sort((a, b) => b.reports.size - a.reports.size || (a.model_name ?? '').localeCompare(b.model_name ?? '') || byName(a, b))
    .slice(0, MAX_DRAWN).map((table) => table.id));
  const tableList = [...drawnTables].map((id) => acc.tables.get(id)!)
    .sort((a, b) => (a.model_name ?? '').localeCompare(b.model_name ?? '') || byName(a, b))
    .map(({ id, name, model_id, model_name }) => ({ id, name, model_id, model_name }));
  const tableIndex = new Map(tableList.map((table, index) => [table.id, index]));

  const firstTable = (ids: string[]) => ids.reduce((min, id) => Math.min(min, tableIndex.get(id) ?? 0), Infinity);
  const measureList = [...acc.measures.values()].filter((m) => [...m.tables].some((t) => drawnTables.has(t)))
    .sort((a, b) => b.reports.size - a.reports.size || byName(a, b))
    .slice(0, MAX_DRAWN)
    .map((m) => ({ id: m.id, name: m.name, model_name: m.model_name, table_ids: [...m.tables].filter((t) => drawnTables.has(t)) }))
    .map((m) => ({ m, first: firstTable(m.table_ids) }))
    .sort((a, b) => a.first - b.first || byName(a.m, b.m))
    .map(({ m }) => m);

  const detectedFirst = (a: { measure_ids: string[] }, b: { measure_ids: string[] }) => Number(!a.measure_ids.length) - Number(!b.measure_ids.length);
  const reportList = [...acc.reports.values()]
    .map((report) => ({
      report,
      measure_ids: measureList.filter((m) => report.measures.has(m.id)).map((m) => m.id),
      model_wide_table_ids: tableList.filter((t) => report.wide.has(t.id)).map((t) => t.id),
    }))
    .filter((c) => c.measure_ids.length || c.model_wide_table_ids.length)
    .sort((a, b) => detectedFirst(a, b) || b.measure_ids.length - a.measure_ids.length || byName(a.report, b.report))
    .slice(0, MAX_DRAWN)
    .sort((a, b) => detectedFirst(a, b) || byName(a.report, b.report))
    .map(({ report, measure_ids, model_wide_table_ids }) => ({
      id: report.id, name: report.name, status: report.status, model_name: report.model_name,
      measure_ids, model_wide_table_ids, measure_count: report.measures.size,
    }));

  const edges: SourceImpact['edges'] = [];
  for (const source of sources) {
    for (const tableId of acc.keyTables.get(source.key) ?? []) {
      if (drawnTables.has(tableId)) edges.push({ from: source.id, to: tableId, kind: 'detected', cls: source.cls });
    }
  }
  for (const measure of measureList) for (const tableId of measure.table_ids) edges.push({ from: tableId, to: measure.id, kind: 'detected', cls: scopeCls });
  for (const report of reportList) {
    for (const measureId of report.measure_ids) edges.push({ from: measureId, to: report.id, kind: 'detected', cls: scopeCls });
    for (const tableId of report.model_wide_table_ids) edges.push({ from: tableId, to: report.id, kind: 'model_wide', cls: scopeCls });
  }
  return {
    sources, hidden_sources: ranked.length - sources.length,
    tables: tableList, hidden_tables: acc.tables.size - tableList.length,
    measures: measureList, hidden_measures: acc.measures.size - measureList.length,
    reports: reportList, hidden_reports: acc.reports.size - reportList.length,
    edges,
  };
}

/**
 * The entries on the path through one graph node: a source (`s:` id), a model table (`t:`), a
 * measure (`m:`) or a report (its id). Upstream and downstream of it only.
 */
function focusEntries(entries: Keyed[], focus: string): { kind: ImpactFocusKind; label: string; entries: Keyed[]; onlyMeasure: string | null } | null {
  if (focus.startsWith('s:')) {
    const key = focus.slice(2);
    const list = entries.filter((e) => e.key === key);
    return list.length ? { kind: 'source', label: originNodeTitle(list[0]!.origin), entries: list, onlyMeasure: null } : null;
  }
  if (focus.startsWith('t:')) {
    const list = entries.filter((e) => modelTableId(e.row) === focus);
    return list.length ? { kind: 'table', label: list[0]!.row.table, entries: list, onlyMeasure: null } : null;
  }
  if (focus.startsWith('m:')) {
    const list = entries.filter((e) => measureIdsOf(e.row).includes(focus));
    const name = list.length ? refsOf(list[0]!.row).find((ref) => measureIdOf(list[0]!.row, ref) === focus) : null;
    return list.length && name ? { kind: 'measure', label: name, entries: list, onlyMeasure: focus } : null;
  }
  const list = entries.filter((e) => e.row.report_id === focus);
  return list.length ? { kind: 'report', label: list[0]!.row.report_name, entries: list, onlyMeasure: null } : null;
}

/**
 * Everything that depends on a tree node. Totals and lists cover the whole scope; the graph lanes are
 * capped, and with `focus` (a graph node id) the graph shows only the paths through that node.
 */
export function buildSourceImpact(rows: ImpactRow[], nodeId: string, focus: string | null = null): SourceImpact | null {
  const entries = keyed(rows).filter((entry) => entry.ids.includes(nodeId));
  if (!entries.length) return null;
  const head = entries[0]!;
  const depth = head.ids.indexOf(nodeId);
  const scopeSeg = head.path[depth]!;
  const scope = {
    id: nodeId, level: scopeSeg.level, label: scopeSeg.label, system: head.origin.system,
    system_label: systemLabel(head.origin.system), cls: originClass(head.origin),
    leaf: entries.every((entry) => entry.ids.length - 1 === depth),
  };
  const breadcrumb = head.path.slice(0, depth + 1).map((segment, i) => ({ id: head.ids[i]!, level: segment.level, label: segment.label }));

  const acc = accumulate(entries, depth);
  const focused = focus ? focusEntries(entries, focus) : null;
  const graph = drawGraph(focused ? accumulate(focused.entries, depth, focused.onlyMeasure) : acc, depth, scope.cls);

  const leafLevels = new Set([...acc.leaves.values()].map((leaf) => leaf.level));
  const source_rows: ImpactSourceRow[] = [...acc.leaves.values()]
    .map((leaf) => ({
      id: leaf.id, label: leaf.label, path: leaf.path, parents: leaf.parents, level: leaf.level,
      models: leaf.models.size, tables: leaf.tables.size, measures: leaf.measures.size, reports: leaf.reports.size,
    }))
    .sort((a, b) => b.reports - a.reports || a.label.localeCompare(b.label))
    .slice(0, MAX_LIST_ROWS);
  const report_rows: ImpactReportRow[] = [...acc.reports.values()]
    .map((r) => ({ id: r.id, name: r.name, status: r.status, model_name: r.model_name, sources: r.leaves.size, measures: r.measures.size }))
    .sort((a, b) => b.sources - a.sources || a.name.localeCompare(b.name))
    .slice(0, MAX_LIST_ROWS);

  return {
    scope, breadcrumb,
    leaf_level: leafLevels.size === 1 ? [...leafLevels][0]! : null,
    totals: {
      sources: acc.byKey.size, leaves: acc.leaves.size, tables: acc.tables.size, measures: acc.measures.size,
      reports: acc.reports.size, models: acc.models.size,
    },
    focus: focused && focus ? { id: focus, kind: focused.kind, label: focused.label } : null,
    ...graph,
    source_rows, report_rows,
  };
}
