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
  reports: number;
  models: number;
  tables: number;
};

export type ImpactSource = { id: string; key: string; title: string; subtitle: string | null; group: string; cls: OriginClass; system: string };

export type SourceImpact = {
  scope: { id: string; level: string; label: string; leaf: boolean; system: string; system_label: string; cls: OriginClass };
  breadcrumb: { id: string; level: string; label: string }[];
  sources: ImpactSource[];
  /** Sources under the scope that are not drawn (the lane shows the most-used ones). */
  hidden_sources: number;
  tables: { id: string; name: string; model_id: string | null; model_name: string | null }[];
  measures: { id: string; name: string; model_name: string | null; table_ids: string[] }[];
  reports: { id: string; name: string; status: string; model_name: string | null; measure_ids: string[]; model_wide_table_ids: string[] }[];
  edges: { from: string; to: string; kind: 'detected' | 'model_wide'; cls: OriginClass }[];
};

/** Separator between path labels in node ids (never appears in names; URL-encoded in links). */
export const NODE_SEP = '\u001f';
const MAX_DRAWN_SOURCES = 40;

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

function keyed(rows: ImpactRow[]): Keyed[] {
  const out: Keyed[] = [];
  for (const row of rows) {
    const origin = normalizeOrigin(row.origin);
    if (!origin || !isShareableOrigin(origin)) continue;
    const path = originPath(origin);
    out.push({ row, origin, key: originKey(origin), path, ids: pathIds(origin, path) });
  }
  return out;
}

const modelTableId = (row: ImpactRow) => `t:${row.model_id ?? row.model_name ?? '?'}|${tableKey(row.table)}`;
const modelOf = (row: ImpactRow) => row.model_id ?? row.model_name ?? '?';

/** The browse tree: every node with its counts, in display order (depth-first, most-used first). */
export function buildSourceTree(rows: ImpactRow[]): SourceTreeNode[] {
  type Agg = Omit<SourceTreeNode, 'sources' | 'reports' | 'models' | 'tables'> & { keys: Set<string>; r: Set<string>; m: Set<string>; t: Set<string> };
  const nodes = new Map<string, Agg>();
  for (const entry of keyed(rows)) {
    entry.path.forEach((segment, depth) => {
      const id = entry.ids[depth]!;
      let node = nodes.get(id);
      if (!node) {
        node = {
          id, parent: depth ? entry.ids[depth - 1]! : null, depth, level: segment.level, label: segment.label,
          system: entry.origin.system, system_label: systemLabel(entry.origin.system), cls: originClass(entry.origin),
          leaf: true, keys: new Set(), r: new Set(), m: new Set(), t: new Set(),
        };
        nodes.set(id, node);
      }
      if (depth < entry.path.length - 1) node.leaf = false;
      node.keys.add(entry.key);
      node.r.add(entry.row.report_id);
      node.m.add(modelOf(entry.row));
      node.t.add(modelTableId(entry.row));
    });
  }
  const children = new Map<string | null, Agg[]>();
  for (const node of nodes.values()) children.set(node.parent, [...(children.get(node.parent) ?? []), node]);
  const order = (list: Agg[]) => list.sort((a, b) => (a.depth === 0 ? ORIGIN_CLASS_ORDER.indexOf(a.cls) - ORIGIN_CLASS_ORDER.indexOf(b.cls) : 0)
    || b.r.size - a.r.size || a.label.localeCompare(b.label));
  const out: SourceTreeNode[] = [];
  const visit = (parent: string | null) => {
    for (const node of order(children.get(parent) ?? [])) {
      const { keys, r, m, t, ...rest } = node;
      out.push({ ...rest, sources: keys.size, reports: r.size, models: m.size, tables: t.size });
      visit(node.id);
    }
  };
  visit(null);
  return out;
}

/** The tree node id holding a source key (used by links from a report's lineage page). */
export function nodeIdForKey(rows: ImpactRow[], key: string): string | null {
  const entry = keyed(rows).find((candidate) => candidate.key === key);
  return entry ? entry.ids.at(-1)! : null;
}

export function buildSourceImpact(rows: ImpactRow[], nodeId: string): SourceImpact | null {
  const all = keyed(rows);
  const entries = all.filter((entry) => entry.ids.includes(nodeId));
  if (!entries.length) return null;
  const depth = entries[0]!.ids.indexOf(nodeId);
  const head = entries[0]!;
  const scopeSeg = head.path[depth]!;
  const scope = {
    id: nodeId, level: scopeSeg.level, label: scopeSeg.label, system: head.origin.system,
    system_label: systemLabel(head.origin.system), cls: originClass(head.origin),
    leaf: entries.every((entry) => entry.ids.length - 1 === depth),
  };
  const breadcrumb = head.path.slice(0, depth + 1).map((segment, i) => ({ id: head.ids[i]!, level: segment.level, label: segment.label }));

  // Sources under the scope (most-used first); only the first few are drawn as nodes.
  const byKey = new Map<string, Keyed[]>();
  for (const entry of entries) byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry]);
  const ranked = [...byKey.entries()].map(([key, list]) => ({ key, list, reports: new Set(list.map((e) => e.row.report_id)).size }))
    .sort((a, b) => b.reports - a.reports || originNodeTitle(a.list[0]!.origin).localeCompare(originNodeTitle(b.list[0]!.origin)));
  const drawn = ranked.slice(0, MAX_DRAWN_SOURCES);
  const sources: ImpactSource[] = drawn.map(({ key, list }) => {
    const origin = list[0]!.origin;
    return {
      id: `s:${key}`, key, title: originNodeTitle(origin), subtitle: originNodeSubtitle(origin), group: originGroup(origin),
      cls: originClass(origin), system: origin.system,
    };
  });

  const tables = new Map<string, SourceImpact['tables'][number]>();
  const measures = new Map<string, SourceImpact['measures'][number]>();
  const reports = new Map<string, SourceImpact['reports'][number]>();
  const sourceTables = new Map<string, Set<string>>();
  for (const { row, key } of entries) {
    const tableId = modelTableId(row);
    if (!tables.has(tableId)) tables.set(tableId, { id: tableId, name: row.table, model_id: row.model_id, model_name: row.model_name });
    sourceTables.set(key, (sourceTables.get(key) ?? new Set()).add(tableId));
    const report = reports.get(row.report_id) ?? {
      id: row.report_id, name: row.report_name, status: row.status, model_name: row.model_name, measure_ids: [], model_wide_table_ids: [],
    };
    reports.set(row.report_id, report);
    const refs = Array.isArray(row.refs) ? row.refs.filter((v): v is string => typeof v === 'string') : [];
    if (!refs.length && !report.model_wide_table_ids.includes(tableId)) report.model_wide_table_ids.push(tableId);
    for (const name of refs) {
      const measureId = `m:${modelOf(row)}|${name.trim().toLowerCase()}`;
      const measure = measures.get(measureId) ?? { id: measureId, name, model_name: row.model_name, table_ids: [] };
      if (!measure.table_ids.includes(tableId)) measure.table_ids.push(tableId);
      measures.set(measureId, measure);
      if (!report.measure_ids.includes(measureId)) report.measure_ids.push(measureId);
    }
  }

  const tableList = [...tables.values()].sort((a, b) => (a.model_name ?? '').localeCompare(b.model_name ?? '') || a.name.localeCompare(b.name));
  const tableIndex = new Map(tableList.map((table, index) => [table.id, index]));
  const firstTable = (ids: string[]) => Math.min(...ids.map((id) => tableIndex.get(id) ?? 0));
  const measureList = [...measures.values()].sort((a, b) => firstTable(a.table_ids) - firstTable(b.table_ids) || a.name.localeCompare(b.name));
  const reportList = [...reports.values()].sort((a, b) =>
    Number(a.measure_ids.length === 0) - Number(b.measure_ids.length === 0) || a.name.localeCompare(b.name));
  // Model-wide links only count when the report has no detected measure on that table.
  for (const report of reportList) {
    report.model_wide_table_ids = report.model_wide_table_ids.filter((tableId) =>
      !report.measure_ids.some((measureId) => measures.get(measureId)?.table_ids.includes(tableId)));
  }

  const edges: SourceImpact['edges'] = [];
  for (const source of sources) {
    for (const tableId of sourceTables.get(source.key) ?? []) edges.push({ from: source.id, to: tableId, kind: 'detected', cls: source.cls });
  }
  for (const measure of measureList) for (const tableId of measure.table_ids) edges.push({ from: tableId, to: measure.id, kind: 'detected', cls: scope.cls });
  for (const report of reportList) {
    for (const measureId of report.measure_ids) edges.push({ from: measureId, to: report.id, kind: 'detected', cls: scope.cls });
    for (const tableId of report.model_wide_table_ids) edges.push({ from: tableId, to: report.id, kind: 'model_wide', cls: scope.cls });
  }
  return {
    scope, breadcrumb, sources, hidden_sources: ranked.length - drawn.length,
    tables: tableList, measures: measureList, reports: reportList, edges,
  };
}
