# Phase 1 — Verification Checklist

Run through all of these before calling Phase 1 done.

## Pre-flight (before writing any code)

- [ ] Confirm `src/lib/dashboards/connection.ts` exists and exports `loadDashboardForExecution` — it was moved from `docs/phase0/07` during Phase 0's DB unit. If it's missing, it was never moved; go back and do it.
- [ ] Read `src/lib/semantic/execute.ts` — confirm `executeSemanticQuery`'s actual signature, return type, and how it signals the governance gate (typed error? message match? error code?). The reference files assumed `(query, connectionId) → { rows, sql }` with a message-matchable error — verify.
- [ ] Read `src/lib/semantic/compiler.ts` — confirm `toAlias` is exported. If not, export it (it's a pure function, no side effects, safe to export).
- [ ] Read `src/components/inspector/dashboard-builder/WidgetPreview.tsx` — confirm `buildPreviewOption`'s actual signature and the exact shape of the ECharts option it currently produces. The mapper extension needs to fit into its real structure, not the memory doc's summary of it.
- [ ] Read `src/app/(agent)/inspector/dashboards/[id]/builder/page.tsx` — this is the pattern to mirror for the viewer route's server component (session loading, dashboard query, prop passing to client component).
- [ ] Check what `SemanticQuery` actually looks like in `src/lib/dashboards/types.ts` — does it have `.dimensions`/`.measures` as ID arrays? Does it have `.modelId`?

## DATA-1: Widget-data route

- [ ] Route exists at `src/app/api/inspector/dashboards/[id]/data/route.ts` and responds to GET
- [ ] Unauthenticated request → 401 (edge middleware + inline session check)
- [ ] Authenticated user with no access to this dashboard → 403
- [ ] Authenticated `viewer` / `org_member` → 200 with data (this is a read — any role may fetch)
- [ ] Authenticated `owner` / `editor` → 200 with data (regression check)
- [ ] Dashboard that doesn't exist → 404
- [ ] Soft-deleted dashboard → 404
- [ ] Dashboard with no saved version → 404 (or empty `{ widgets: {} }`)
- [ ] **Defensive pin**: confirm `query.modelId` is set to `dashboard.model_id` at execution time, not trusting `widget.semanticQuery.modelId`. Manually inspect the code — this is not testable from outside without crafting a widget with a mismatched modelId.
- [ ] **Governance gate**: dashboard on a candidate (non-governed) model returns per-widget `{ status: 'model_not_governed' }`, not a 500
- [ ] Per-widget execution error returns per-widget `{ status: 'error', message }`, not a whole-request 500 — one widget failing doesn't take down the other seven
- [ ] Successful response shape: `{ widgets: { [widgetId]: { status: 'ok', rows, sql, definitionsUsed, executedAt } } }`
- [ ] `sql` field is present and contains the compiled SQL (for the trust spine — even if the trust-spine UI ships in Phase 3, the data needs to be there now)

## DATA-3a: Rows→option mapper

- [ ] `buildPreviewOption` accepts an optional `rows` parameter
- [ ] When `rows` is undefined/empty, the existing placeholder behavior is **unchanged** (PREVIEW — NO DATA overlay, empty series)
- [ ] When `rows` has data, series are filled with real values and the PREVIEW overlay is removed
- [ ] **toAlias test**: a test exists that asserts `row[toAlias("Total Revenue")]` resolves to the expected value, and `row["Total Revenue"]` does NOT — catching the silent-failure case explicitly
- [ ] **buildPreviewOption test**: a test exists that asserts `option.series[0].data` is non-empty when rows are provided
- [ ] All chart kinds the builder supports are handled (bar, line, scatter, pie, KPI/big-number, table, etc.) — not just bar/line. Check `WidgetPreview` for the full list of chartKind values it handles today.
- [ ] `toAlias` is imported from `src/lib/semantic/compiler.ts`, NOT reimplemented or substituted with lodash.snakeCase / a different converter

## DATA-3b: Read-only viewer route

- [ ] Page exists at `src/app/(agent)/inspector/dashboards/[id]/page.tsx`
- [ ] Navigating to `/inspector/dashboards/{id}` renders the viewer (not the builder — builder is at `/inspector/dashboards/{id}/builder`)
- [ ] `canViewDashboard` gate: any authenticated user with any role can view; users with no access see 404 or redirect
- [ ] Widgets render with real data (not PREVIEW — NO DATA placeholders)
- [ ] Per-widget skeleton shown while data loads
- [ ] Per-widget error state shown for failed widgets (with error message and retry)
- [ ] Candidate-model banner shown if relevant
- [ ] "Last updated" timestamp visible (from `executedAt`)
- [ ] **No editing affordances visible**: no DefinitionPicker, no Add Widget, no Save button, no drift badges, no WidgetConfigPanel
- [ ] "Edit" link/button shown only if `canEditDashboard(role)` → links to `/builder`
- [ ] Grid is not draggable and not resizable

## Integration / smoke test

- [ ] Open an existing dashboard that has widgets → widgets render with real data from Databricks
- [ ] If the dashboard's model is governed and the connection is valid, all widgets show data
- [ ] Check the browser's Network tab: one fetch to `/api/inspector/dashboards/{id}/data`, not N per-widget fetches
- [ ] Open the builder for the same dashboard → confirm it still works as before (Phase 0 didn't break it; Phase 1 should enhance it or leave it alone)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes (or equivalent)
- [ ] No `server-only` errors at runtime (the widget-data route runs in Next.js server context, so this should be fine — but verify if any transitively-imported module triggers it)
