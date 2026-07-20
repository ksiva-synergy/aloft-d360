# Guided Builder — Phase 5 (Stage 4: assemble + save) — pins & decisions

Closes the guided loop: confirmed widgets land in the grid; **Save writes a new
immutable version through the existing versions POST** — no parallel path.

## Task-1 delta (the real save path, confirmed)

`POST /api/inspector/dashboards/[dashboardId]/versions` is reused verbatim:

- **`canEditDashboard` gate (SEC-1)** + **actor from session (SEC-2)** — the
  `save_version` audit row's `actor` and the version's `created_by` are the
  session user, never the body.
- **Server-side snapshot re-freeze** — `computeMeasureSnapshots` recomputes
  `aggregate/expression/metric_type` from live definitions and overwrites each
  semantic widget's `measureSnapshots`. Client-supplied snapshots are never
  trusted (guided ships `measureSnapshots: []`; the server fills them).
- `version_number = max+1`, repoints `current_version_id`, `UNIQUE(dashboard_id,
  version_number)` turns a concurrent race into a loud 409.
- **Model binding is a no-op at save.** The route never rebinds `model_id` /
  `connection_id`; it only runs `resolveModelConnection(model_id, connection_id)`
  as the issue-#3 defense-in-depth guard. Guided dashboards operate on an
  existing `dashboardId` bound **at create**, so binding is already consistent by
  save time; any out-of-band divergence still surfaces through the #3 guard (409).

Guided reuses this path by dropping into manual on `DrillInStage.onDone`
(`setMode('manual')`): confirmed widgets are already in the **one shared
`widgets` store** (via `appendWidgetSpec` at drill-in confirm, auto-laid-out by
`findOpenPosition`), manual can rearrange them, and the existing `handleSave`
POSTs the identical `{ widgets, layout, changeSummary }` payload. No parallel
tree, no parallel save.

## The one gap Phase 5 had to close: deferred `entityId`

`compileSemanticQuery` **requires** a non-empty `entityId` (it is the FROM
anchor; it throws otherwise). Manual widgets get `entityId` from the picker; the
guided drill-in has no client catalog, so it seeds `entityId: ''` and **defers to
the server** (the promise written into `DrillInStage`/`blueprint-widget.ts`). That
promise was previously unimplemented — the save route never resolved it.

`resolveDeferredEntityIds(widgets, orgId)` (governance.ts) is the resolution:
binds each deferred widget's primary entity from the entity owning its first
measure (else first dimension). Wired into the versions POST **before** validation
and snapshotting, so a **guided-authored widget is stored indistinguishable from a
manually authored one** (Task 2's "indistinguishable at rest"). No-op for manual
widgets (entityId already set) and raw-SQL. Status-agnostic: it only resolves
ownership; draft/cross-model policy stays with `validateWidgetReferences` (save)
and the per-definition owner boundary (preview).

## Preview-during-authoring: decision (b) — ephemeral-spec preview

**Chosen (b), per the task default.** The version-backed per-widget route resolves
a widget from a *saved* version, so a confirmed-but-unsaved guided widget 404s →
error where a preview belongs. Added an **ephemeral mode** to the same per-widget
route: `POST .../widgets/[widgetId]/data` with `{ widget }` executes the
in-progress spec and returns rows, **persisting nothing** (no version, no audit,
no dashboard mutation). Snapshots are still server-frozen only at real save.

(a) autosave-on-confirm was **rejected** (poisons immutable version history) and is
not built. (c) save-to-preview gating was not needed.

It opens no new hole — the guards don't depend on the spec being persisted:

- **Authoring-only, tighter than the GET route**: `buildEphemeralWidgetPreview`
  requires `canEditDashboard` (a pure viewer → 403 before any execution).
- **Model server-pinned** to `dashboard.model_id`; **entityId server-resolved** —
  neither trusted from the body.
- **Identity from session (SEC-2)** → the per-definition owner boundary still
  fires: a referenced draft the caller doesn't own → `SemanticDraftAccessError` →
  generic 403 leaking nothing (shared `mapExecutionError` with the GET path).
- **Read-only chokepoint** preserved (executeSemanticQuery → executeDatabricksSQL).
  **Raw-SQL is refused (400)** — the guided flow only makes semantic widgets, and a
  client-supplied `rawSql`+`connectionId` would be an unvalidated foreign-connection
  surface this preview deliberately does not accept.

Built as its own isolated unit with its own owner-boundary test
(`widget-preview.ephemeral.test.ts`): non-owner → 403, another user's draft →
403 with no draft data anywhere in the serialized payload, and **nothing
persisted** (version/audit `create` asserted never called).

The drill-in previews the confirmed store spec via `useWidgetPreview`'s ephemeral
POST mode (same per-widget URL — the "never the batch route" contract holds for
both methods; the data-contract test now exercises POST).

## Task 4 — session reconstructability: FLAGGED, no silent migration

**Decision required (not implemented here).** Reopening a saved guided dashboard
to *edit its plan* needs `guidedSession` (the intent — topic, disambiguations —
plus the full blueprint including undefined/skipped items and rationales) to
survive the save. Today `guidedSession` is client-only zustand state; the saved
version stores only `widgets[] + layout + change_summary + created_by`. Widgets
alone do **not** reconstruct the intent or the non-governed items.

Persisting it durably requires **either**:
- **(A, recommended)** a new nullable JSONB column
  `platform_dashboard_versions.guided_session` — a migration, **flagged and NOT
  run** per the scope guard; clean separation, queryable, obvious semantics; or
- **(B)** folding it into the existing `layout` JSONB — no migration, but overloads
  a layout field with intent state (semantically muddy).

Not overloading `layout` silently, and not running a migration silently. On reopen
today a guided dashboard loads into **manual** mode (widgets present) with an empty
`guidedSession`; "edit the plan" is unavailable until this decision lands. Meets
the acceptance clause "*or the schema need is flagged as a decision.*"
