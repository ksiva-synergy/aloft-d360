/** Compare Power BI oracle scalars vs Databricks SQL (v1 pilot). */

const DEFAULT_REL_TOL = 0.01;
const DEFAULT_ABS_TOL = 0.05;

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const trimmed = value.trim();
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
    const formattedDays = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*days?$/i);
    if (formattedDays) {
      const d = Number(formattedDays[1]);
      if (Number.isFinite(d)) return d;
    }
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

// ---------------------------------------------------------------------------
// Typed parity: numbers (tolerance), decorated numbers ("~ 477.02", "🚢1264"),
// dates (exact to the second), text (exact) and BLANK (both blank = match).
// ---------------------------------------------------------------------------

export type ParityRaw = { present: boolean; raw: unknown };

function firstValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (k in record) return record[k];
  const vals = Object.values(record);
  return vals.length ? vals[0] : undefined;
}

export function extractOracleValue(preview: unknown): ParityRaw {
  if (!Array.isArray(preview) || preview.length === 0) return { present: false, raw: null };
  const row = preview[0];
  if (!row || typeof row !== 'object') return { present: false, raw: null };
  return { present: true, raw: firstValue(row as Record<string, unknown>, ['Value', 'value', '[Value]']) ?? null };
}

export function extractSqlValue(rows: Record<string, unknown>[]): ParityRaw {
  if (rows.length === 0) return { present: false, raw: null };
  return { present: true, raw: firstValue(rows[0]!, ['value', 'Value', '__value']) ?? null };
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

const DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function normalizeDate(v: unknown): string | null {
  const s = v instanceof Date ? v.toISOString() : typeof v === 'string' ? v.trim() : null;
  const m = s?.match(DATE_RE);
  if (!m) return null;
  return `${m[1]}T${m[2] ?? '00:00'}:${m[3] ?? '00'}`;
}

/** A single number wrapped in presentation text: "~ 477.02", "🚢1264", "12.3 days". */
function decoratedNumber(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^[^\d-]*?(-?\d[\d,]*(?:\.\d+)?)[^\d]*$/);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function decideTypedParity(input: {
  oracle: ParityRaw;
  sql: ParityRaw;
}): { verdict: ParityVerdict; summary: string; oracleValue: unknown; sqlValue: unknown } {
  const o = input.oracle.raw;
  const s = input.sql.raw;
  const out = (verdict: ParityVerdict, summary: string) => ({ verdict, summary, oracleValue: o, sqlValue: s });
  if (!input.oracle.present) return out('skipped', 'No oracle result in latest snapshot');
  if (!input.sql.present) return out('error', 'SQL returned no rows');
  if (isBlank(o) && isBlank(s)) return out('pass', 'Match: both BLANK');
  if (isBlank(o) || isBlank(s)) {
    return out('fail', `Mismatch oracle=${isBlank(o) ? 'BLANK' : String(o)} sql=${isBlank(s) ? 'BLANK' : String(s)}`);
  }
  const on = toFiniteNumber(o);
  const sn = toFiniteNumber(s);
  if (on !== null && sn !== null) {
    return scalarsWithinTolerance(on, sn)
      ? out('pass', `Match oracle=${on} sql=${sn}`)
      : out('fail', `Mismatch oracle=${on} sql=${sn}`);
  }
  const od = normalizeDate(o);
  const sd = normalizeDate(s);
  if (od && sd) {
    return od === sd ? out('pass', `Match date ${od}`) : out('fail', `Mismatch date oracle=${od} sql=${sd}`);
  }
  if (sn !== null) {
    const odn = decoratedNumber(o);
    if (odn !== null) {
      return scalarsWithinTolerance(odn, sn)
        ? out('pass', `Match oracle="${String(o)}" (${odn}) sql=${sn}`)
        : out('fail', `Mismatch oracle="${String(o)}" (${odn}) sql=${sn}`);
    }
  }
  const ot = String(o).trim();
  const st = String(s).trim();
  return ot === st ? out('pass', `Match text "${ot}"`) : out('fail', `Mismatch text oracle="${ot}" sql="${st}"`);
}
