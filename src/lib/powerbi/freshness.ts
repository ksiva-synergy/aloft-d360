/**
 * Data freshness in parity (Power BI answers from its last refresh; the warehouse moves on).
 *
 * A measure that differs from Power BI is **stale**, not failed, when a table it reads has
 * measurably changed since the dataset's refresh: its row count differs between the dataset and
 * the warehouse (both after Power Query filters), or a date column holds newer values in the
 * warehouse. Stale measures are re-checked after the next refresh; if they still differ after
 * `STALE_MAX_REFRESHES` further refreshes, the drift is not freshness (e.g. a lineage difference)
 * and the measure fails. Without drift evidence a mismatch is a real failure. Pure.
 */

export type TableDrift = {
  table: string;
  power_bi_rows: number | null;
  warehouse_rows: number | null;
  /** Date columns whose newest value is later in the warehouse than in the dataset. */
  newer_dates: { column: string; power_bi: string | null; warehouse: string | null }[];
  drifted: boolean;
};

export type StaleState = {
  /** First time the measure was found stale. */
  since: string;
  /** Dataset refresh times seen while stale (the first one included). */
  refreshes: string[];
  evidence: TableDrift[];
};

/** Re-checks after this many newer refreshes that still show a difference → real failure. */
export const STALE_MAX_REFRESHES = 2;

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Compare dataset vs warehouse aggregates of one table. */
export function tableDrift(input: {
  table: string;
  powerBi: { rows: unknown; maxDates: Record<string, unknown> };
  warehouse: { rows: unknown; maxDates: Record<string, unknown> };
}): TableDrift {
  const pr = num(input.powerBi.rows);
  const wr = num(input.warehouse.rows);
  const newer: TableDrift['newer_dates'] = [];
  for (const [column, wv] of Object.entries(input.warehouse.maxDates)) {
    const pv = input.powerBi.maxDates[column];
    const w = wv == null ? NaN : Date.parse(String(wv));
    const p = pv == null ? NaN : Date.parse(String(pv));
    if (Number.isFinite(w) && (!Number.isFinite(p) || w > p + 1000)) {
      newer.push({ column, power_bi: pv == null ? null : String(pv), warehouse: String(wv) });
    }
  }
  const rowsDiffer = pr !== null && wr !== null && Number.isFinite(pr) && Number.isFinite(wr) && pr !== wr;
  return { table: input.table, power_bi_rows: pr, warehouse_rows: wr, newer_dates: newer, drifted: rowsDiffer || newer.length > 0 };
}

export function describeDrift(evidence: TableDrift[]): string {
  return evidence
    .filter((d) => d.drifted)
    .map((d) => {
      const parts: string[] = [];
      if (d.power_bi_rows !== null && d.warehouse_rows !== null && d.power_bi_rows !== d.warehouse_rows) {
        const diff = d.warehouse_rows - d.power_bi_rows;
        parts.push(`${diff > 0 ? '+' : ''}${diff.toLocaleString('en-US')} rows in the warehouse (${d.power_bi_rows.toLocaleString('en-US')} → ${d.warehouse_rows.toLocaleString('en-US')})`);
      }
      for (const n of d.newer_dates.slice(0, 2)) parts.push(`newer ${n.column} (${n.warehouse?.slice(0, 10)} vs ${n.power_bi?.slice(0, 10) ?? 'none'})`);
      return `${d.table}: ${parts.join(', ')}`;
    })
    .join('; ');
}

/**
 * Verdict for a measure that did not match. `drift` = evidence for the tables the measure reads;
 * `prior` = stale state from the previous check; `refreshAt` = dataset refresh of this check.
 */
export function decideFreshness(input: {
  drift: TableDrift[];
  prior: StaleState | null;
  refreshAt: string | null;
  now: string;
}): { verdict: 'stale'; stale: StaleState; summary: string } | { verdict: 'fail'; summary: string | null } {
  const drifted = input.drift.filter((d) => d.drifted);
  if (!drifted.length) {
    return { verdict: 'fail', summary: null };
  }
  const refreshes = [...new Set([...(input.prior?.refreshes ?? []), ...(input.refreshAt ? [input.refreshAt] : [])])];
  const newerRefreshes = Math.max(0, refreshes.length - 1);
  if (input.prior && newerRefreshes >= STALE_MAX_REFRESHES) {
    return {
      verdict: 'fail',
      summary: `Still differs after ${newerRefreshes} dataset refreshes — not a freshness gap (tables keep differing: ${describeDrift(drifted)})`,
    };
  }
  return {
    verdict: 'stale',
    stale: { since: input.prior?.since ?? input.now, refreshes, evidence: drifted },
    summary: `Power BI dataset is older than the warehouse — ${describeDrift(drifted)}. Re-checked after the next refresh.`,
  };
}
