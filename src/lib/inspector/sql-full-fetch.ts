import { CHAT_QUERY_RESULT_MAX_ROWS } from './result-display';

const TRAILING_LIMIT_RE = /\blimit\s+(\d+)\s*;?\s*$/i;

/** LIMIT at the end of the statement (Ask Data samples almost always use this). */
export function parseTrailingSqlLimit(sql: string): number | null {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  const m = trimmed.match(TRAILING_LIMIT_RE);
  return m ? parseInt(m[1], 10) : null;
}

/** Re-run with a higher ceiling when the model used a small sampling LIMIT. */
export function expandSqlForFullTable(
  sql: string,
  maxRows: number = CHAT_QUERY_RESULT_MAX_ROWS,
): string {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (TRAILING_LIMIT_RE.test(trimmed)) {
    return trimmed.replace(TRAILING_LIMIT_RE, `LIMIT ${maxRows}`);
  }
  return trimmed;
}

export function needsFullTableWarehouseRefetch(result: {
  sql: string;
  rows: unknown[];
  rowCount: number;
  truncated: boolean;
}): boolean {
  const limit = parseTrailingSqlLimit(result.sql);
  if (limit != null && limit < CHAT_QUERY_RESULT_MAX_ROWS) return true;
  if (result.rowCount > result.rows.length) return true;
  return result.truncated && result.rows.length < CHAT_QUERY_RESULT_MAX_ROWS;
}
