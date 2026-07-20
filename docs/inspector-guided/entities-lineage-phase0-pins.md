# Entities + Lineage — Phase 0 substrate pins

Every `[U]` claim the prototype leaned on, flipped `[U]→[C]` against real code with a
file:line reference, in dependency order. Nothing in the build stands on an unpinned claim.
The rule the whole surface obeys: **do not render behavior on an unpinned claim** — a
half-pinned map that resolves three of four edges is this project's signature false-green.

Sources of truth verified: `src/lib/semantic/{compiler,execute,types,authoring-access}.ts`,
`src/lib/dashboards/{types,permissions}.ts`, `prisma/schema.prisma` (models around L2400–2589).

---

## Pin #1 — Estate resolution (THE load-bearing pin) → **[C]**

**Claim:** a governed measure/dimension resolves to a concrete `catalog.schema.table.field`.

**Resolved:** resolution is **model-side**, derived directly from the def rows — NOT by
parsing compiled SQL, and NOT invented.

- `catalog.schema.table` = `platform_sem_entities.full_path` — a single canonical
  lowercased string (there is **no** separate catalog/schema/table column).
  - schema: `prisma/schema.prisma:2426` (`full_path String` on `platform_sem_entities`).
  - compiler consumes it verbatim as the FROM target: `compiler.ts:273`
    (`` `${primaryEntity.full_path} ${primaryAlias}` ``), with the comment at
    `compiler.ts:271` confirming it is "already lowercased canonical form".
  - the loaded-model shape carries exactly `{ id, full_path, entity_label }`:
    `execute.ts:158-162`, `types.ts:75-79`.
- `.field` = the def's `column_name`, joined to its table via `entity_id`:
  - dimension → `platform_sem_dimensions.column_name` (`schema:2404`), entity via
    `entity_id` (`schema:2403`); compiler at `compiler.ts:303-308` / `334-337`.
  - measure (simple/cumulative) → `platform_sem_measures.column_name` (`schema:2468`,
    nullable), compiler at `compiler.ts:108-116` / `fullAggExpr` `137-145`.
  - measure (ratio/derived) → **no single field**; it is `expression` (`schema:2471`),
    compiler at `compiler.ts:93-106` / `361-370`. The UI must show "expression" here,
    never fabricate a `.column`.

**Answer to the Phase-0 question** ("does compiled SQL expose table/field recoverably, or is
a model-side mapping needed?"): **model-side mapping is authoritative and already loaded.**
`entity_id → full_path` + `column_name` is the resolution. The compiled-SQL "trust-spine
peek" is a *rendering* of the same data via `compileSemanticQuery` (pure, no execution) —
it is a second projection of the pin, not the pin itself.

**False-green guard (trap b, alias-vs-label):** node *labels* come from `entity_label` /
`dimension_label` / `measure_label`, but any *column/result* pull must go through
`toAlias(label)` (`compiler.ts:57-59`) — result rows are keyed by alias, not label. The
endpoints surface `column_name` (the real field) and `toAlias(label)` (the result key)
separately so a mismatch is visible, never silently empty.

---

## Pin #2 — Lineage graph source → **[C]**

**Claim:** a single graph read in two directions — forward (def → consumers) and reverse
("metrics that use X as a dimension").

**Resolved:** the real graph has **three** columns, not the prototype's five (there is no
stored source-system→entity link, and an entity *is* the estate table, a measure *is* the
metric — see "Reconciliation" below). Edge sets:

1. **def → estate table** (membership): `platform_sem_dimensions.entity_id` /
   `platform_sem_measures.entity_id` → `platform_sem_entities.id`.
   schema `2403` / `2467` / `2423`; loaded in `execute.ts:125-134`.
2. **table ↔ table** (join, carries the join keys): `platform_sem_joins`
   `{ from_entity_id, to_entity_id, join_type, join_on_sql }` — schema `2445-2462`,
   compiler `compiler.ts:280-294`. `join_on_sql` IS the join-key expression.
3. **def → consumer** (dashboard): a dashboard's current version widgets
   (`platform_dashboard_versions.widgets` JSONB, schema `2541`) hold
   `SemanticWidgetSpec.semanticQuery` which references defs **by id** —
   `DimRef.dimensionId` / `MeasureRef.measureId` (`dashboards/types.ts:115-116`,
   `semantic/types.ts:10-23`). "current" = `platform_dashboards.current_version_id`
   (schema `2561`); scope to `deleted_at: null` (schema `2563`).
   The per-widget ref set is *already* computed as
   `WidgetDataResult.definitionsUsed { dimensions, measures }` (`dashboards/types.ts:167`).

**Same read, two directions — confirmed:** forward = "for def D, which dashboards' widgets
reference D" (scan `semanticQuery.{measures,dimensions}[].id`). Reverse = "for dimension X,
which measures are co-referenced in a widget that also lists X" (same widget scan, read the
sibling `semanticQuery.measures[]`). One scan of widget `semanticQuery` references,
projected two ways.

**Invariant leaned on:** one dashboard = one model (`platform_dashboards.model_id`, schema
`2556`, `idx_pd_model`).

---

## Pin #3 — Candidate propagation → **[C] (as a UX rollup, NOT an execution gate)**

**Claim:** "a candidate upstream caps the downstream metric."

**Resolved:** per-def governance status is **real** (`status String @default("candidate")`
on entities/dimensions/measures — schema `2433` / `2413` / `2480`; tiers
`draft|candidate|governed|archived`, `authoring-access.ts:27`). But the *cap* is a
**governance-lens inference the UI computes**, not enforced execution behavior:

- the only hard execution gate is **model-level**: `execute.ts:117`
  (`if (!authoring && modelRow.status !== 'governed') throw SemanticModelNotGovernedError`).
- once a model is governed, it **executes its candidate defs** —
  `decideDefinitionAccess` returns `'allow'` for anything non-draft/non-archived, incl.
  `candidate` (`authoring-access.ts:52-53`, comment: "candidates already execute inside a
  governed model — pre-3.5A behavior").

So the endpoint reads real `status` per node and computes a `governanceCeiling` rollup
(a metric whose chain touches a `candidate` def is reported `capped`). This is rendered as
an **explicit state, never a 500** — mirroring the established `status: 'model_not_governed'`
UX state (`dashboards/types.ts:206-210`, "a UX state, not a 500"). The build must NOT claim
the cap blocks execution — it is an honest governance ceiling, not a runtime guarantee.

---

## Pin #4 — SCD on flag (valid_from / valid_to) → **[C]: NO backing field → dropped**

**Claim:** the flag dimension is SCD-2 with `valid_from` / `valid_to`.

**Resolved:** **there is zero SCD metadata on any `platform_sem_*` table.** No
`valid_from` / `valid_to` / SCD flag on entities, dimensions, or measures (schema
`2400-2486`; the only `valid_from` in the whole schema is `schema:2248`, an unrelated
table). SCD is a property of the underlying Databricks *source* data, invisible to the
semantic catalog.

**Decision:** the prototype's SCD-2 badge and `valid_from/valid_to` peek are demo fiction
with no source field. They are **not rendered** on the real surface (honest omission). If
SCD metadata is ever added to the model, wire it then — not on an unpinned claim.

---

## Reconciliation: prototype "entities" vs real `platform_sem_entities`

The prototype models Entities as `owner / flag / vessel-type / port` with example values and
distinct-count cardinality. In the real schema those are **dimensions** (categorical
columns), not `platform_sem_entities`:

- real `platform_sem_entities` = physical tables (`full_path`) — the prototype's "estate
  table" column. No `type` (owner/flag/…) column exists; the closest grouping key is
  `platform_sem_dimensions.dimension_type` (schema `2406`, default `categorical`).
- the prototype's "entity" (Owner/Flag/…) = a **dimension**. Its "classified by" text maps
  to `dimension.ai_context` / `synonyms` (schema `2408-2409`); example values + cardinality
  require a live Databricks `DISTINCT` read and therefore MUST go through the
  `executeDatabricksSQL` chokepoint (`execute.ts:211`) — they are **not** in the catalog
  metadata and are surfaced on-demand, not baked into the graph.

The endpoints are therefore **data-driven from the real model** (no hardcoded owner/flag/
vtype/port). The Entities catalog lists real entities + dimensions + measures grouped by
`entity` / `dimension_type`, status-tagged.

## Read gate

Governed defs are org-level catalog data. Read access = authenticated org member
(`canViewDashboard(role) = role !== null`, `permissions.ts`), matching the inline
`session → getUserByEmail → 401` pattern. Edit/define stays gated (existing PATCH routes).
Single-org assumption preserved via `getDefaultOrg()` (`agents.ts:81`) — not widened.

## Standing live-verification items (re-run when the estate makes them possible)

Two things the unit suite proves but the live org could NOT exercise at build time.
They are correct in the code; these notes exist so they get confirmed against real
data the first moment that's possible, instead of being assumed to still hold.

1. **forward == reverse edge equality — UNPROVEN on live data.**
   The unit fixture proves it (a dashboard referencing both a dim and a measure →
   forward `consumes` edges == reverse co-referenced set). But no dimension is consumed
   by any real widget yet, so the equality couldn't be cross-checked against the
   populated org. This is a limit of the estate, not the code.
   **Re-run trigger:** the first time any dashboard widget references a governed
   dimension. Then rebuild the focused graph on that dimension and assert its reverse
   `co-referenced measures` set == the forward `consumes` edges for the same widget.

2. **~99% candidate is HONEST, not a bug — and now self-explaining.**
   The live seam showed 3,097 / 3,125 defs capped. That's the expected state of a
   freshly auto-bootstrapped model: the model is governed while authoring hasn't yet
   promoted its defs. A reader without that context reads "the lineage view is all
   warnings" as a false alarm. `governanceSummary()` (lineage.ts) now ships the count
   WITH its explanation; both endpoints return `governance`, and the lineage UI renders
   a one-line bootstrap-context banner above the graph. The truth travels with its why.

## Reusable pattern: the omissions / unpinned channel

SCD and source-system had no backing field, so they are surfaced as an explicit
`OMISSIONS` list (lineage.ts) and rendered as "Not shown (no backing in the real
model)" — never a plausible-looking empty panel. This is structural, not a one-off:
**the next surface should bake an omissions/unpinned channel in from the start**, so
design-assumed fields that don't exist yet report themselves honestly rather than
resolving to a governed-looking blank. Honest-gap reporting as a first-class output,
not something remembered per screen.

## Two refinements banked (post-review)

1. **Omissions are first-class in the API CONTRACT, not just the UI.** The acceptance
   test for the pattern is: does a missing/unbacked field produce a *visible absence in
   the endpoint output*? Both endpoints now return a typed `omissions: Omission[]`
   (`{ field, reason }`, defined in lineage.ts) — lineage names source-system + SCD;
   entities-catalog names exampleValues + cardinality (live-Databricks-only). The prose
   `note` stays for humans, but the machine-readable omission is the contract. **For the
   next surface (multi-term resolution / Teach): "does the omission show up in the
   contract" is an ACCEPTANCE CRITERION, built in from the start — not an afterthought.**

2. **The 80% bootstrap threshold is itself an assumption — flagged, not resolved.**
   `governanceSummary`'s `BOOTSTRAP_CANDIDATE_PCT = 80` is tuned for a fresh
   auto-bootstrapped model (nearly all defs candidate). It will mislabel a real governed
   estate that settles at a lower candidate ratio as "bootstrapping". Left as-is for now;
   recalibrate/lower the day a real estate's candidate ratio falls below it. Comment in
   lineage.ts marks the recalibration point.
