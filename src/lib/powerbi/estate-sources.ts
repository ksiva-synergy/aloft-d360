/**
 * Specific data sources per Power BI model, for the estate "Source" filter: which Databricks
 * workspace / catalog, which SQL Server / database, which SharePoint site, which file folder…
 *
 * Two inputs are merged so each model gets the most specific identity available:
 *  - the Power BI service's own datasource list (`pbi_model_datasources`, parameters already
 *    resolved: server + database, URL, file path, connector kind), and
 *  - Power Query traced through helper queries (`describeSourceOrigins`), which adds what the
 *    service list leaves out — Databricks catalogs, Snowflake databases, dataflow names.
 * Every source is classified as category → type → instance (server / site / folder) → database.
 * Generic over connectors — no model, server or site names are special-cased. Pure — no DB access.
 */

import { buildQueryMap, describeSourceOrigins, systemLabel, type OriginSystem, type SourceOrigin } from '@/lib/powerbi/source-origin';

export type SourceCategory = 'databricks' | 'databases' | 'sharepoint' | 'files' | 'web' | 'powerbi' | 'unknown';

export type SourceType =
  | OriginSystem
  | 'analysis_services'
  | 'power_bi_dataset'
  | 'smartsheet'
  | 'google_sheets'
  | 'python'
  | 'usage_metrics'
  | 'other';

export const SOURCE_CATEGORIES: { id: SourceCategory; label: string }[] = [
  { id: 'databricks', label: 'Databricks (warehouse)' },
  { id: 'databases', label: 'Databases & warehouses' },
  { id: 'sharepoint', label: 'SharePoint & OneDrive' },
  { id: 'files', label: 'Local & network files' },
  { id: 'web', label: 'Web, APIs & apps' },
  { id: 'powerbi', label: 'Power BI' },
  { id: 'unknown', label: 'Unknown' },
];

const TYPE_META: Record<SourceType, { category: SourceCategory; label?: string }> = {
  databricks: { category: 'databricks' },
  snowflake: { category: 'databases' },
  sql_server: { category: 'databases' },
  postgres: { category: 'databases' },
  oracle: { category: 'databases' },
  mysql: { category: 'databases' },
  odbc: { category: 'databases' },
  fabric: { category: 'databases' },
  analysis_services: { category: 'databases', label: 'Analysis Services' },
  other_database: { category: 'databases', label: 'Other database' },
  sharepoint: { category: 'sharepoint' },
  onedrive: { category: 'sharepoint' },
  local_file: { category: 'files', label: 'Local / network file' },
  folder: { category: 'files' },
  web: { category: 'web', label: 'Web URL' },
  odata: { category: 'web' },
  smartsheet: { category: 'web', label: 'Smartsheet' },
  google_sheets: { category: 'web', label: 'Google Sheets' },
  python: { category: 'web', label: 'Python script' },
  power_bi_dataset: { category: 'powerbi', label: 'Power BI semantic model' },
  dataflow: { category: 'powerbi' },
  usage_metrics: { category: 'powerbi', label: 'Usage metrics' },
  embedded: { category: 'powerbi' },
  calculated: { category: 'powerbi' },
  unknown: { category: 'unknown' },
  other: { category: 'unknown', label: 'Other connector' },
};

export function sourceTypeLabel(t: SourceType): string {
  return TYPE_META[t]?.label ?? systemLabel(t as OriginSystem);
}

export function sourceTypeCategory(t: SourceType): SourceCategory {
  return TYPE_META[t]?.category ?? 'unknown';
}

/** One source a model reads: its type, and when known the instance (server / site / folder) and database. */
export type SourceRef = {
  type: SourceType;
  instance: { key: string; label: string; title: string } | null;
  database: { key: string; label: string } | null;
};

/** Datasource row as stored by the inventory (`pbi_model_datasources`). */
export type ServiceDatasource = {
  datasource_type: string | null;
  connection_server: string | null;
  connection_path: string | null;
  raw: unknown;
};

// ── Normalisers ────────────────────────────────────────────────────────────────────────────────

/** Lower-cased host without scheme, trailing slash or port (`srv,1433` / `srv:1433`). */
const normHost = (s: string) =>
  s
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/[/\\]+$/, '')
    .replace(/[,:]\d+$/, '')
    .toLowerCase();

function urlHost(url: string): string | null {
  const m = url.trim().match(/^[a-z]+:\/\/([^/?#]+)/i);
  return m ? m[1]!.toLowerCase() : null;
}

/** SharePoint / OneDrive site of any URL under it (file, folder, list or site URL). */
function sharePointSite(url: string): { key: string; label: string; title: string } | null {
  const host = urlHost(url);
  if (!host) return null;
  const tenant = host.split('.')[0]!.replace(/-my$/, '');
  const m = url.match(/^[a-z]+:\/\/[^/]+\/(sites|teams|personal)\/([^/?#]+)/i);
  if (!m) return { key: `${host}/`, label: `${host} (root site)`, title: `https://${host}/` };
  const name = decodeSafe(m[2]!);
  const path = `${m[1]!.toLowerCase()}/${m[2]!.toLowerCase()}`;
  return { key: `${host}/${path}`, label: `${name} · ${tenant}`, title: `https://${host}/${m[1]}/${m[2]}` };
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function dirname(p: string): string {
  const clean = p.trim().replace(/[/\\]+$/, '');
  const i = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  return i > 0 ? clean.slice(0, i) : clean;
}

const inst = (key: string, label: string, title = label) => ({ key: key.toLowerCase(), label, title });
const db = (name: string | null | undefined) => (name && name.trim() ? { key: name.trim().toLowerCase(), label: name.trim() } : null);

function hostInstance(raw: string | null | undefined): SourceRef['instance'] {
  if (!raw || !raw.trim()) return null;
  const h = normHost(raw);
  return inst(h, h, raw.trim());
}

const FABRIC_HOST_RE = /\.(database|datawarehouse)\.fabric\.microsoft\.com$/;
const GUID_SUFFIX_RE = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * SQL-protocol source. Fabric SQL databases and warehouse / lakehouse SQL endpoints speak TDS like
 * SQL Server, so they arrive as `Sql`; their host says which they are, and their database names
 * carry a GUID suffix that is dropped from the label.
 */
function sqlRef(type: SourceType, server: string | null | undefined, database: string | null | undefined): SourceRef {
  const instance = hostInstance(server);
  const fabric = instance?.key.match(FABRIC_HOST_RE);
  const d = db(database);
  if (!fabric || !instance) return { type, instance, database: d };
  const kind = fabric[1] === 'database' ? 'SQL database' : 'Warehouse / Lakehouse';
  return {
    type: 'fabric',
    instance: { ...instance, label: `${kind} · ${instance.key.slice(0, 8)}…` },
    database: d ? { ...d, label: d.label.replace(GUID_SUFFIX_RE, '') } : null,
  };
}

function readJson(s: string | null | undefined): Record<string, unknown> | null {
  if (!s || !s.trim().startsWith('{')) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

// ── Power BI service datasources ───────────────────────────────────────────────────────────────

function webRef(url: string | null): SourceRef {
  if (url && /\.sharepoint\.com/i.test(url)) {
    const personal = /-my\.sharepoint\.com\/personal\//i.test(url);
    return { type: personal ? 'onedrive' : 'sharepoint', instance: sharePointSite(url), database: null };
  }
  if (url && /docs\.google\.com\/spreadsheets/i.test(url)) {
    const id = url.match(/spreadsheets\/d\/([^/?#]+)/)?.[1];
    return { type: 'google_sheets', instance: id ? inst(`gsheet:${id}`, `Sheet ${id.slice(0, 10)}…`, url) : null, database: null };
  }
  const host = url ? urlHost(url) : null;
  return { type: 'web', instance: host ? inst(host, host, url!) : null, database: null };
}

export function refFromServiceDatasource(ds: ServiceDatasource): SourceRef | null {
  const details = ((ds.raw as Record<string, unknown> | null)?.connectionDetails ?? {}) as Record<string, unknown>;
  const server = ds.connection_server ?? str(details.server);
  const database = str(details.database);
  const path = ds.connection_path ?? str(details.path);
  const url = str(details.url);
  const t = (ds.datasource_type ?? '').toLowerCase();

  switch (t) {
    case 'sql':
      return sqlRef('sql_server', server, database);
    case 'postgresql':
      return { type: 'postgres', instance: hostInstance(server), database: db(database) };
    case 'oracle':
      return { type: 'oracle', instance: hostInstance(server), database: db(database) };
    case 'mysql':
      return { type: 'mysql', instance: hostInstance(server), database: db(database) };
    case 'analysisservices':
      if (server && /^powerbi:\/\//i.test(server)) {
        return { type: 'power_bi_dataset', instance: powerBiWorkspace(server), database: db(database) };
      }
      return { type: 'analysis_services', instance: hostInstance(server), database: db(database) };
    case 'odbc':
      return { type: 'odbc', instance: hostInstance(str(details.connectionString) ?? server), database: db(database) };
    case 'odata':
      return { type: 'odata', instance: url ? inst(urlHost(url) ?? url, urlHost(url) ?? url, url) : null, database: null };
    case 'web':
    case 'sharepointlist':
    case 'sharepoint':
    case 'sharepointonline':
      return webRef(url ?? path);
    case 'file':
      return path && /^https?:/i.test(path) ? webRef(path) : { type: 'local_file', instance: path ? inst(dirname(path), dirname(path), path) : null, database: null };
    case 'folder':
      return { type: 'folder', instance: path ? inst(normHost(path), path.trim()) : null, database: null };
    case 'extension':
      return refFromExtension(str(details.kind), path);
    default:
      return t ? { type: 'other', instance: inst(`connector:${t}`, ds.datasource_type!), database: null } : null;
  }
}

function refFromExtension(kind: string | null, path: string | null): SourceRef {
  const k = (kind ?? '').toLowerCase();
  if (k.startsWith('databricks')) {
    const host = str(readJson(path)?.host) ?? (path?.split(';')[0] || null);
    return { type: 'databricks', instance: hostInstance(host), database: null };
  }
  if (k === 'snowflake') {
    const account = path?.split(';')[0] ?? null;
    return { type: 'snowflake', instance: hostInstance(account), database: null };
  }
  if (k === 'powerbi') return { type: 'power_bi_dataset', instance: null, database: null };
  if (k.includes('dataflows')) return { type: 'dataflow', instance: null, database: null };
  if (k.startsWith('smartsheet')) return { type: 'smartsheet', instance: null, database: null };
  if (k === 'googlesheets') return webRef(path);
  if (k === 'python') return { type: 'python', instance: null, database: null };
  if (k.includes('usagemetrics')) return { type: 'usage_metrics', instance: null, database: null };
  if (k.includes('fabric') || k.includes('lakehouse')) return { type: 'fabric', instance: hostInstance(path), database: null };
  return { type: 'other', instance: kind ? inst(`connector:${k}`, kind) : null, database: null };
}

function powerBiWorkspace(server: string): SourceRef['instance'] {
  const ws = decodeSafe(server.replace(/^powerbi:\/\/[^/]+\/v1\.0\/[^/]+\//i, '').replace(/\/+$/, ''));
  return inst(`pbiws:${ws}`, `Workspace ${ws}`, server);
}

// ── Power Query ────────────────────────────────────────────────────────────────────────────────

export function refFromOrigin(o: SourceOrigin): SourceRef {
  switch (o.system) {
    case 'sharepoint':
    case 'onedrive':
      return { type: o.system, instance: o.location ? sharePointSite(o.location) : null, database: null };
    case 'web':
      return webRef(o.location);
    case 'odata':
      return { type: 'odata', instance: o.location ? inst(urlHost(o.location) ?? o.location, urlHost(o.location) ?? o.location, o.location) : null, database: null };
    case 'local_file':
      return { type: 'local_file', instance: o.location ? inst(dirname(o.location), dirname(o.location), o.location) : null, database: null };
    case 'folder':
      return { type: 'folder', instance: o.location ? inst(normHost(o.location), o.location.trim()) : null, database: null };
    case 'dataflow':
      return { type: 'dataflow', instance: o.location ? inst(`dfws:${o.location}`, `Workspace ${o.location}`) : null, database: db(o.database) };
    case 'embedded':
    case 'calculated':
    case 'unknown':
      return { type: o.system, instance: null, database: null };
    case 'other_database':
      if (o.connector?.startsWith('AnalysisServices')) {
        if (o.location && /^powerbi:\/\//i.test(o.location)) return { type: 'power_bi_dataset', instance: powerBiWorkspace(o.location), database: db(o.database) };
        return { type: 'analysis_services', instance: hostInstance(o.location), database: db(o.database) };
      }
      return { type: 'other_database', instance: hostInstance(o.location), database: db(o.database) };
    case 'sql_server':
    case 'fabric':
      return sqlRef(o.system, o.location, o.database);
    default:
      // databases and warehouses: server / host / account, then database or catalog
      return { type: o.system, instance: hostInstance(o.location), database: db(o.database) };
  }
}

// ── Per model ──────────────────────────────────────────────────────────────────────────────────

/** Filter keys: `cat:<category>`, `type:<type>`, `inst:<type>|<instance>`, `db:<type>|<instance>|<database>`. */
export const refKeys = (r: SourceRef) => {
  const keys = [`cat:${sourceTypeCategory(r.type)}`, `type:${r.type}`];
  const i = r.instance ? `${r.type}|${r.instance.key}` : `${r.type}|`;
  if (r.instance) keys.push(`inst:${i}`);
  if (r.database) keys.push(`db:${i}|${r.database.key}`);
  return keys;
};

/**
 * Every source a model reads (service datasources + Power Query), de-duplicated. A Power Query
 * database without a known server is attached to the model's only instance of that type.
 */
export function modelSourceRefs(input: {
  datasources: ServiceDatasource[];
  expressions: { name: string; m: string }[] | null | undefined;
  tables: { name: string; source_m: string | null; partition_kind: string | null }[];
}): SourceRef[] {
  const refs: SourceRef[] = [];
  for (const ds of input.datasources) {
    const r = refFromServiceDatasource(ds);
    if (r) refs.push(r);
  }
  const queries = buildQueryMap(input.expressions, input.tables);
  for (const t of input.tables) {
    const origins = describeSourceOrigins(t.source_m, queries, { partitionKind: t.partition_kind, selfName: t.name });
    for (const o of origins) refs.push(refFromOrigin(o));
  }

  // Database known but server came from a parameter: use the model's single instance of that type.
  const instancesByType = new Map<SourceType, Map<string, SourceRef['instance']>>();
  for (const r of refs) {
    if (!r.instance) continue;
    const m = instancesByType.get(r.type) ?? new Map();
    m.set(r.instance.key, r.instance);
    instancesByType.set(r.type, m);
  }
  for (const r of refs) {
    if (r.instance || !r.database) continue;
    const only = instancesByType.get(r.type);
    if (only?.size === 1) r.instance = [...only.values()][0]!;
  }

  const out = new Map<string, SourceRef>();
  for (const r of refs) {
    const k = `${r.type}|${r.instance?.key ?? ''}|${r.database?.key ?? ''}`;
    if (!out.has(k)) out.set(k, r);
  }
  // Drop a bare type entry when a more specific one of that type exists.
  const specific = new Set([...out.values()].filter((r) => r.instance || r.database).map((r) => r.type));
  return [...out.values()].filter((r) => r.instance || r.database || !specific.has(r.type));
}
