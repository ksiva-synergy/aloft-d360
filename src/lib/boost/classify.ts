export type ToolKind = 'catalog' | 'data' | 'discovery' | 'error';

export function classifyToolCall(input: {
  tool: string;
  sql?: string;
  status: 'success' | 'error';
}): ToolKind {
  if (input.status === 'error') return 'error';

  if (input.tool === 'describe_schema') return 'catalog';

  if (input.sql) {
    const sql = input.sql.trim();

    if (/^\s*(SHOW|DESCRIBE|DESC)\b/i.test(sql)) return 'discovery';

    if (/INFORMATION_SCHEMA/i.test(sql)) return 'discovery';

    if (isBlindSample(sql)) return 'discovery';
  }

  return 'data';
}

/**
 * Detects blind sampling: SELECT * ... LIMIT n with no GROUP BY and no WHERE.
 * Whitespace-tolerant, case-insensitive.
 */
function isBlindSample(sql: string): boolean {
  const normalized = sql.replace(/\s+/g, ' ').trim();
  const upper = normalized.toUpperCase();

  if (!upper.startsWith('SELECT')) return false;

  const hasSelectStar = /^SELECT\s+\*/i.test(normalized);
  if (!hasSelectStar) return false;

  const hasLimit = /\bLIMIT\s+\d+/i.test(normalized);
  if (!hasLimit) return false;

  const hasGroupBy = /\bGROUP\s+BY\b/i.test(normalized);
  const hasWhere = /\bWHERE\b/i.test(normalized);

  return !hasGroupBy && !hasWhere;
}
