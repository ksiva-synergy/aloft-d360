// drift-summary.ts — pure helpers for reading a stored profile drift record.
//
// computeDrift (profile.ts) returns a DriftResult for EVERY profile after v1,
// even when nothing changed (all arrays empty). Callers that treat "drift is
// non-null" as "drift happened" therefore count every re-profile as a drift
// event. These helpers decide whether a record holds a real change.
//
// Client-safe: no prisma / server imports, so the Estate UI can use it.

export interface DriftLike {
  row_delta_pct?: number | null;
  new_columns?: string[];
  dropped_columns?: string[];
  type_changes?: Array<{ column: string; from: string; to: string }>;
  null_rate_shifts?: Array<{ column: string; from: number; to: number; delta?: number }>;
  top_k_changes?: Array<{ column: string; prev_top_values?: unknown[]; curr_top_values?: unknown[] }>;
}

/** Row-count change that counts as drift (same 10-point bar as null-rate shifts). */
export const ROW_DELTA_DRIFT_THRESHOLD = 0.1;

function arr<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : [];
}

function asDrift(drift: unknown): DriftLike | null {
  return drift && typeof drift === 'object' ? (drift as DriftLike) : null;
}

/**
 * Schema or data change that should lower trust: new / dropped columns, type
 * changes, null-rate shifts over 10 points, or a row-count move of 10%+.
 *
 * Top-value changes are excluded: large tables are profiled from an unordered
 * LIMIT window, so the top values move between runs without the data changing.
 */
export function isSignificantDrift(drift: unknown): boolean {
  const d = asDrift(drift);
  if (!d) return false;
  if (arr(d.new_columns).length > 0) return true;
  if (arr(d.dropped_columns).length > 0) return true;
  if (arr(d.type_changes).length > 0) return true;
  if (arr(d.null_rate_shifts).length > 0) return true;
  const rowDelta = typeof d.row_delta_pct === 'number' ? d.row_delta_pct : null;
  return rowDelta !== null && Math.abs(rowDelta) >= ROW_DELTA_DRIFT_THRESHOLD;
}

export interface DriftLine {
  kind: 'added' | 'dropped' | 'type' | 'nulls' | 'rows' | 'top_values';
  /** Whether this line counts toward the Trusted score penalty. */
  significant: boolean;
  text: string;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function list(names: string[], max = 4): string {
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} +${names.length - max} more` : shown;
}

/** Human-readable lines for one drift record, most important first. */
export function describeDrift(drift: unknown): DriftLine[] {
  const d = asDrift(drift);
  if (!d) return [];
  const lines: DriftLine[] = [];

  const added = arr(d.new_columns);
  if (added.length > 0) {
    lines.push({ kind: 'added', significant: true, text: `new_columns (${added.length}): ${list(added)}` });
  }
  const dropped = arr(d.dropped_columns);
  if (dropped.length > 0) {
    lines.push({ kind: 'dropped', significant: true, text: `dropped_columns (${dropped.length}): ${list(dropped)}` });
  }
  for (const t of arr(d.type_changes)) {
    lines.push({ kind: 'type', significant: true, text: `${t.column} data_type: ${t.from} → ${t.to}` });
  }
  for (const s of arr(d.null_rate_shifts)) {
    lines.push({ kind: 'nulls', significant: true, text: `${s.column} null_rate: ${pct(s.from)} → ${pct(s.to)}` });
  }
  const rowDelta = typeof d.row_delta_pct === 'number' ? d.row_delta_pct : null;
  if (rowDelta !== null && rowDelta !== 0) {
    const sign = rowDelta > 0 ? '+' : '−';
    lines.push({
      kind: 'rows',
      significant: Math.abs(rowDelta) >= ROW_DELTA_DRIFT_THRESHOLD,
      text: `row_count ${sign}${pct(Math.abs(rowDelta))}`,
    });
  }
  const topK = arr(d.top_k_changes);
  if (topK.length > 0) {
    lines.push({
      kind: 'top_values',
      significant: false,
      text: `top_k changed (${topK.length}): ${list(topK.map((c) => c.column))}`,
    });
  }
  return lines;
}
