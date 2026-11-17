/**
 * Where a Power BI table's data really comes from, read from its Power Query (M) and the helper
 * queries it calls (shared expressions such as "Transform File" / "Sample File", parameters and
 * other table queries). Generic over connectors — no report, table or file names are special-cased.
 *
 * Examples it resolves:
 *   SharePoint.Files(site) → filter [Name] = "Tracker.xlsx" → #"Transform File"([Content]) →
 *     Excel.Workbook(…){[Item="ProcessSheet",Kind="Table"]}  ⇒ Excel file on SharePoint, table ProcessSheet
 *   Value.NativeQuery(Snowflake.Databases(host, wh){[Name="DB"]}[Data], "SELECT …")  ⇒ Snowflake query
 *   Databricks.Catalogs(host, path){[Name="cat",Kind="Database"]}…  ⇒ Databricks (in the warehouse)
 * Pure — no DB access.
 */

export type OriginSystem =
  | 'databricks'
  | 'snowflake'
  | 'sql_server'
  | 'postgres'
  | 'oracle'
  | 'mysql'
  | 'odbc'
  | 'fabric'
  | 'other_database'
  | 'sharepoint'
  | 'onedrive'
  | 'local_file'
  | 'folder'
  | 'web'
  | 'odata'
  | 'dataflow'
  | 'embedded'
  | 'calculated'
  | 'unknown';

export type OriginFormat = 'excel' | 'csv' | 'json' | 'xml' | 'parquet' | 'pdf' | 'text' | 'list' | null;

/** warehouse: already in Databricks · database: a SQL database (a Databricks replica can be bound)
 *  · file: files, sites, feeds and dataflows that are not in any warehouse · model: data defined in
 *  the Power BI model itself (embedded rows, DAX calculated tables). */
export type OriginClass = 'warehouse' | 'database' | 'file' | 'model' | 'unknown';

export type SourceOrigin = {
  system: OriginSystem;
  /** Power Query function that reads it, e.g. `SharePoint.Files`. */
  connector: string | null;
  format: OriginFormat;
  /** Site URL, server / host, folder or file path, feed URL. */
  location: string | null;
  /** Folder inside a site (from a `[Folder Path] = "…"` filter). */
  folder: string | null;
  file: string | null;
  /** Excel sheets / tables / named ranges read from the file. */
  items: { name: string; kind: string | null }[];
  database: string | null;
  /** Schema / table (navigation path or the table a native query reads). */
  object: string | null;
  /** Native SQL sent to the source (trimmed). */
  query: string | null;
  /** Helper queries followed to find this origin. */
  via: string[];
};

const FILE_EXT_RE = /\.(xlsx|xlsm|xlsb|xls|csv|tsv|txt|json|xml|parquet|pdf)$/i;

const CLASS: Record<OriginSystem, OriginClass> = {
  databricks: 'warehouse',
  snowflake: 'database',
  sql_server: 'database',
  postgres: 'database',
  oracle: 'database',
  mysql: 'database',
  odbc: 'database',
  fabric: 'database',
  other_database: 'database',
  sharepoint: 'file',
  onedrive: 'file',
  local_file: 'file',
  folder: 'file',
  web: 'file',
  odata: 'file',
  dataflow: 'file',
  embedded: 'model',
  calculated: 'model',
  unknown: 'unknown',
};

export function originClass(o: Pick<SourceOrigin, 'system'>): OriginClass {
  return CLASS[o.system] ?? 'unknown';
}

/** Data that is not in any warehouse or database a Databricks table could replicate. */
export function isOutsideWarehouse(o: Pick<SourceOrigin, 'system'>): boolean {
  return originClass(o) === 'file';
}

// ── M text helpers ─────────────────────────────────────────────────────────────────────────────

const unq = (s: string) => s.replace(/""/g, '"').replace(/#\(lf\)/g, '\n').replace(/#\(cr\)/g, '').replace(/#\(tab\)/g, '\t');
const STR = '"((?:[^"]|"")*)"';

function stripMComments(m: string): string {
  // keep string literals intact: only remove // and /* */ outside strings
  let out = '';
  let i = 0;
  while (i < m.length) {
    const ch = m[i]!;
    if (ch === '"') {
      const end = findStringEnd(m, i);
      out += m.slice(i, end);
      i = end;
    } else if (ch === '/' && m[i + 1] === '/') {
      while (i < m.length && m[i] !== '\n') i++;
    } else if (ch === '/' && m[i + 1] === '*') {
      const end = m.indexOf('*/', i + 2);
      i = end === -1 ? m.length : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function findStringEnd(m: string, start: number): number {
  let i = start + 1;
  while (i < m.length) {
    if (m[i] === '"') {
      if (m[i + 1] === '"') i += 2;
      else return i + 1;
    } else i++;
  }
  return m.length;
}

/** First one or two string arguments of every call to `fn` (regex source of the function name). */
function calls(m: string, fn: string): { name: string; a: string | null; b: string | null; at: number }[] {
  const re = new RegExp(`\\b(${fn})\\s*\\(\\s*(?:${STR})?(?:\\s*,\\s*${STR})?`, 'g');
  const out: { name: string; a: string | null; b: string | null; at: number }[] = [];
  for (const x of m.matchAll(re)) {
    out.push({ name: x[1]!, a: x[2] != null ? unq(x[2]) : null, b: x[3] != null ? unq(x[3]) : null, at: x.index ?? 0 });
  }
  return out;
}

function strings(m: string): string[] {
  return [...m.matchAll(new RegExp(STR, 'g'))].map((x) => unq(x[1]!));
}

function basename(p: string): string {
  const clean = p.split('?')[0]!.replace(/[\\/]+$/, '');
  const last = clean.split(/[\\/]/).pop() ?? clean;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function formatFromName(name: string | null): OriginFormat {
  const ext = name?.match(FILE_EXT_RE)?.[1]?.toLowerCase();
  if (!ext) return null;
  if (ext.startsWith('xl')) return 'excel';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'txt') return 'text';
  return ext as OriginFormat;
}

/** SharePoint / OneDrive URL → { site, file }. */
function splitSharePointUrl(url: string): { site: string; file: string | null; personal: boolean } {
  const personal = /-my\.sharepoint\.com\/personal\//i.test(url);
  const m = url.match(/^(https?:\/\/[^/]+\/(?:sites|teams|personal)\/[^/?#]+)/i);
  const site = m ? `${m[1]}/` : url.replace(/[^/]*$/, '');
  const file = FILE_EXT_RE.test(url.split('?')[0]!) ? basename(url) : null;
  return { site, file, personal };
}

/** Navigation names after a connector: `{[Name="DB",Kind="Database"]}[Data]{[Name="T"]}…`. */
function navigationNames(m: string): { name: string; kind: string | null }[] {
  const out: { name: string; kind: string | null }[] = [];
  const re = new RegExp(`\\{\\s*\\[\\s*Name\\s*=\\s*${STR}(?:\\s*,\\s*Kind\\s*=\\s*${STR})?`, 'g');
  for (const x of m.matchAll(re)) {
    const name = unq(x[1]!);
    if (FILE_EXT_RE.test(name)) continue;
    out.push({ name, kind: x[2] != null ? unq(x[2]) : null });
  }
  // Databricks / Fabric style: [Name="x",Kind="Database"] inside a record without braces
  return out;
}

/** First table path a native SQL statement reads (`FROM a.b.c` / `JOIN a.b`). */
function sqlObject(sql: string): string | null {
  const m = sql.match(/\b(?:FROM|JOIN)\s+((?:[`"[]?[\w#$]+[`"\]]?\.){1,2}[`"[]?[\w#$]+[`"\]]?)/i);
  return m ? m[1]!.replace(/[`"[\]]/g, '') : null;
}

function nativeQuery(m: string): string | null {
  const nq = m.indexOf('Value.NativeQuery');
  if (nq !== -1) {
    // the SQL is the first string argument after the source expression
    const tail = m.slice(nq);
    const sql = strings(tail).find((s) => /\b(select|with)\b/i.test(s));
    if (sql) return sql.trim();
  }
  const opt = m.match(new RegExp(`\\[\\s*Query\\s*=\\s*${STR}`));
  if (opt) return unq(opt[1]!).trim();
  const odbc = calls(m, 'Odbc\\.Query').find((c) => c.b);
  return odbc?.b?.trim() ?? null;
}

const ITEM_RE = new RegExp(`\\[\\s*Item\\s*=\\s*${STR}\\s*,\\s*Kind\\s*=\\s*${STR}`, 'g');

function excelItems(m: string): { name: string; kind: string | null }[] {
  return [...m.matchAll(ITEM_RE)].map((x) => ({ name: unq(x[1]!), kind: unq(x[2]!) }));
}

function detectFormats(m: string): OriginFormat[] {
  const f: OriginFormat[] = [];
  if (/\bExcel\.Workbook\s*\(/.test(m)) f.push('excel');
  if (/\bCsv\.Document\s*\(/.test(m)) f.push('csv');
  if (/\bJson\.Document\s*\(/.test(m) && !isEmbedded(m)) f.push('json');
  if (/\bXml\.(Tables|Document)\s*\(/.test(m)) f.push('xml');
  if (/\bParquet\.Document\s*\(/.test(m)) f.push('parquet');
  if (/\bPdf\.Tables\s*\(/.test(m)) f.push('pdf');
  if (/\bLines\.FromBinary\s*\(/.test(m)) f.push('text');
  return f;
}

function isEmbedded(m: string): boolean {
  return /\bTable\.FromRows\s*\(\s*Json\.Document\s*\(\s*Binary\.Decompress/i.test(m) || /#table\s*\(/.test(m);
}

const DB_CONNECTORS: { fn: string; system: OriginSystem }[] = [
  { fn: 'Databricks\\.(?:Catalogs|Query|Contents)|DatabricksMultiCloud\\.(?:Catalogs|Query)|AzureDatabricks\\.\\w+', system: 'databricks' },
  { fn: 'Snowflake\\.Databases', system: 'snowflake' },
  { fn: 'Sql\\.Databases?|AzureSql\\.\\w+', system: 'sql_server' },
  { fn: 'PostgreSQL\\.Database', system: 'postgres' },
  { fn: 'Oracle\\.Database', system: 'oracle' },
  { fn: 'MySQL\\.Database', system: 'mysql' },
  { fn: 'Odbc\\.(?:Query|DataSource)', system: 'odbc' },
  { fn: 'Lakehouse\\.Contents|Fabric\\.Warehouse|PowerPlatform\\.Warehouse', system: 'fabric' },
  {
    fn: 'AmazonRedshift\\.Database|GoogleBigQuery\\.Database|Teradata\\.Database|SapHana\\.Database|Db2\\.Database|Sybase\\.Database|Informix\\.Database|AnalysisServices\\.Databases?',
    system: 'other_database',
  },
];

export function emptyOrigin(system: OriginSystem, connector: string | null = null): SourceOrigin {
  return { system, connector, format: null, location: null, folder: null, file: null, items: [], database: null, object: null, query: null, via: [] };
}

/** Origins found directly in one M text (no reference following). */
function originsInText(raw: string): { containers: SourceOrigin[]; formats: OriginFormat[]; items: { name: string; kind: string | null }[]; embedded: boolean } {
  const m = stripMComments(raw);
  const containers: SourceOrigin[] = [];
  const fileNames = strings(m).filter((s) => FILE_EXT_RE.test(s) && !/^https?:/i.test(s));
  const folderFilter = m.match(new RegExp(`\\[\\s*Folder Path\\s*\\]\\s*=\\s*${STR}`));
  const folder = folderFilter ? unq(folderFilter[1]!) : null;

  for (const c of calls(m, 'SharePoint\\.(?:Files|Contents|Tables)')) {
    const url = c.a ?? '';
    const sp = splitSharePointUrl(url);
    const o = emptyOrigin(sp.personal ? 'onedrive' : 'sharepoint', c.name);
    o.location = url || null;
    if (c.name.endsWith('Tables')) o.format = 'list';
    o.folder = folder;
    o.file = fileNames[0] ?? null;
    containers.push(o);
  }
  for (const c of calls(m, 'Web\\.Contents')) {
    const url = c.a ?? '';
    if (/sharepoint\.com/i.test(url)) {
      const sp = splitSharePointUrl(url);
      const o = emptyOrigin(sp.personal ? 'onedrive' : 'sharepoint', c.name);
      o.location = sp.site;
      o.file = sp.file ?? fileNames[0] ?? null;
      containers.push(o);
    } else {
      const o = emptyOrigin('web', c.name);
      o.location = url || null;
      o.file = url && FILE_EXT_RE.test(url.split('?')[0]!) ? basename(url) : null;
      containers.push(o);
    }
  }
  for (const c of calls(m, 'File\\.Contents')) {
    const o = emptyOrigin('local_file', c.name);
    o.location = c.a;
    o.file = c.a ? basename(c.a) : null;
    containers.push(o);
  }
  for (const c of calls(m, 'Folder\\.(?:Files|Contents)')) {
    const o = emptyOrigin('folder', c.name);
    o.location = c.a;
    o.file = fileNames[0] ?? null;
    containers.push(o);
  }
  for (const c of calls(m, 'OData\\.Feed')) {
    const o = emptyOrigin('odata', c.name);
    o.location = c.a;
    containers.push(o);
  }
  for (const c of calls(m, 'PowerPlatform\\.Dataflows|PowerBI\\.Dataflows|Dataflows\\.Contents')) {
    const o = emptyOrigin('dataflow', c.name);
    const rec = (k: string) => m.match(new RegExp(`\\b${k}\\s*=\\s*${STR}`, 'i'))?.[1];
    const ws = rec('workspaceName');
    const df = rec('dataflowName');
    const ent = rec('entity');
    o.location = ws ? unq(ws) : null;
    o.database = df ? unq(df) : null;
    o.object = ent ? unq(ent) : null;
    containers.push(o);
  }
  for (const { fn, system } of DB_CONNECTORS) {
    for (const c of calls(m, fn)) {
      const o = emptyOrigin(system, c.name);
      o.location = c.a;
      // Sql.Database(server, db) / PostgreSQL.Database(server, db): 2nd arg is the database;
      // Snowflake.Databases(host, warehouse) / Databricks.Catalogs(host, httpPath): it is not.
      const nav = navigationNames(m.slice(c.at));
      if (/\.Database$/.test(c.name) && c.b) o.database = c.b;
      else if (nav[0]) o.database = nav[0].name;
      const rest = (/\.Database$/.test(c.name) && c.b ? nav : nav.slice(1)).map((n) => n.name);
      o.query = nativeQuery(m);
      o.object = (o.query && sqlObject(o.query)) || (rest.length ? rest.join('.') : null);
      containers.push(o);
    }
  }

  return { containers, formats: detectFormats(m), items: excelItems(m), embedded: isEmbedded(m) };
}

/** Names of other queries (shared expressions / tables) an M text references. */
export function referencedQueries(m: string, known: Map<string, string>): string[] {
  const text = stripMComments(m);
  const out = new Set<string>();
  for (const x of text.matchAll(/#"((?:[^"]|"")*)"/g)) {
    const n = unq(x[1]!);
    if (known.has(n)) out.add(n);
  }
  // bare identifiers (Parameter1, Query1) that are query names, not steps of this query
  const steps = new Set([...text.matchAll(/^\s*([A-Za-z_][\w.]*)\s*=/gm)].map((x) => x[1]!));
  const bare = text.replace(/"(?:[^"]|"")*"/g, '""');
  for (const x of bare.matchAll(/(?<![#\w."])([A-Za-z_][\w]*)(?![\w"(.])/g)) {
    const n = x[1]!;
    if (!steps.has(n) && known.has(n)) out.add(n);
  }
  return [...out];
}

const keyOf = (o: SourceOrigin) =>
  [o.system, o.location?.toLowerCase(), o.file?.toLowerCase(), o.database?.toLowerCase(), o.object?.toLowerCase()].join('|');

/**
 * Origins of one table: its M plus every helper query it reaches (depth-limited, cycle-safe).
 * `queries` maps query name → M (shared expressions and other tables' partition M).
 */
/**
 * `catalog.schema.table` when Power Query navigates a warehouse catalog
 * (`Databricks.Catalogs` … `{[Name=…,Kind="Table"]}`) and does not send SQL.
 * Native-query partitions are left to `extractTablePathsFromSql`.
 */
export function warehouseNavigationPath(sourceM: string | null | undefined): string | null {
  for (const o of describeSourceOrigins(sourceM)) {
    if (o.query || (o.system !== 'databricks' && o.system !== 'fabric')) continue;
    if (!o.database || !o.object) continue;
    const parts = `${o.database}.${o.object}`.replace(/[`"[\]]/g, '').split('.').filter(Boolean);
    if (parts.length === 3 && parts.every((p) => /^[\w#$]+$/.test(p))) return parts.join('.').toLowerCase();
  }
  return null;
}

export function describeSourceOrigins(
  sourceM: string | null | undefined,
  queries: Map<string, string> = new Map(),
  opts: { partitionKind?: string | null; selfName?: string } = {},
): SourceOrigin[] {
  if (opts.partitionKind === 'calculated_table' || opts.partitionKind === 'auto_date_table') {
    return [emptyOrigin('calculated', null)];
  }
  const src = (sourceM ?? '').trim();
  if (!src) return [];
  if (!/^let\b/i.test(src) && !/\b[A-Z][A-Za-z]+\.[A-Z]\w*\s*\(/.test(src) && !/#"/.test(src)) {
    return [emptyOrigin('calculated', null)]; // DAX table expression
  }

  const visited = new Set<string>(opts.selfName ? [opts.selfName] : []);
  const containers = new Map<string, SourceOrigin>();
  const formats = new Set<OriginFormat>();
  const items: { name: string; kind: string | null }[] = [];
  let embedded = false;

  const walk = (text: string, via: string[], depth: number) => {
    const found = originsInText(text);
    for (const c of found.containers) {
      const k = keyOf(c);
      const prior = containers.get(k);
      if (prior) {
        prior.file ??= c.file;
        prior.folder ??= c.folder;
        prior.query ??= c.query;
      } else containers.set(k, { ...c, via });
    }
    found.formats.forEach((f) => f && formats.add(f));
    items.push(...found.items);
    embedded ||= found.embedded;
    if (depth >= 8) return;
    for (const ref of referencedQueries(text, queries)) {
      if (visited.has(ref)) continue;
      visited.add(ref);
      walk(queries.get(ref)!, [...via, ref], depth + 1);
    }
  };
  walk(src, [], 0);

  const out = [...containers.values()];
  // Files: attach the format and the sheets / tables read from them (found in helper queries).
  const uniqueItems = [...new Map(items.map((i) => [`${i.name}\0${i.kind}`, i])).values()];
  for (const o of out) {
    if (originClass(o) !== 'file' || o.format === 'list') continue;
    o.format ??= formatFromName(o.file) ?? (formats.size === 1 ? [...formats][0]! : formats.has('excel') ? 'excel' : null);
    if (o.format === 'excel') o.items = uniqueItems;
  }
  // A SharePoint/folder container without a file filter in the same text: take the one file the
  // closure filters on (e.g. `Sample File` helper → [Name] = "x.xlsx").
  if (out.length > 1) {
    const withFile = out.filter((o) => o.file);
    for (const o of out) if (!o.file && withFile.length === 1 && withFile[0]!.system === o.system) o.file = withFile[0]!.file;
  }
  const merged = [...new Map(out.map((o) => [keyOf(o), o])).values()];
  if (!merged.length && embedded) return [emptyOrigin('embedded', 'Table.FromRows')];
  if (!merged.length) return [emptyOrigin('unknown', null)];
  return merged;
}

const SYSTEM_LABEL: Record<OriginSystem, string> = {
  databricks: 'Databricks',
  snowflake: 'Snowflake',
  sql_server: 'SQL Server',
  postgres: 'PostgreSQL',
  oracle: 'Oracle',
  mysql: 'MySQL',
  odbc: 'ODBC',
  fabric: 'Microsoft Fabric',
  other_database: 'Database',
  sharepoint: 'SharePoint',
  onedrive: 'OneDrive (personal)',
  local_file: 'File path',
  folder: 'Folder',
  web: 'Web',
  odata: 'OData feed',
  dataflow: 'Power BI dataflow',
  embedded: 'Entered in Power BI',
  calculated: 'DAX calculated table',
  unknown: 'Unknown source',
};

const FORMAT_LABEL: Record<Exclude<OriginFormat, null>, string> = {
  excel: 'Excel file',
  csv: 'CSV file',
  json: 'JSON file',
  xml: 'XML file',
  parquet: 'Parquet file',
  pdf: 'PDF file',
  text: 'Text file',
  list: 'list',
};

/** Short title, e.g. "Excel file on SharePoint", "Snowflake", "SharePoint list". */
export function originTitle(o: SourceOrigin): string {
  if (o.format === 'list') return `${SYSTEM_LABEL[o.system]} list`;
  if (o.format && originClass(o) === 'file') {
    const where = o.system === 'local_file' ? 'on a file path' : `on ${SYSTEM_LABEL[o.system]}`;
    return `${FORMAT_LABEL[o.format]} ${where}`;
  }
  if (o.connector === 'Odbc.Query' || o.connector === 'Odbc.DataSource') return 'ODBC';
  if (o.system === 'other_database' && o.connector) return o.connector.replace(/\.Databases?$/, '');
  return SYSTEM_LABEL[o.system];
}

/** One line with the details, e.g. `Excel file "x.xlsx" (table ProcessSheet) on SharePoint site https://…`. */
export function describeOrigin(o: SourceOrigin): string {
  const items = o.items.length ? ` (${o.items.map((i) => `${(i.kind ?? 'item').toLowerCase()} ${i.name}`).join(', ')})` : '';
  switch (originClass(o)) {
    case 'file': {
      const what = o.format && o.format !== 'list' ? FORMAT_LABEL[o.format] : o.format === 'list' ? 'List' : 'Data';
      const file = o.file ? ` "${o.file}"` : '';
      const where =
        o.system === 'sharepoint' || o.system === 'onedrive'
          ? ` on ${SYSTEM_LABEL[o.system]} site ${o.location ?? '?'}${o.folder ? ` (folder ${o.folder})` : ''}`
          : o.system === 'dataflow'
            ? ` from dataflow ${o.database ?? '?'}${o.object ? ` / ${o.object}` : ''}${o.location ? ` in workspace ${o.location}` : ''}`
            : o.location
              ? ` at ${o.location}`
              : '';
      return `${what}${file}${items}${where}`;
    }
    case 'database':
    case 'warehouse': {
      const db = [o.database, o.object].filter(Boolean).join(' / ');
      return `${originTitle(o)}${o.location ? ` ${o.location}` : ''}${db ? ` — ${db}` : ''}${o.query && !o.object ? ' (native query)' : ''}`;
    }
    default:
      return originTitle(o);
  }
}

/** Query map for `describeSourceOrigins`: shared expressions plus every table's partition M. */
export function buildQueryMap(
  expressions: { name: string; m: string }[] | null | undefined,
  tables: { name: string; source_m: string | null }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of expressions ?? []) if (e?.name && e.m) map.set(e.name, e.m);
  for (const t of tables) if (t.source_m && !map.has(t.name)) map.set(t.name, t.source_m);
  return map;
}

/** Shared expressions stored on the model at parse time (`props.expressions`). */
export function readModelExpressions(props: unknown): { name: string; m: string }[] {
  const raw = (props as Record<string, unknown> | null)?.expressions;
  return Array.isArray(raw)
    ? raw.filter((e): e is { name: string; m: string } => typeof e?.name === 'string' && typeof e?.m === 'string')
    : [];
}

/**
 * `expressions.tmdl` → shared expressions (`expression Name = <M>`). The M is either on the header
 * line (single line) or on the following lines indented one level deeper than the properties.
 */
export function parseTmdlExpressions(text: string): { name: string; m: string }[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: { name: string; m: string }[] = [];
  let cur: { name: string; body: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    // trailing ` meta [...]` on parameter expressions is kept: it holds the referenced query
    const m = cur.body.join('\n').trim();
    if (m) out.push({ name: cur.name, m });
    cur = null;
  };
  for (const line of lines) {
    const head = line.match(/^expression\s+('(?:[^']|'')+'|[^\s=]+)\s*=\s*(.*)$/);
    if (head) {
      flush();
      const name = head[1]!.startsWith("'") ? head[1]!.slice(1, -1).replace(/''/g, "'") : head[1]!;
      cur = { name, body: head[2]!.trim() && head[2]!.trim() !== '```' ? [head[2]!] : [] };
      continue;
    }
    if (!cur) continue;
    if (/^\t\t/.test(line) || (line.trim() === '' && cur.body.length)) {
      cur.body.push(line.replace(/^\t\t/, ''));
    } else if ((/^\t[^\t]/.test(line) && cur.body.length) || /^\S/.test(line)) {
      // a property line (lineageTag, queryGroup, annotation …) or the next object ends the M body
      flush();
    }
  }
  flush();
  return out;
}

/** Display name for a source system, e.g. `sql_server` → "SQL Server". */
export function systemLabel(system: OriginSystem): string {
  return SYSTEM_LABEL[system] ?? system;
}
