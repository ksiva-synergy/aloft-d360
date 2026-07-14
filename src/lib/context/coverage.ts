// ── Coverage / degrade instrumentation ────────────────────────────────────────
// Pure helpers for turning per-object profile stats into degrade counts. Kept free
// of prisma / server-only imports so they can be unit-verified in isolation
// (see scripts/context/verify/verify-coverage.ts). The DB-backed estate rollup lives
// in reads.ts (getCoverageSummary).

/** The set of per-column skip_reason values a T1 profile may emit. */
export const COLUMN_SKIP_REASONS = [
  'heavy_column_type',
  'wide_row_string',
  'wide_table_column_cap',
  'void_column',
  'view_query_failed',
] as const;

export interface T1DegradeCounts {
  /** Objects whose profile is degraded (partial sweep or an unqueryable view). */
  objects_degraded: number;
  /** Columns that were skipped (skip_reason set) rather than fully profiled. */
  columns_skipped: number;
}

/**
 * Count degraded objects and skipped columns from a list of per-object profile
 * stats blobs (ObjectProfile.stats), as produced by DatabricksAdapter.harvestProfile.
 *
 * An object is degraded when its stats carry `partial: true` or
 * `view_unqueryable: true`. A column is counted as skipped when its per-column
 * profile entry carries `skipped: true` (which always accompanies a skip_reason).
 */
export function countT1Degrade(
  statsList: Array<Record<string, unknown> | null | undefined>,
): T1DegradeCounts {
  let objects_degraded = 0;
  let columns_skipped = 0;

  for (const stats of statsList) {
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) continue;

    if (stats.partial === true || stats.view_unqueryable === true) {
      objects_degraded++;
    }

    const cols = stats.columns;
    if (cols && typeof cols === 'object' && !Array.isArray(cols)) {
      for (const col of Object.values(cols as Record<string, unknown>)) {
        if (col && typeof col === 'object' && (col as Record<string, unknown>).skipped === true) {
          columns_skipped++;
        }
      }
    }
  }

  return { objects_degraded, columns_skipped };
}
