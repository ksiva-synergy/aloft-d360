# Handoff: Phase 1 (Live Data Render Path) — Inspector Dashboards

## What this is

Phase 1 turns `PREVIEW — NO DATA` placeholder widgets into live, data-backed
charts. Three deliverables + one defensive rule, all building on top of the
Phase 0 work that is already shipped and verified.

**Read first, in this order:**
1. `inspector-dashboard-builder-memory.md` — §4 (execution engine), §4.5
   (toAlias gotcha), §4.6 (scope of the data track), §7 (file map), §8
   (invariants)
2. `Inspector_Dashboards___Technical_Implementation_Plan.md` — §2 (Phase 1)
3. Everything in this `phase1/` folder

## Decisions already made (do not re-litigate)

- **DEC-1: per-dashboard connection binding.** `connection_id` is on
  `platform_dashboards`, already migrated, backfilled, NOT NULL.
  `src/lib/dashboards/connection.ts` exists and exports
  `resolveDashboardConnectionId` and `loadDashboardForExecution`.
- **Provenance** — `source_chart_id?` is on `WidgetSpec`. Unused in Phase 1.
- **Freshness** — `freshness?` is on `WidgetSpec`. Default to always-re-run
  (mode=live) in Phase 1; cache/scheduled modes are Phase 2 work.

## Codebase conventions discovered in Phase 0 (ALREADY VERIFIED — use these, don't re-derive)

These overrode the original reference files' guesses. Do not guess differently:

| Thing | Actual convention |
|---|---|
| Prisma client | `import prisma from '@/lib/db'` — **default export** |
| Auth session | next-auth v4: `getServerSession(authOptions)` from `next-auth` / `@/lib/auth` |
| `getDashboardRole` | **Three args**: `getDashboardRole(dashboardId, userId, visibility)` — the dashboard's visibility field is the 3rd arg |
| Null role → | **403**, not 404. Dashboard is already confirmed in-org, so existence isn't secret. Match `share/route.ts`. |
| Org scoping | `getDefaultOrg()` throughout — org is never derived from the request |
| Audit rows | Table: `{ id, org_id, dashboard_id, action, version_id?, actor }`. `actor` is an email string. **No `actor_user_id` column.** |
| Connections table | `platform_databricks_connections` (not `platform_db_connections` — that doesn't exist) |
| Connection resolution | `tool_catalog` → slug `synergy_dwh` → `config.connection_id` → points to `platform_databricks_connections.id`. For dashboards, this is now bypassed by the direct `platform_dashboards.connection_id` binding. |
| Auth pattern | **Inline** per route, matching `share/route.ts` and `collaborators/route.ts`. No shared `audit.ts` / `resolveAuditActor()` helper exists — that was a Phase 0 reference-file invention that was correctly rejected. |
| `server-only` guard | `src/lib/context/dispatch.ts` imports `server-only`. Anything that transitively touches `dispatch.ts` will throw when run outside Next.js server runtime (e.g. via bare `npx tsx`). Relevant if writing test scripts. |

## Phase 0 state (what's already in the repo)

- SEC-1/2/3: shipped, verified.
- `platform_dashboards.connection_id`: `String NOT NULL`, all rows backfilled.
- `src/lib/dashboards/connection.ts`: exports `resolveDashboardConnectionId(dashboardId)` and `loadDashboardForExecution(dashboardId)`. Read these before writing the widget-data route — they already handle the dashboard lookup + connection resolution + soft-delete check.
- `WidgetSpec` in `src/lib/dashboards/types.ts`: now has `source_chart_id?` and `freshness?`.

## Deliverables

### DATA-1: Widget-data API route

**New file:** `src/app/api/inspector/dashboards/[id]/data/route.ts`

See `01-widget-data-route.ts` in this folder for the reference implementation.

Design choice: **batch route** (all widgets in one request), not per-widget.
Rationale: a dashboard with 8 widgets shouldn't fire 8 parallel requests
each doing their own auth + dashboard-load + version-lookup. One route loads
the dashboard once, iterates widgets, executes each query, and returns a map
of `{ [widgetId]: result }`. Individual widget failures are per-widget error
objects, not a whole-request 500.

Contract:
```
GET /api/inspector/dashboards/{id}/data
  auth:  middleware token + canViewDashboard (any role — this is a read)
  
  1. getServerSession → getUserByEmail → getDashboardRole(id, userId, visibility)
     → canViewDashboard(role) ? proceed : 403
  2. loadDashboardForExecution(dashboardId) → { modelId, connectionId, currentVersionId }
  3. load version → version.widgets[]
  4. for each widget:
     a. clone widget.semanticQuery
     b. DEFENSIVE PIN: query.modelId = dashboard.model_id  (memory §4.6)
     c. try: executeSemanticQuery(query, connectionId)
     d. catch governance gate → { status: 'model_not_governed' }
     e. catch other → { status: 'error', message }
     f. success → { status: 'ok', rows, sql, definitionsUsed, executedAt }
  5. return { widgets: { [widgetId]: result } }
```

**Critical: the defensive pin (step 4b).** `validateWidgetReferences` guards
entity ownership at save but does NOT assert
`semanticQuery.modelId === dashboard.model_id`. Pin it at execution time so a
stale/mismatched stored modelId can never point a widget at a foreign model.

**Governance gate is a UX state, not a 500.** `executeSemanticQuery` throws
unless the model is `governed`. Catch it and return a typed per-widget status
(`model_not_governed`), never an unhandled exception.

### DATA-3a: Rows→option mapper

**Modified file:** `src/components/inspector/dashboard-builder/WidgetPreview.tsx`

See `02-mapper-guidance.ts` in this folder for the exact pattern.

Extend `buildPreviewOption` to accept an optional `rows` array parameter.
When rows are present, fill the data arrays that currently emit
`series: [{ data: [] }]` with real values.

**THE GOTCHA THAT SILENTLY BREAKS (memory §4.5):** The compiler keys result
columns by `toAlias(label)` (snake_case: `"Total Revenue"` →
`total_revenue`), but `WidgetPreview` resolves axis names from definition
labels. The mapper MUST use `toAlias` from `src/lib/semantic/compiler.ts` to
look up the right column in each row:

```ts
const col = toAlias(measureDef.label);   // "Total Revenue" → "total_revenue"
const val = row[col];                    // NOT row[measureDef.label]
```

Miss this and you get correct axes with empty series — visually
indistinguishable from the current `PREVIEW — NO DATA` placeholder. Write a
test that asserts a known measure's column resolves via `toAlias` before
shipping this.

**Do not reuse the DSL-driven pipeline mapper** from `chart-pipeline.ts` —
widgets store `chartConfig`, not a full DSL. The widget path and the chat
path diverge here by design.

### DATA-3b: Read-only viewer route

**New file:** `src/app/(agent)/inspector/dashboards/[id]/page.tsx`

See `03-viewer-route.tsx` in this folder for the reference implementation.

This is the consumption surface — the counterpart to `/builder` (edit).
- Access: `canViewDashboard` (any role, including `org_member`).
- Renders the same widget grid with real data fetched from the DATA-1 route.
- NO picker, NO Add/Save, NO drift badges — those belong on `/builder` only.
- Interactions: filter, drill-down, hover/tooltip (consumption-only).
- Loading: per-widget skeleton while data loads.
- Error: per-widget error state showing the failure + retry button, never a
  silent empty chart that looks the same as "no data".

This makes the edit-vs-view split explicit — the universal pattern across
Power BI, Tableau, Looker.

### Client-side data fetching hook

**New file:** `src/hooks/useDashboardData.ts`

See `04-use-dashboard-data.ts` in this folder.

A React hook that fetches `GET /api/inspector/dashboards/{id}/data`, manages
loading/error/success states per widget, and integrates with the Zustand
builder store's `dataCache` slice. Both `/builder` (for preview with real
data) and the viewer route consume this hook.

## Verification checklist

See `05-checklist.md`.

## Explicitly out of scope

- Freshness policy (cache/scheduled modes) — Phase 2.
- Cross-filtering / drill-down wiring — Phase 4.
- Streaming/SSE batch execution — future optimization if per-widget
  skeletons aren't fast enough.
- Touching `chat/route.ts` or the Inspector chat's connection resolution.
- Any changes to `executeSemanticQuery` or `compileSemanticQuery` — these
  are the reusable engine; we are adding a new *caller*, not modifying them.
