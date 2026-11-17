/**
 * Turns a report lineage payload into the four-lane graph the report lineage view draws:
 * original sources → model tables → measures on the report → the report.
 *
 * Pure (no React, no DB). Every rule here is generic over connectors and names: nodes come from
 * the payload's parsed origins, table → measure links come from the measures' own DAX analysis,
 * and "model-wide" means only that no detected report measure reads the table.
 */

import { originClass, originTitle, systemLabel, type OriginClass, type SourceOrigin } from '@/lib/powerbi/source-origin';
import type { ReportLineagePayload, ReportLineageTableSource } from '@/lib/powerbi/report-lineage-types';

export const ORIGIN_CLASS_ORDER: OriginClass[] = ['warehouse', 'database', 'file', 'model', 'unknown'];

export const ORIGIN_CLASS_LABEL: Record<OriginClass, string> = {
  warehouse: 'Databricks',
  database: 'Other databases',
  file: 'Files, sites & feeds',
  model: 'Defined in the model',
  unknown: 'Unknown / not harvested',
};

/**
 * bound: mapped to a Unity Catalog table · unbound: a warehouse query with no UC mapping yet ·
 * file / model / unknown: no UC table expected (or source not traced) · other: database source
 * that the partition classifier did not mark as a warehouse query.
 */
export type TableBinding = 'bound' | 'unbound' | 'file' | 'model' | 'unknown' | 'other';

export type LineageMeasure = ReportLineagePayload['measures'][number];

export type SourceNode = {
  id: string;
  kind: 'source';
  key: string;
  origin: SourceOrigin;
  cls: OriginClass;
  title: string;
  subtitle: string | null;
  group: string;
  tableIds: string[];
};

export type TableNode = {
  id: string;
  kind: 'table';
  name: string;
  source: ReportLineageTableSource;
  cls: OriginClass;
  binding: TableBinding;
  modelWide: boolean;
  sourceIds: string[];
  measureIds: string[];
};

export type MeasureNode = {
  id: string;
  kind: 'measure';
  measure: LineageMeasure;
  classes: OriginClass[];
  tableIds: string[];
};

export type ReportNode = { id: typeof REPORT_NODE_ID; kind: 'report' };

export type LineageNode = SourceNode | TableNode | MeasureNode | ReportNode;

export type LineageEdgeKind = 'detected' | 'model_wide' | 'unresolved';

export type LineageEdge = { from: string; to: string; kind: LineageEdgeKind; cls: OriginClass | null };

export type LineageGraph = {
  sources: SourceNode[];
  tables: TableNode[];
  measures: MeasureNode[];
  edges: LineageEdge[];
  byId: Map<string, LineageNode>;
};

export const REPORT_NODE_ID = 'report' as const;

const SHARED_CLASSES = new Set<OriginClass>(['warehouse', 'database', 'file']);

const norm = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

/** Table names as DAX writes them ('Sales', Sales[x], "Sales") reduced to a comparable key. */
export function tableKey(name: string): string {
  return norm(name.replace(/\[.*$/, '').replace(/^'+|'+$/g, '').replace(/^"+|"+$/g, ''));
}

/** True for origins other tables (and other reports) can share: warehouse, database or file. */
export function isShareableOrigin(origin: Pick<SourceOrigin, 'system'>): boolean {
  return SHARED_CLASSES.has(originClass(origin));
}

/**
 * Stable identity of an original source across tables, models and reports. Shareable origins key
 * on where the data lives; in-model and unknown origins are never merged across tables.
 */
export function originKey(origin: SourceOrigin, table?: string): string {
  const parts = [
    origin.system, origin.location, origin.database, origin.object, origin.folder, origin.file,
    origin.items.map((item) => item.name).join(','),
    origin.object ? '' : origin.query,
  ].map(norm);
  const base = parts.join('|');
  return isShareableOrigin(origin) ? base : `${base}|table:${norm(table)}`;
}

/** URL → its SharePoint/Teams site (`sites/Finance`) or host; other locations (paths, hosts) as-is. */
export function shortLocation(location: string | null): string | null {
  if (!location) return null;
  const url = location.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)([^?#]*)/i);
  if (url) {
    const site = url[2]?.match(/\/(?:sites|teams)\/[^/]+/i)?.[0];
    return site ? site.replace(/^\//, '') : url[1]!;
  }
  return location.replace(/[\\/]+$/, '');
}

/** Folder shown relative to its site or server when the parser recorded it as a full URL. */
export function relativeFolder(folder: string | null, location: string | null): string | null {
  if (!folder) return null;
  const relative = location && folder.toLowerCase().startsWith(location.toLowerCase()) ? folder.slice(location.length) : folder;
  return relative.replace(/^[\\/]+/, '') || null;
}

export function originNodeTitle(origin: SourceOrigin): string {
  switch (originClass(origin)) {
    case 'unknown':
      return 'Source not traced';
    case 'model':
      return originTitle(origin);
    default: {
      const firstItem = origin.items[0]?.name;
      return origin.object ?? origin.file ?? firstItem ?? origin.database ?? shortLocation(origin.location) ?? originTitle(origin);
    }
  }
}

export function originNodeSubtitle(origin: SourceOrigin): string | null {
  const cls = originClass(origin);
  if (cls === 'unknown' || cls === 'model') return origin.connector;
  if (cls === 'file') {
    const items = origin.items.map((item) => item.name).join(', ');
    return [relativeFolder(origin.folder, origin.location), items && origin.file ? items : null].filter(Boolean).join(' · ') || origin.connector;
  }
  const db = origin.object ? origin.database : null;
  return [db, origin.query && !origin.object ? 'native query' : null].filter(Boolean).join(' · ') || origin.connector;
}

export function originGroup(origin: SourceOrigin): string {
  const cls = originClass(origin);
  if (cls === 'model') return 'Defined in the model';
  if (cls === 'unknown') return 'Not harvested';
  const where = shortLocation(origin.location) ?? origin.database;
  return where ? `${systemLabel(origin.system)} · ${where}` : systemLabel(origin.system);
}

function tableClass(source: ReportLineageTableSource): OriginClass {
  const classes = (source.origins ?? []).map((origin) => originClass(origin));
  return classes.find((cls) => cls !== 'unknown') ?? 'unknown';
}

export function tableBinding(source: ReportLineageTableSource, cls: OriginClass = tableClass(source)): TableBinding {
  if (source.uc_full_path?.trim()) return 'bound';
  if (source.partition_kind === 'warehouse_query') return 'unbound';
  if (cls === 'file' || cls === 'model' || cls === 'unknown') return cls;
  return 'other';
}

const classRank = (cls: OriginClass) => ORIGIN_CLASS_ORDER.indexOf(cls);

export function buildLineageGraph(
  payload: Pick<ReportLineagePayload, 'measures' | 'sources'>,
  opts: { showModelWide?: boolean } = {},
): LineageGraph {
  const showModelWide = opts.showModelWide ?? true;
  const allSources = payload.sources ?? [];
  const measureList = payload.measures ?? [];

  // Model tables (one per payload source entry).
  const tableIdByKey = new Map<string, string>();
  const tablesAll: TableNode[] = allSources.map((source) => {
    const id = `t:${tableKey(source.table)}`;
    tableIdByKey.set(tableKey(source.table), id);
    const cls = tableClass(source);
    return {
      id, kind: 'table', name: source.table, source, cls, binding: tableBinding(source, cls),
      modelWide: (source.referenced_by_measures ?? []).length === 0, sourceIds: [], measureIds: [],
    };
  });
  const tables = tablesAll.filter((table) => showModelWide || !table.modelWide);

  // Original sources, deduplicated across the visible tables.
  const sourceByKey = new Map<string, SourceNode>();
  for (const table of tables) {
    const origins = table.source.origins?.length ? table.source.origins : [];
    for (const origin of origins) {
      const key = originKey(origin, table.name);
      let node = sourceByKey.get(key);
      if (!node) {
        node = {
          id: `s:${key}`, kind: 'source', key, origin, cls: originClass(origin),
          title: originNodeTitle(origin), subtitle: originNodeSubtitle(origin), group: originGroup(origin), tableIds: [],
        };
        sourceByKey.set(key, node);
      }
      if (!node.tableIds.includes(table.id)) node.tableIds.push(table.id);
      if (!table.sourceIds.includes(node.id)) table.sourceIds.push(node.id);
    }
  }
  const sources = [...sourceByKey.values()].sort((a, b) =>
    classRank(a.cls) - classRank(b.cls) || a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
  const sourceIndex = new Map(sources.map((node, index) => [node.id, index]));

  // Measures and their table links (from the measure's own analysis, then tables_involved).
  const visibleTables = new Map(tables.map((table) => [table.id, table]));
  const measures: MeasureNode[] = measureList.map((measure) => {
    const names = [...(measure.sources ?? []).map((source) => source.table), ...(measure.tables_involved ?? [])];
    const tableIds = [...new Set(names.map((name) => tableIdByKey.get(tableKey(name))).filter((id): id is string => Boolean(id)))]
      .filter((id) => visibleTables.has(id));
    const id = `m:${norm(measure.name)}`;
    for (const tableId of tableIds) {
      const table = visibleTables.get(tableId)!;
      if (!table.measureIds.includes(id)) table.measureIds.push(id);
    }
    const present = new Set(tableIds.map((tableId) => visibleTables.get(tableId)!.cls));
    return { id, kind: 'measure', measure, tableIds, classes: ORIGIN_CLASS_ORDER.filter((cls) => present.has(cls)) };
  });

  // Order tables by their first source, keeping model-wide tables last; measures by their tables.
  const tableRank = (table: TableNode) => {
    const indices = table.sourceIds.map((id) => sourceIndex.get(id) ?? Number.MAX_SAFE_INTEGER);
    return indices.length ? Math.min(...indices) : Number.MAX_SAFE_INTEGER;
  };
  tables.sort((a, b) => Number(a.modelWide) - Number(b.modelWide) || tableRank(a) - tableRank(b) || a.name.localeCompare(b.name));
  const tableIndex = new Map(tables.map((table, index) => [table.id, index]));
  const measureRank = (node: MeasureNode) => node.tableIds.length
    ? node.tableIds.reduce((sum, id) => sum + (tableIndex.get(id) ?? 0), 0) / node.tableIds.length
    : Number.MAX_SAFE_INTEGER;
  measures.sort((a, b) => Number(!a.measure.found_in_model) - Number(!b.measure.found_in_model)
    || measureRank(a) - measureRank(b) || a.measure.name.localeCompare(b.measure.name));

  const edges: LineageEdge[] = [];
  for (const table of tables) {
    for (const sourceId of table.sourceIds) {
      const source = sourceByKey.get(sourceId.slice(2))!;
      edges.push({ from: sourceId, to: table.id, kind: table.modelWide ? 'model_wide' : 'detected', cls: source.cls });
    }
  }
  for (const node of measures) {
    for (const tableId of node.tableIds) edges.push({ from: tableId, to: node.id, kind: 'detected', cls: visibleTables.get(tableId)!.cls });
  }
  for (const node of measures) {
    edges.push({ from: node.id, to: REPORT_NODE_ID, kind: node.measure.found_in_model ? 'detected' : 'unresolved', cls: null });
  }
  for (const table of tables.filter((t) => t.modelWide)) {
    edges.push({ from: table.id, to: REPORT_NODE_ID, kind: 'model_wide', cls: table.cls });
  }

  const byId = new Map<string, LineageNode>();
  for (const node of [...sources, ...tables, ...measures]) byId.set(node.id, node);
  byId.set(REPORT_NODE_ID, { id: REPORT_NODE_ID, kind: 'report' });
  return { sources, tables, measures, edges, byId };
}

/** Everything upstream and downstream of the given nodes, and the edges on those paths. */
export function traceRelated(edges: LineageEdge[], ids: string[]): { nodes: Set<string>; edges: Set<number> } {
  const nodes = new Set<string>();
  const hot = new Set<number>();
  for (const id of ids) {
    const up = new Set([id]);
    const down = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges) {
        if (up.has(edge.to) && !up.has(edge.from)) { up.add(edge.from); changed = true; }
        if (down.has(edge.from) && !down.has(edge.to)) { down.add(edge.to); changed = true; }
      }
    }
    up.forEach((node) => nodes.add(node));
    down.forEach((node) => nodes.add(node));
    edges.forEach((edge, index) => {
      if ((up.has(edge.from) && up.has(edge.to)) || (down.has(edge.from) && down.has(edge.to))) hot.add(index);
    });
  }
  return { nodes, edges: hot };
}

export type ReadinessTone = 'ok' | 'warn' | 'bad';

export type ReadinessItem = { id: string; tone: ReadinessTone; title: string; detail: string | null; nodeIds: string[] };

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const names = (list: string[], max = 4) => list.length > max ? `${list.slice(0, max).join(', ')} +${list.length - max} more` : list.join(', ');

/** The reasons a report is (or is not) fully traced, each tied to the graph nodes it concerns. */
export function lineageReadiness(payload: ReportLineagePayload, graph: LineageGraph): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  const harvest = payload.harvest;
  if (!harvest.has_definition_on_disk && harvest.from_props_count === 0) {
    items.push({ id: 'definition', tone: 'bad', title: 'Report definition not harvested', detail: 'Harvest the report definition, then parse it.', nodeIds: [] });
  }
  const unknown = graph.tables.filter((table) => table.cls === 'unknown');
  if (unknown.length) {
    items.push({
      id: 'unknown-sources', tone: 'bad', title: `${plural(unknown.length, 'table')} with an untraced source`,
      detail: names(unknown.map((table) => table.name)), nodeIds: unknown.map((table) => table.id),
    });
  }
  const missing = graph.measures.filter((node) => !node.measure.found_in_model);
  if (missing.length) {
    items.push({
      id: 'missing-measures', tone: 'warn', title: `${plural(missing.length, 'measure')} not found on the model`,
      detail: names(missing.map((node) => node.measure.name)), nodeIds: missing.map((node) => node.id),
    });
  }
  const unbound = graph.tables.filter((table) => table.binding === 'unbound');
  if (unbound.length) {
    items.push({
      id: 'unbound', tone: 'warn', title: `${plural(unbound.length, 'warehouse table')} not mapped to Unity Catalog`,
      detail: `${names(unbound.map((table) => table.name))} · run Catalog link or bind a Databricks table`, nodeIds: unbound.map((table) => table.id),
    });
  }
  if (!graph.measures.length) {
    items.push({ id: 'no-measures', tone: 'warn', title: 'No measures detected on the report', detail: 'Tables below are model-wide: the report may use them through columns on visuals.', nodeIds: [] });
  }
  const bound = graph.tables.filter((table) => table.binding === 'bound');
  if (bound.length) {
    items.push({
      id: 'bound', tone: 'ok', title: `${plural(bound.length, 'table')} mapped to Unity Catalog`,
      detail: names(bound.map((table) => table.source.uc_full_path ?? table.name), 3), nodeIds: bound.map((table) => table.id),
    });
  }
  const files = graph.sources.filter((source) => source.cls === 'file');
  if (files.length) {
    items.push({
      id: 'files', tone: 'ok', title: `${plural(files.length, 'file or feed source')} traced`,
      detail: 'Location and sheet known; no Unity Catalog table expected', nodeIds: files.map((source) => source.id),
    });
  }
  const resolved = graph.measures.filter((node) => node.measure.found_in_model);
  if (resolved.length) {
    items.push({ id: 'resolved', tone: 'ok', title: `${plural(resolved.length, 'measure')} resolved on the model`, detail: null, nodeIds: [] });
  }
  return items;
}

/** Live readiness from the current harvest: ready only when nothing needs attention. */
export function liveLineageStatus(items: ReadinessItem[]): 'ready' | 'partial' | 'blocked' {
  if (items.some((item) => item.id === 'definition')) return 'blocked';
  return items.some((item) => item.tone !== 'ok') ? 'partial' : 'ready';
}

export type LineageRow = {
  measure: string | null;
  measureFound: boolean;
  table: string | null;
  storage: string | null;
  system: string | null;
  cls: OriginClass | null;
  location: string | null;
  database: string | null;
  object: string | null;
  uc: string | null;
  binding: TableBinding | null;
  nodeIds: string[];
};

/** One row per measure × table × source (model-wide tables get a row with no measure). */
export function lineageRows(graph: LineageGraph): LineageRow[] {
  const rows: LineageRow[] = [];
  const tableById = new Map(graph.tables.map((table) => [table.id, table]));
  const sourceById = new Map(graph.sources.map((source) => [source.id, source]));
  const push = (measure: MeasureNode | null, table: TableNode | null, source: SourceNode | null) => rows.push({
    measure: measure?.measure.name ?? null,
    measureFound: measure?.measure.found_in_model ?? true,
    table: table?.name ?? null,
    storage: table?.source.storage_mode ?? null,
    system: source ? systemLabel(source.origin.system) : null,
    cls: source?.cls ?? null,
    location: source?.origin.location ?? null,
    database: source ? source.origin.database ?? source.origin.folder : null,
    object: source ? source.origin.object ?? source.origin.file ?? source.title : null,
    uc: table?.source.uc_full_path ?? null,
    binding: table?.binding ?? null,
    nodeIds: [measure?.id, table?.id, source?.id].filter((id): id is string => Boolean(id)),
  });
  const expandTable = (measure: MeasureNode | null, table: TableNode) => {
    if (!table.sourceIds.length) push(measure, table, null);
    for (const id of table.sourceIds) push(measure, table, sourceById.get(id) ?? null);
  };
  for (const measure of graph.measures) {
    if (!measure.tableIds.length) push(measure, null, null);
    for (const id of measure.tableIds) expandTable(measure, tableById.get(id)!);
  }
  for (const table of graph.tables.filter((t) => t.modelWide)) expandTable(null, table);
  return rows;
}

export const LINEAGE_ROW_COLUMNS = ['measure', 'model_table', 'storage_mode', 'source_system', 'location', 'database_or_folder', 'object_or_file', 'unity_catalog'] as const;

export function lineageRowValues(row: LineageRow): string[] {
  return [
    row.measure ?? '(model-wide)', row.table ?? '', row.storage ?? '', row.system ?? '', row.location ?? '',
    row.database ?? '', row.object ?? '', row.uc ?? (row.binding ?? ''),
  ];
}

export function lineageRowsToTsv(rows: LineageRow[]): string {
  const clean = (value: string) => value.replace(/[\t\r\n]+/g, ' ');
  return [LINEAGE_ROW_COLUMNS.join('\t'), ...rows.map((row) => lineageRowValues(row).map(clean).join('\t'))].join('\n');
}

/** Count of items per origin class, in display order (classes with zero are omitted). */
export function classMix(classes: OriginClass[]): { cls: OriginClass; count: number }[] {
  return ORIGIN_CLASS_ORDER.map((cls) => ({ cls, count: classes.filter((value) => value === cls).length })).filter((entry) => entry.count > 0);
}
