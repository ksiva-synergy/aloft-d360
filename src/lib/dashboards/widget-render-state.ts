/**
 * src/lib/dashboards/widget-render-state.ts
 *
 * Guided Phase 4 (Stage 3 drill-in) — the TYPED render state of a widget's chart
 * area. This is the anti-false-green spine of the shell.
 *
 * The whole reason this type exists: in the prototype the chart area had no empty
 * branch, so — combined with the `toAlias` label→alias gotcha — a zero-row query,
 * a mapping bug, and "nothing has run yet" were all visually indistinguishable. A
 * placeholder that *looks* live is a false-green baked into the scaffold. So the
 * render state is a discriminated union, and "we have not wired data yet" is a
 * FIRST-CLASS variant (`awaiting_data`) that is visibly distinct from both a real
 * chart (`ok`) and a real empty result (`empty`).
 *
 * SEAM NOW FILLED (drill-in integration): the shell's UI half only ever
 * constructed `awaiting_data`; the data variants were declared as a typed seam.
 * `renderStateFromResult` below fills that seam — it maps a `WidgetDataResult`
 * (from the PER-WIDGET authoring-preview route
 * GET /api/inspector/dashboards/[dashboardId]/widgets/[widgetId]/data — NOT the
 * batch [dashboardId]/data viewer route, which is governed-only) into
 * `ok` / `empty` / `model_not_governed` / `error`, running the pure `toAlias`
 * rows→option mapper (rows-to-option.ts) rather than re-implementing it. The
 * empty vs. mapping-bug distinction is carried by `rowsToOption().isEmpty`, so a
 * real zero-row result becomes `empty` and never masquerades as a chart.
 */

import { rowsToOption } from './rows-to-option';
import type {
  RowsToOptionResult,
  DimensionMeta,
  MeasureMeta,
  ChartKind,
} from './rows-to-option';
import type { WidgetDataResult } from './types';

/**
 * How a widget's chart area should render.
 *
 *  - 'awaiting_data'       → NOT WIRED. No fetch has happened (the item is not
 *                            confirmed, so it has no widgetId to preview). The
 *                            shell's default. MUST look explicitly unfinished —
 *                            never a chart, never an empty result.
 *  - 'loading'             → a per-widget data fetch is in flight.
 *  - 'ok'                  → real rows to plot. Carries the mapped `chart`
 *                            (rows→option), the compiled `sql`, and `isDraft`
 *                            (owner-scoped preview of a not-yet-governed def).
 *  - 'empty'               → the query ran and returned ZERO rows — a real,
 *                            correct empty result, distinct from `awaiting_data`
 *                            and from a `toAlias` mapping bug.
 *  - 'model_not_governed'  → the bound model isn't governed; "publish to see live
 *                            data" (the non-owner / shared-consumption degrade).
 *  - 'error'               → execution failed with a message (inspectable, never
 *                            a silent blank). `sql?` surfaced when available.
 */
export type WidgetRenderState =
  | { kind: 'awaiting_data' }
  | { kind: 'loading' }
  | { kind: 'ok'; chart: RowsToOptionResult; sql: string; isDraft: boolean }
  | { kind: 'empty'; sql?: string }
  | { kind: 'model_not_governed'; message: string; sql?: string }
  | { kind: 'error'; message: string; sql?: string };

/**
 * The chart shape the mapper needs to key rows correctly: the chosen chartKind
 * plus the resolved dimension/measure metadata (label drives `toAlias`, the
 * actual result-row key). Sourced from the blueprint item + drill-in draft — NOT
 * re-resolved here.
 */
export interface WidgetChartShape {
  chartKind: ChartKind;
  dimensions: DimensionMeta[];
  measures: MeasureMeta[];
}

/**
 * The shell's default render state: not yet wired to data. Factored into a named
 * constructor so the intent reads at the call-site and the not-wired branch is a
 * deliberate value, not an implicit `undefined`/falsy fall-through.
 */
export function awaitingData(): WidgetRenderState {
  return { kind: 'awaiting_data' };
}

/** True while the widget cannot show live data (the item isn't confirmed). */
export function isAwaitingData(state: WidgetRenderState): boolean {
  return state.kind === 'awaiting_data';
}

/**
 * Map a per-widget `WidgetDataResult` into a render state. This is the drill-in's
 * consumer of the pure `rowsToOption` mapper (rows-to-option.ts) — it does not
 * re-implement the `toAlias` lookup.
 *
 *  - `ok`   → run rowsToOption; if it comes back `isEmpty` (a genuine zero-row
 *             result) return `empty`, else `ok` with the mapped chart. `isDraft`
 *             rides through so the owner-scoped "Draft — not governed" affordance
 *             can render beside the chart.
 *  - `model_not_governed` / `error` → passed through as their typed states,
 *             carrying `sql?` for the trust panel when the layer produced it.
 */
export function renderStateFromResult(
  result: WidgetDataResult,
  shape: WidgetChartShape,
): WidgetRenderState {
  if (result.status === 'model_not_governed') {
    return { kind: 'model_not_governed', message: result.message, sql: result.sql };
  }
  if (result.status === 'error') {
    return { kind: 'error', message: result.message, sql: result.sql };
  }

  // status === 'ok' — run the pure mapper; `isEmpty` is the empty/false-green
  // discriminant the whole render-state union exists to protect.
  const chart = rowsToOption({
    chartKind: shape.chartKind,
    dimensions: shape.dimensions,
    measures: shape.measures,
    rows: result.rows,
  });

  if (chart.isEmpty) {
    return { kind: 'empty', sql: result.sql };
  }
  return { kind: 'ok', chart, sql: result.sql, isDraft: result.isDraft === true };
}
