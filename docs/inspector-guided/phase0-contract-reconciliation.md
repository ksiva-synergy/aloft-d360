# Phase 0 — Contract Reconciliation (prototype UI ↔ backend types)

> Frozen before the guided build starts. Reconciles the standalone prototype
> (`Inspector Guided Builder (standalone).html`) against the real backend
> contracts, so a UI field or state that the API can't emit is caught now —
> while a type change is cheap — not when it's wired.
>
> Scope note: Phase 0 is backend-only and has no UI. This doc is the one
> Phase-0 artifact that touches the prototype: a type-contract audit, not a
> build step. The prototype becomes a live visual target starting at Guided
> Phase 1.

## Phase 0 backend status (verified against the branch, not the task text)

The task described SEC-1/2/3 + DEC-1 as unbuilt. On this branch they are **already
shipped**:

- **SEC-1** — `versions` POST and `restore` POST gate on
  `getServerSession → getUserByEmail → 401 → getDashboardRole → canEditDashboard ? : 403`.
- **SEC-2** — save/restore/delete audit actors derive from the session
  (`actor.email`). No `body.actor` / `body.createdBy` exists under `dashboards/`.
- **SEC-3** — DELETE uses early-return `if (!currentUser) return 401` (bug already inverted).
- **DEC-1** — connection binding shipped on **`platform_dashboards`** (per-dashboard,
  `NOT NULL`, backfilled), wired via `src/lib/dashboards/connection.ts`
  (`loadDashboardForExecution`). **Decision: keep per-dashboard.** No
  `platform_semantic_models.connection_id`, no migration.

Path segment is `[dashboardId]`, not `[id]`.

**SEC-4 (read-side authz) — FIXED.** During this reconciliation we found the
`versions` GET, `[dashboardId]` GET, and `collaborators` GET read endpoints had no
401/403 gate — authenticated-but-unauthorized read of dashboard structure, version
history, and the collaborator list. Now gated with the same pattern as the write
routes, using the read-side predicate: `getServerSession → getUserByEmail →
401-on-no-user → getDashboardRole → canViewDashboard ? proceed : 403`. Not filed as a
public issue (the repo is public; disclosing an unpatched authz hole is worse than
the undocumented state) — fixed directly instead. Runtime 401/403/200-by-role
verification pending live creds, same gate as the rest of Phase 5.

## Decisions locked

1. **DEC-1 = per-dashboard connection binding** (kept as shipped).
2. **Authoring-preview state = committed now, type-only.** The guided drill-in will
   render an owner's own candidate/draft model **live** (badged "Draft — not
   governed"), reusing the shipped owner-scoped bypass in `executeSemanticQuery`
   (`opts?: AuthoringOpts` → `isDraft`, owner-only via `SemanticDraftAccessError`).
   Route wiring (passing owner-scoped `AuthoringOpts`) is deferred to the guided
   drill-in phase; only the **type** is locked in Phase 0.

## Change applied in Phase 0

- `src/lib/dashboards/types.ts` — added optional `isDraft?: boolean` to the
  `WidgetDataResult` `ok` variant. An authoring preview is an `ok` result (live
  rows) that is additionally draft/not-governed; a flag lets the client reuse the
  ok-render path and add a persistent badge. Mirrors `SemanticQueryResult.isDraft`.
  Non-breaking (optional). Not yet populated by the data route — that call passes no
  `AuthoringOpts` today, so `isDraft` is always absent/false on the governed path.

## The failure this guards against

The prototype's drill-in renders a live chart for a **candidate** model. The
widget-data route today runs the default governed-only path → candidate model →
`SemanticModelNotGovernedError` → `status: 'model_not_governed'` with **zero rows**.
Build the drill-in against the prototype's mock and it looks finished; point it at
the real CAND-only estate and every chart is blocked/empty — the exact
"green-on-mock, breaks-live" signature. The `isDraft` state + owner-scoped wiring is
what closes it. **Each guided stage counts as "done" only when wired to live,
governed, correctly-scoped data behind it — never on mock data.**

## Pin-list — apply when `ChartBlueprint` / `ResolvedIntent` are authored (Phase 2/3)

These types exist only in `guided-dashboard-flow-build-plan.md` Appendix A/B today.
When authored in code, pin them to the prototype:

- **`ChartBlueprint.grounding`** → `'governed' | 'undefined'` per item (the prototype's
  `defined` boolean). Candidate-ness is a **model-level** state (prototype shows it as
  a whole-model banner, not per row) — carry it on the resolved intent /
  `modelStatus`, not per blueprint item.
- **Carry resolved display labels** next to IDs. The card renders `metric`
  ("Accident count") and `breakdown` ("by Root cause category"); the type has only
  `measureIds[]` / `dimensionIds[]`. Add resolved labels or the card needs a second
  lookup.
- **Undefined-metric Teach nudge** needs the requested term — add
  `undefinedTerm?: string` to prefill the `DEFINE IT IN TEACH →` deep link.
- **`ResolvedIntent.disambiguations.candidates`** → `{ id; label; description }[]`
  (not `string[]`). The resolver popover renders label + meta per candidate and a
  "no matching governed field" case.

## Recommended follow-ups (not applied in Phase 0)

Tracked in **[#2](https://github.com/ksiva-synergy/aloft-d360/issues/2)** (guided
drill-in route wiring — includes the owner-scoped authoring-preview wiring + its red
enforcement test, the `toAlias` tests, the derived empty state, `sql?` on non-`ok`
variants, and the measure `unit`/format home) and
**[#3](https://github.com/ksiva-synergy/aloft-d360/issues/3)** (bind-time
same-model ⇒ same-connection guard, gated on the 1:1-vs-many open question).


- **Compiled SQL on non-`ok` states.** The prototype's trust panel shows the compiled
  SQL even in the blocked/error state; `model_not_governed` / `error` carry only
  `message`. Surfacing `sql?` there needs the route to capture the compiled SQL
  before `executeSemanticQuery` throws (route wiring) — defer with the drill-in.
- **Explicit empty state.** Empty is `status: 'ok'` + `rows: []` (the backend won't
  tag it). The prototype has no empty branch. Combined with the `toAlias` label→alias
  gotcha, a zero-row query renders as a valid-but-empty chart — a false green. The
  viewer must derive empty from `rows.length === 0`; write the `toAlias` test before
  shipping the drill-in.
- **Measure `unit`/format + metric→color.** The prototype's `unit: '%'` and
  "COLOR — LOCKED TO METRIC" have no home in `WidgetSpec.chartConfig`
  (`x/y/series/value/echartsOption` only). These are measure metadata — decide the
  source (semantic measure definition vs. baked into `echartsOption`).
