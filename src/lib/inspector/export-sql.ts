/**
 * Helpers for Inspector CSV export — keep agent from inventing multi-source dumps.
 */

/** True if SQL combines multiple sources via JOIN or UNION (string/comment-safe-ish). */
export function sqlHasMultiSourceCombine(sql: string): boolean {
  const stripped = sql
    .replace(/'(?:[^']|'')*'/g, "'__STR__'")
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
  return /\bUNION\b/i.test(stripped) || /\bJOIN\b/i.test(stripped);
}

/** Remove a trailing LIMIT n so export can return the full capped extract. */
export function stripTrailingLimit(sql: string): string {
  return sql.replace(/\s+LIMIT\s+\d+\s*;?\s*$/i, '').trim();
}

/**
 * Resolve which SQL to export.
 * - Default: last successful preview SQL (LIMIT stripped).
 * - Override statement allowed only when it does not JOIN/UNION, OR allowCombined.
 */
export function resolveExportSql(input: {
  statement?: string;
  lastSql?: string;
  allowCombined?: boolean;
}): { sql: string; source: 'last' | 'override' } | { error: string } {
  const last = input.lastSql?.trim() ?? '';
  const override = input.statement?.trim() ?? '';

  if (!override) {
    if (!last) {
      return {
        error:
          'No SQL available to export — run execute_tool first (single-table preview), then call export_query_result without a statement override.',
      };
    }
    return { sql: stripTrailingLimit(last), source: 'last' };
  }

  if (sqlHasMultiSourceCombine(override) && !input.allowCombined) {
    if (last && !sqlHasMultiSourceCombine(last)) {
      return { sql: stripTrailingLimit(last), source: 'last' };
    }
    return {
      error:
        'EXPORT_COMBINE_REJECTED: export_query_result refuses JOIN/UNION rewrites unless the user explicitly asked for a combined extract and you pass allow_combined:true. ' +
        'Export the last successful single-table query instead (omit statement), or preview a simple SELECT * … WHERE … first.',
    };
  }

  return { sql: stripTrailingLimit(override), source: 'override' };
}
