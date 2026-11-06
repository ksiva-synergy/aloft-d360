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

function normalize(sql: string): string {
  return stripBacktickIdentifiers(stripStringLiterals(stripComments(sql))).replace(/\s+/g, ' ').trim();
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
  if (parts.some((p) => !/^[a-zA-Z0-9_$]+$/.test(p))) return null;
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

function scanFromJoins(cleaned: string, cteNames: Set<string>): ExtractTablesResult {
  const paths = new Set<string>();
  const re = /\b(?:from|join)\s+([^\s,()]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    let raw = m[1]!.trim();
    if (raw.toLowerCase() === 'lateral') {
      raw = cleaned.slice(m.index + m[0].length).trim().split(/\s+/)[0] ?? '';
    }
    if (raw.includes('(')) {
      return { ok: false, reason: 'Table-valued functions cannot be authorized.' };
    }
    const path = parseQualifiedTable(raw);
    if (!path) {
      const bare = raw.split('.')[0]?.toLowerCase();
      if (bare && cteNames.has(bare)) continue;
      return { ok: false, reason: 'Use fully qualified catalog.schema.table names in SQL.' };
    }
    if (isForbiddenPath(path)) {
      return { ok: false, reason: `Access to ${path} is not permitted.` };
    }
    paths.add(path);
  }
  return { ok: true, paths: [...paths].sort() };
}

export function extractTables(sql: string): ExtractTablesResult {
  const cleaned = normalize(sql);
  const upper = cleaned.toUpperCase();

  if (/\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE)\b/.test(upper)) {
    return { ok: false, reason: 'Mutating or DDL statements are not allowed.' };
  }

  if (/\b(?:SHOW|USE)\b/.test(upper)) {
    return { ok: false, reason: 'SHOW and USE are not allowed — use describe_schema for discovery.' };
  }

  if (/\b(?:DESCRIBE|DESC)\b/.test(upper)) {
    return { ok: false, reason: 'DESCRIBE is not allowed — use describe_schema.' };
  }

  if (/\bIDENTIFIER\s*\(/i.test(cleaned)) {
    return { ok: false, reason: 'Dynamic IDENTIFIER() references cannot be authorized.' };
  }

  const cteNames = collectCteNames(cleaned);
  const main = scanFromJoins(cleaned, cteNames);
  if (!main.ok) return main;

  const paths = new Set(main.paths);
  const nestedRe = /\(\s*select[\s\S]*?\)/gi;
  let nm: RegExpExecArray | null;
  while ((nm = nestedRe.exec(cleaned))) {
    const inner = scanFromJoins(nm[0]!, cteNames);
    if (!inner.ok) return inner;
    for (const p of inner.paths) paths.add(p);
  }

  const sorted = [...paths].sort();
  if (sorted.length === 0) {
    return { ok: true, paths: [] };
  }

  return { ok: true, paths: sorted };
}

/** EXPLAIN wraps an inner statement — extract from the inner SQL when present. */
export function extractTablesForAuthorization(sql: string): ExtractTablesResult {
  const trimmed = sql.trim();
  if (/^explain\s+/i.test(trimmed)) {
    return extractTables(trimmed.replace(/^explain\s+(?:extended\s+|formatted\s+|cost\s+)?/i, ''));
  }
  return extractTables(trimmed);
}
