/** Compare Power BI oracle scalars vs Databricks SQL (v1 pilot). */

const DEFAULT_REL_TOL = 0.01;
const DEFAULT_ABS_TOL = 0.05;

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function extractOracleScalar(preview: unknown): number | null {
  if (!Array.isArray(preview) || preview.length === 0) return null;
  const row = preview[0];
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  for (const key of ['Value', 'value', '[Value]']) {
    const n = toFiniteNumber(record[key]);
    if (n !== null) return n;
  }
  for (const v of Object.values(record)) {
    const n = toFiniteNumber(v);
    if (n !== null) return n;
  }
  return null;
}

export function extractSqlScalar(rows: Record<string, unknown>[]): number | null {
  if (rows.length === 0) return null;
  const row = rows[0]!;
  for (const key of ['value', 'Value', '__value']) {
    const n = toFiniteNumber(row[key]);
    if (n !== null) return n;
  }
  for (const v of Object.values(row)) {
    const n = toFiniteNumber(v);
    if (n !== null) return n;
  }
  return null;
}

export function scalarsWithinTolerance(
  oracle: number,
  sql: number,
  relTol = DEFAULT_REL_TOL,
  absTol = DEFAULT_ABS_TOL,
): boolean {
  const diff = Math.abs(oracle - sql);
  if (diff <= absTol) return true;
  const denom = Math.max(Math.abs(oracle), Math.abs(sql), 1e-12);
  return diff / denom <= relTol;
}

export type ParityVerdict = 'pass' | 'fail' | 'skipped' | 'error';

export function decideParityVerdict(input: {
  oracleValue: number | null;
  sqlValue: number | null;
}): { verdict: ParityVerdict; summary: string } {
  if (input.oracleValue === null) {
    return { verdict: 'skipped', summary: 'No oracle scalar in latest snapshot' };
  }
  if (input.sqlValue === null) {
    return { verdict: 'error', summary: 'SQL returned no scalar value' };
  }
  if (scalarsWithinTolerance(input.oracleValue, input.sqlValue)) {
    return {
      verdict: 'pass',
      summary: `Match oracle=${input.oracleValue} sql=${input.sqlValue}`,
    };
  }
  return {
    verdict: 'fail',
    summary: `Mismatch oracle=${input.oracleValue} sql=${input.sqlValue}`,
  };
}
