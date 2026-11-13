/** Resolve Unity Catalog paths when measures live on unbound measure tables. */

export type TableUcRow = {
  uc: string;
  nativeSql: string | null;
  contextObjectId?: string | null;
};

/** Table names referenced as `'Name'[column]` or `Name[column]` in DAX. */
export type DaxColumnRef = { table: string; column: string };

const DAX_FUNC_SKIP =
  /^(SUM|COUNT|DISTINCTCOUNT|DISTINCTCOUNTNOBLANK|CALCULATE|FILTER|IF|DIVIDE|VAR|RETURN|MAX|MIN|AVERAGE|AVERAGEX|SUMX|SWITCH|TRUE|FALSE|BLANK|COALESCE|EDATE|DATEDATE|VALUES|ALL|REMOVEFILTERS|AND|OR|NOT|IN|SELECTEDVALUE|SELECTEDMEASURE|ISBLANK)$/i;

function stripDaxLineComments(dax: string): string {
  return dax.replace(/\/\/.*$/gm, '');
}

/** PBI column refs: `'Table'[Column]` and `Table[Column]` (unquoted table names). */
export function extractDaxColumnRefs(dax: string): DaxColumnRef[] {
  const daxBody = stripDaxLineComments(dax);
  const seen = new Set<string>();
  const refs: DaxColumnRef[] = [];
  const push = (table: string, column: string) => {
    const key = `${table.toLowerCase()}\0${column.toLowerCase()}`;
    if (!column || seen.has(key)) return;
    if (DAX_FUNC_SKIP.test(table.trim())) return;
    if (isSkippableRef(table)) return;
    seen.add(key);
    refs.push({ table: table.trim(), column: column.trim() });
  };

  const quoted = /'([^']+)'\s*\[([^\]]+)\]/g;
  for (const m of daxBody.matchAll(quoted)) {
    push(m[1], m[2]);
  }

  const bare = /(?:^|[^\w'])((?:[A-Za-z_][\w\s]*)?)\[([^\]]+)\]/g;
  for (const m of daxBody.matchAll(bare)) {
    const table = m[1].trim();
    if (!table || table.startsWith("'")) continue;
    push(table, m[2]);
  }
  return refs;
}

export function extractDaxTableNames(dax: string): string[] {
  const refs = new Set<string>();
  const quoted = /'([^']+)'\s*\[/g;
  for (const m of dax.matchAll(quoted)) refs.add(m[1].trim());

  const bare = /(?:^|[^\w'])((?:[A-Za-z_][\w\s]*)?)\[/g;
  for (const m of dax.matchAll(bare)) {
    const name = m[1].trim();
    if (
      name &&
      !/^(SUM|COUNT|DISTINCTCOUNT|CALCULATE|FILTER|IF|DIVIDE|VAR|RETURN|MAX|MIN|AVERAGE|SWITCH|TRUE|FALSE|BLANK|COALESCE|EDATE|DATEDIFF|VALUES|ALL|REMOVEFILTERS|AND|OR|NOT|IN)$/i.test(
        name,
      )
    ) {
      refs.add(name);
    }
  }
  return [...refs];
}

const DAX_REF_SKIP = new Set([
  'calendar',
  'localdatetable',
  'datetabletemplate',
  'measure',
  'measure2',
]);

/** Strip a single pair of surrounding quotes from TMDL/parse table names. */
export function normalizePbiTableName(name: string): string {
  const t = name.trim();
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function normalizeTableKey(name: string): string {
  return normalizePbiTableName(name).toLowerCase();
}

function isSkippableRef(name: string): boolean {
  const n = normalizeTableKey(name);
  if (DAX_REF_SKIP.has(n)) return true;
  if (n.startsWith('localdatetable_')) return true;
  if (n.startsWith('datetabletemplate')) return true;
  return false;
}

export function resolveUcForMeasure(input: {
  dax: string;
  homeTableName: string;
  homeUc: string | null;
  homeNativeSql: string | null;
  modelTables: Map<string, TableUcRow>;
}): {
  uc: string;
  sourceTable: string;
  nativeSql: string | null;
  via: 'home_table' | 'dax_ref';
} | null {
  if (input.homeUc) {
    return {
      uc: input.homeUc,
      sourceTable: input.homeTableName,
      nativeSql: input.homeNativeSql,
      via: 'home_table',
    };
  }

  const refs = extractDaxTableNames(input.dax);
  for (const ref of refs) {
    if (isSkippableRef(ref)) continue;
    const row =
      input.modelTables.get(ref) ??
      [...input.modelTables.entries()].find(
        ([k]) => normalizeTableKey(k) === normalizeTableKey(ref),
      )?.[1];
    if (row?.uc) {
      return { uc: row.uc, sourceTable: ref, nativeSql: row.nativeSql, via: 'dax_ref' };
    }
  }
  return null;
}
