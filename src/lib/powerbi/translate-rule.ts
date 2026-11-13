/** Rule-tier DAX → SQL (v1: single-table aggregates on bound UC paths). */

const SUM_RE = /^\s*SUM\s*\(\s*'?([^']+)'?\[([^\]]+)\]\s*\)\s*$/i;
const COUNT_RE = /^\s*COUNT\s*\(\s*'?([^']+)'?\[([^\]]+)\]\s*\)\s*$/i;
const DISTINCTCOUNT_RE = /^\s*DISTINCTCOUNT\s*\(\s*'?([^']+)'?\[([^\]]+)\]\s*\)\s*$/i;

function quoteIdent(name: string): string {
  const safe = name.replace(/`/g, '');
  return `\`${safe}\``;
}

function ucPathToFromClause(ucFullPath: string): string | null {
  const parts = ucFullPath.split('.').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  return parts.map(quoteIdent).join('.');
}

export function tryRuleTierSql(input: {
  dax: string;
  tableName: string;
  ucFullPath: string | null;
  columnName?: string | null;
  /** PBI column name → warehouse column name (catalog-resolved). */
  columnMap?: Record<string, string>;
}): { sql: string; pattern: string } | null {
  if (!input.ucFullPath) return null;
  const from = ucPathToFromClause(input.ucFullPath);
  if (!from) return null;

  const dax = input.dax.trim();
  let col: string | null = null;
  let agg: 'SUM' | 'COUNT' | 'COUNT DISTINCT' | null = null;

  const sumM = dax.match(SUM_RE);
  if (sumM) {
    if (sumM[1] !== input.tableName) return null;
    col = sumM[2];
    agg = 'SUM';
  }

  const countM = dax.match(COUNT_RE);
  if (!agg && countM) {
    if (countM[1] !== input.tableName) return null;
    col = countM[2];
    agg = 'COUNT';
  }

  const dcM = dax.match(DISTINCTCOUNT_RE);
  if (!agg && dcM) {
    if (dcM[1] !== input.tableName) return null;
    col = dcM[2];
    agg = 'COUNT DISTINCT';
  }

  if (!agg || !col) return null;
  if (input.columnName && col !== input.columnName) {
    /* column binding refinement later */
  }

  const warehouseCol = input.columnMap?.[col] ?? col;
  const aggSql =
    agg === 'COUNT DISTINCT'
      ? `COUNT(DISTINCT ${quoteIdent(warehouseCol)})`
      : `${agg}(${quoteIdent(warehouseCol)})`;

  const sql = `SELECT ${aggSql} AS value\nFROM ${from}`;
  return { sql, pattern: agg };
}
