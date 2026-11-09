/**
 * Fail-closed SQL table reference extractor (option A — tokenizer).
 * Only fully-qualified catalog.schema.table names are accepted.
 */

const FORBIDDEN_PREFIXES = ['system.', 'information_schema.', 'samples.'];

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

function stripStringLiterals(sql: string): string {
  return sql.replace(/'(?:''|[^'])*'/g, " '' ");
}

/** Replace backtick-quoted segments with unquoted text for scanning. */
function stripBacktickIdentifiers(sql: string): string {
  return sql.replace(/`((?:[^`]|``)*)`/g, (_, inner: string) => inner.replace(/``/g, '`'));
}

/**
 * Functions whose arguments use the FROM keyword (`EXTRACT(YEAR FROM d)`, `TRIM(BOTH ' ' FROM s)`,
 * `SUBSTRING(s FROM 1 FOR 3)`, `OVERLAY(... PLACING ... FROM ...)`, `POSITION(a IN b)`): that FROM is
 * not a table reference, so it is replaced before scanning.
 */
function neutralizeFunctionFrom(sql: string): string {
  const re = /\b(?:extract|trim|substring|substr|overlay|position)\s*\(/gi;
  let out = sql;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < out.length && depth > 0; i++) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')') depth--;
    }
    // Only FROM at the function's own level; a sub-query inside keeps its FROM for the scanner.
    let inner = out.slice(start, i - 1);
    let level = 0;
    let rebuilt = '';
    for (let k = 0; k < inner.length; k++) {
      const ch = inner[k]!;
      if (ch === '(') level++;
      else if (ch === ')') level--;
      if (level === 0 && /^from\b/i.test(inner.slice(k)) && (k === 0 || !/\w/.test(inner[k - 1]!))) {
        rebuilt += ',   ';
        k += 3;
        continue;
      }
      rebuilt += ch;
    }
    inner = rebuilt;
    out = out.slice(0, start) + inner + out.slice(i - 1);
  }
  return out;
}

function normalize(sql: string): string {
  return neutralizeFunctionFrom(stripBacktickIdentifiers(stripStringLiterals(stripComments(sql))))
    // `a IS [NOT] DISTINCT FROM b` compares values; it isn't a table reference.
    .replace(/\bis\s+(not\s+)?distinct\s+from\b/gi, (_, not) => `is ${not ?? ''}distinct_cmp`)
    .replace(/\s+/g, ' ')
    .trim();
}

function isForbiddenPath(path: string): boolean {
  const p = path.toLowerCase();
  return FORBIDDEN_PREFIXES.some((prefix) => p.startsWith(prefix));
}

function parseQualifiedTable(raw: string): string | null {
  const token = raw.replace(/,$/, '').trim();
  if (!token || /\($/.test(token) || token.includes('(')) return null;
  const parts = token.split('.').filter(Boolean);
  if (parts.length !== 3) return null;
  // Hyphens appear in backticked Databricks names (e.g. `synergymarine-export-prod`).
  if (parts.some((p) => !/^[a-zA-Z0-9_$-]+$/.test(p))) return null;
  return parts.join('.').toLowerCase();
}

function collectCteNames(sql: string): Set<string> {
  const names = new Set<string>();
  const re = /\b([a-zA-Z_][\w$]*)\s+as\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) names.add(m[1]!.toLowerCase());
  return names;
}

export type ExtractTablesResult =
  | { ok: true; paths: string[] }
  | { ok: false; reason: string };

/** Words that end a FROM list (or a single JOIN source). */
const FROM_END = new Set([
  'where', 'group', 'having', 'order', 'limit', 'offset', 'fetch', 'qualify', 'window', 'union', 'intersect', 'except',
  'minus', 'join', 'inner', 'left', 'right', 'full', 'outer', 'cross', 'natural', 'semi', 'anti', 'on', 'using',
  'cluster', 'distribute', 'sort', 'select',
]);
/** Words after a table that the reader doesn't understand: refuse rather than guess what follows them. */
const FROM_UNSUPPORTED = new Set(['lateral', 'pivot', 'unpivot', 'tablesample', 'values']);

const UNRESOLVED = 'Use fully qualified catalog.schema.table names in SQL.';

/** Index just past the bracket that closes the one at `open`, or -1. */
function closeParen(sql: string, open: number): number {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Read every source after FROM / JOIN, including comma-separated lists (`FROM a.b.c x, d.e.f y`).
 * Sub-queries are skipped here: their own FROM is found by the global scan. Anything not understood fails closed.
 */
function readSources(sql: string, at: number, cteNames: Set<string>, single: boolean): { names: string[]; fail?: string } {
  const names: string[] = [];
  let i = at;
  const ws = () => {
    while (i < sql.length && sql[i] === ' ') i++;
  };
  const word = () => /^[^\s,()]+/.exec(sql.slice(i))?.[0] ?? '';
  for (;;) {
    ws();
    let w = word();
    if (w.toLowerCase() === 'lateral') {
      i += w.length;
      ws();
      w = word();
    }
    if (sql[i] === '(') {
      // Sub-query or bracketed join: its tables are found by the global scan.
      const end = closeParen(sql, i);
      if (end < 0) return { names, fail: UNRESOLVED };
      i = end;
    } else {
      if (!w) return { names, fail: UNRESOLVED };
      i += w.length;
      if (sql[i] === '(') return { names, fail: 'Table-valued functions cannot be authorized.' };
      const path = parseQualifiedTable(w);
      if (!path) {
        const bare = w.split('.')[0]?.toLowerCase();
        if (!(bare && w.indexOf('.') < 0 && cteNames.has(bare))) return { names, fail: UNRESOLVED };
      } else {
        if (isForbiddenPath(path)) return { names, fail: `Access to ${path} is not permitted.` };
        names.push(path);
      }
    }
    // Delta time travel: `TIMESTAMP AS OF x` / `VERSION AS OF n`.
    ws();
    const tt = /^(?:timestamp|version)\s+as\s+of\s+[^\s,()]+/i.exec(sql.slice(i));
    if (tt) i += tt[0].length;
    // Optional alias, with an optional column list: `AS t`, `t`, `t (a, b)`.
    ws();
    let a = word();
    if (a.toLowerCase() === 'as') {
      i += a.length;
      ws();
      a = word();
      if (!a) return { names, fail: UNRESOLVED };
    }
    if (a && !FROM_END.has(a.toLowerCase()) && !FROM_UNSUPPORTED.has(a.toLowerCase())) {
      i += a.length;
      ws();
      if (sql[i] === '(') {
        const end = closeParen(sql, i);
        if (end < 0) return { names, fail: UNRESOLVED };
        i = end;
      }
    }
    ws();
    if (sql[i] === ',' && !single) {
      i++;
      continue;
    }
    if (i >= sql.length || sql[i] === ')' || sql[i] === ';' || sql[i] === ',') return { names };
    const next = word().toLowerCase();
    if (FROM_END.has(next)) return { names };
    return { names, fail: `Unsupported SQL after a table name ("${next || sql[i]}"). Rewrite the query without it.` };
  }
}

/** Clause words that end a FROM clause (JOIN and ON don't: they are part of it). */
const CLAUSE_END = /^(?:where|group|having|order|limit|offset|fetch|qualify|window|union|intersect|except|minus|cluster|distribute|sort|select)\b/i;

/**
 * Positions of commas at the FROM clause's own bracket level. Each one starts another source,
 * including after a join condition: `FROM a JOIN b ON a.id = b.id, c`.
 */
function fromClauseCommas(sql: string, start: number): number[] {
  const out: number[] = [];
  let depth = 0;
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i]!;
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0) {
      if (ch === ',') out.push(i);
      else if (ch === ';') break;
      else if (/\w/.test(ch) && (i === 0 || !/\w/.test(sql[i - 1]!)) && CLAUSE_END.test(sql.slice(i))) break;
    }
  }
  return out;
}

function scanFromJoins(cleaned: string, cteNames: Set<string>): ExtractTablesResult {
  const paths = new Set<string>();
  const re = /\b(from|join)\s+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const after = m.index + m[0].length;
    const isFrom = m[1]!.toLowerCase() === 'from';
    const starts = [after, ...(isFrom ? fromClauseCommas(cleaned, after).map((c) => c + 1) : [])];
    for (const at of starts) {
      const r = readSources(cleaned, at, cteNames, !isFrom || at !== after);
      if (r.fail) return { ok: false, reason: r.fail };
      for (const p of r.names) paths.add(p);
    }
  }
  return { ok: true, paths: [...paths].sort() };
}

export function extractTables(sql: string): ExtractTablesResult {
  const cleaned = normalize(sql);
  const upper = cleaned.toUpperCase();

  if (/\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE)\b/.test(upper)) {
    return { ok: false, reason: 'Mutating or DDL statements are not allowed.' };
  }

  // Only as the statement itself: `ORDER BY x DESC` and a column called `show` are fine.
  // (One statement per call is enforced by the executor.)
  if (/^(?:SHOW|USE)\b/.test(upper)) {
    return { ok: false, reason: 'SHOW and USE are not allowed — use describe_schema for discovery.' };
  }

  if (/^(?:DESCRIBE|DESC)\b/.test(upper)) {
    return { ok: false, reason: 'DESCRIBE is not allowed — use describe_schema.' };
  }

  if (/\bIDENTIFIER\s*\(/i.test(cleaned)) {
    return { ok: false, reason: 'Dynamic IDENTIFIER() references cannot be authorized.' };
  }

  const cteNames = collectCteNames(cleaned);

  // `TABLE a.b.c` is shorthand for SELECT * FROM a.b.c.
  if (/^TABLE\b/.test(upper)) {
    const r = readSources(cleaned, 'table'.length, cteNames, true);
    if (r.fail) return { ok: false, reason: r.fail };
    return { ok: true, paths: [...new Set(r.names)].sort() };
  }

  // The scan covers the whole statement, so FROM inside sub-queries and CTE bodies is read too.
  return scanFromJoins(cleaned, cteNames);
}

/** EXPLAIN wraps an inner statement — extract from the inner SQL when present. */
export function extractTablesForAuthorization(sql: string): ExtractTablesResult {
  const trimmed = sql.trim();
  if (/^explain\s+/i.test(trimmed)) {
    return extractTables(trimmed.replace(/^explain\s+(?:extended\s+|formatted\s+|cost\s+)?/i, ''));
  }
  return extractTables(trimmed);
}
