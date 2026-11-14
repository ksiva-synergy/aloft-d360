/**
 * Data policy for what the Power BI recreation investigator may send to an LLM
 * (decision 2026-11-14: "metadata plus aggregates", never row-level data).
 *
 * Allowed: model metadata (DAX, table / column / measure names, Power Query lineage, relationships,
 * error text, compiler notes) and AGGREGATE values from probes and parity (counts, totals, min/max
 * dates, booleans). Withheld: any text value that comes from data (a probe or parity result that is
 * a string could be an individual record's attribute — a vessel name, a person). Sizes are capped.
 * Pure.
 */

export const LLM_DATA_POLICY = 'metadata+aggregates' as const;

const MAX_TEXT = 4000;
const WITHHELD = '[text value withheld by data policy]';

/** A data value as it may be shown to the LLM. */
export function policyValue(v: unknown): number | boolean | string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const t = v.trim();
    if (t !== '' && Number.isFinite(Number(t))) return Number(t); // numeric text (e.g. Spark decimals)
    if (/^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/.test(t)) return t; // a date / timestamp
    return WITHHELD;
  }
  return WITHHELD;
}

/** Metadata text (DAX, names, errors): kept, but bounded. */
export function policyText(s: unknown, max = MAX_TEXT): string | null {
  if (typeof s !== 'string') return null;
  return s.length > max ? `${s.slice(0, max)} …[truncated]` : s;
}

/**
 * Error messages may quote a data value (e.g. "The value 'ACME LTD' of the type STRING cannot be
 * cast"). Mask quoted literals unless they are numeric.
 */
export function policyErrorText(s: unknown, max = 1200): string | null {
  const t = policyText(s, max);
  if (!t) return t;
  return t.replace(/'([^']{1,80})'/g, (m, inner: string) => (Number.isFinite(Number(inner)) ? m : "'…'"));
}
