const FORBIDDEN_SQL = /\b(DROP|DELETE|INSERT|UPDATE|MERGE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i;

export function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

export function validateLlmSql(sql: string): string | null {
  const s = sql.trim();
  if (!s) return null;
  if (!/^\s*(WITH\b[\s\S]*)?\s*SELECT\b/i.test(s)) return null;
  if (FORBIDDEN_SQL.test(s)) return null;
  return s;
}

const SQL_SKIP_WORDS = new Set(
  [
    'select',
    'from',
    'where',
    'group',
    'by',
    'order',
    'having',
    'limit',
    'as',
    'and',
    'or',
    'not',
    'in',
    'is',
    'null',
    'case',
    'when',
    'then',
    'else',
    'end',
    'with',
    'distinct',
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'cast',
    'coalesce',
    'if',
    'value',
    'true',
    'false',
    'on',
    'join',
    'left',
    'right',
    'inner',
    'outer',
    'cross',
    'union',
    'all',
    'between',
    'like',
    'escape',
  ].map((w) => w.toLowerCase()),
);

/** Identifiers in backticks from generated SQL (warehouse column candidates). */
export function extractSqlBacktickIdentifiers(sql: string): string[] {
  const ids: string[] = [];
  for (const m of sql.matchAll(/`([^`]+)`/g)) {
    const name = m[1].trim();
    if (name && !ids.includes(name)) ids.push(name);
  }
  return ids;
}

/**
 * When allowlist is non-empty, flag backtick ids that are not catalog parts
 * (3-part UC paths are allowed) nor allowlisted columns (case-insensitive).
 */
function sqlExpressionRegions(sql: string): string {
  const chunks: string[] = [];
  const selectFrom = sql.match(/\bSELECT\b([\s\S]*?)\bFROM\b/i);
  if (selectFrom) chunks.push(selectFrom[1]);
  const where = sql.match(/\bWHERE\b([\s\S]*?)(?:\bGROUP\b|\bORDER\b|\bLIMIT\b|;|$)/i);
  if (where) chunks.push(where[1]);
  return chunks.join('\n');
}

export function validateSqlAgainstAllowlist(
  sql: string,
  allowedColumns: string[],
): { ok: boolean; invalid: string[] } {
  if (allowedColumns.length === 0) {
    return { ok: true, invalid: [] };
  }
  const allow = new Set(allowedColumns.map((c) => c.toLowerCase()));
  const invalid: string[] = [];
  const region = sqlExpressionRegions(sql);
  for (const id of extractSqlBacktickIdentifiers(region)) {
    const parts = id.split('.');
    if (parts.length >= 2) continue;
    const lower = id.toLowerCase();
    if (SQL_SKIP_WORDS.has(lower)) continue;
    if (!allow.has(lower)) invalid.push(id);
  }
  return { ok: invalid.length === 0, invalid };
}
