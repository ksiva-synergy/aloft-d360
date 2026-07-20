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
 * SCOPE (this phase, the UI half): the shell only ever constructs `awaiting_data`.
 * The other variants are declared so the state space is honest and the data half
 * (issue #2) has a typed seam to fill — it will map a `WidgetDataResult` from
 * GET /api/inspector/dashboards/[dashboardId]/data into `ok` / `empty` /
 * `model_not_governed` / `error` (with the `toAlias` rows→option mapping). That
 * mapper is deliberately NOT built here — building it now, with no execution, is
 * exactly the premature "looks done" step this phase refuses.
 */

/**
 * How a widget's chart area should render.
 *
 *  - 'awaiting_data'       → NOT WIRED. No fetch has happened (and cannot, this
 *                            phase). The shell's default. MUST look explicitly
 *                            unfinished — never a chart, never an empty result.
 *  - 'loading'             → a data fetch is in flight (data half).
 *  - 'ok'                  → real rows to plot (data half).
 *  - 'empty'               → the query ran and returned ZERO rows — a real,
 *                            correct empty result, distinct from `awaiting_data`
 *                            and from a `toAlias` mapping bug (data half).
 *  - 'model_not_governed'  → the bound model isn't governed; "publish to see live
 *                            data" (data half — mirrors WidgetDataResult).
 *  - 'error'               → execution failed with a message (data half).
 */
export type WidgetRenderState =
  | { kind: 'awaiting_data' }
  | { kind: 'loading' }
  | { kind: 'ok' }
  | { kind: 'empty' }
  | { kind: 'model_not_governed'; message: string }
  | { kind: 'error'; message: string };

/**
 * The shell's default render state: not yet wired to data. Factored into a named
 * constructor so the intent reads at the call-site and the not-wired branch is a
 * deliberate value, not an implicit `undefined`/falsy fall-through.
 */
export function awaitingData(): WidgetRenderState {
  return { kind: 'awaiting_data' };
}

/** True while the widget cannot show live data (this phase: always). */
export function isAwaitingData(state: WidgetRenderState): boolean {
  return state.kind === 'awaiting_data';
}
