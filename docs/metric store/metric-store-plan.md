# Build Plan — Metric Store

> **Goal.** A governed, browsable catalog of **metrics and entities**, organized spatially into
> "shelves" (thematic groupings) populated by "knowledge orbs" (individual metric/entity nodes) — with
> intent-aware search that **classifies each term before it answers** ("Spar" → owner, "Liberian" →
> flag, "tanker" → vessel type, "EEXI" → metric).
>
> **Grounding key.** `[C]` = confirmed against `/mnt/project/` docs · `[I]` = inferred from a documented
> mechanic · `[U]` = named only in the screenshot / walkthrough spec / kickoff prompt, **not** in the
> two source docs — must be pinned against real code before trusting.

---

## Phase 0 — Confirm the two data sources feeding it

The Store reads from things already documented, plus one unconfirmed classification layer:

- **Semantic model** `[C]` — entities, dimensions, measures and their governed labels/definitions live
  behind the `semantic/[modelId]/definitions` route and the `execute.ts` model load (memory §4.1, §7).
  Metrics = measures; entity types (owner / flag / vessel type) = entities/dimensions.
- **Data-estate location** `[C]` (conceptually) — "where in the estate a metric lives" maps to the
  compiled SQL source (`compileSemanticQuery`) plus the catalog/estate surfaces (Catalog, Mapper,
  Overview in the dashboard screenshot). Confirm how a measure resolves back to a concrete source
  table/field.
- **Classification / intent layer** `[U]` — leans on vocabulary/synonyms + NL-intent embeddings. This is
  Step 0 / seam 6–7 territory in the walkthrough spec and is **not** in either source doc. Pin it before
  relying on it.

---

## Phase 1 — Catalog + shelving API

A read endpoint returning all governed metrics and entities, grouped into "shelves."

- Start with a simple shelving rule: group by entity domain / metric category drawn from semantic
  metadata. (Example shelves: *Regulatory Efficiency*, *Ownership & Registration*, *Vessel
  Characteristics*.)
- Per-orb metadata: type, definition, governance status, usage/importance (drives orb size/glow), and
  estate location.
- Reuse the governed-only lens — candidate/ungoverned items render **dimmed/pulsing**, not as errors
  (`[C]`, memory §4.5). Governed items render steady and bright.

---

## Phase 2 — The intent-resolution endpoint (the differentiator)

`POST /resolve` — takes a natural-language phrase, returns per recognized term: resolved **type**
(owner / flag / vessel type / metric), confidence, matched semantic entity/measure id, and target
shelf + orb.

This is the plan's disambiguation model (§4.3: solid = matched, amber = ambiguous, red = unrecognized)
applied to *browsing* instead of charting:

- "Spar" → matches an **owner** entity value → owner classification.
- "Liberian" → **flag** dimension value.
- "tankers" → **vessel type** dimension value.
- "EEXI" → **metric** (measure) → definition + estate location.

Back it with the NL-intent embeddings + synonym resolution (the pinned `[U]` subsystem). Two failure
modes to guard against, both from the walkthrough spec:

- **Dead synonyms** (seam 6) — confirm synonyms actually reach the resolver, not merely sit in a table.
- **Empty/wrong-org backfill** (Step 0) — confirm embeddings are scoped to the correct populated org, not
  the demo org (`getDefaultOrg()` single-org assumption is a documented risk, memory §5.8).

---

## Phase 3 — Orb detail views

- **Metric orb** (e.g. EEXI): name, plain-language definition, formula/computation, the governed
  measure(s)/dimension(s) it's built from, **where in the data estate** it lives (source table/field),
  lineage, `compileSemanticQuery`-derived read-only SQL (the "trust spine" pattern, plan §4.2), governance
  status, last-verified stamp. Actions: "define / refine this metric" (→ the metric-authoring / Teach
  flow) and "ask Inspector about this" (deep-link).
- **Entity orb** (e.g. Flag): what kind of entity it is, how it's classified, example values, which
  metrics use it as a dimension, and where it lives in the estate.

---

## Phase 4 — The spatial UI

Mostly a front-end/visual build on top of the Phase 1–3 APIs:

- Shelves + knowledge orbs (governed = steady/bright; candidate = pulsing/dim).
- The **resolution strip** under the search bar: highlighted term → color-coded resolved type → the
  shelf & orb it maps to.
- "Did you mean…" chooser for ambiguous terms (e.g. owner vs. port name).
- Metric and entity detail panels.
- **Both light and dark themes** from shared tokens. Dark = orbs genuinely glow against deep space;
  light = orbs read as solid, softly-shadowed nodes with a colored **halo + saturation** (translate
  "glow" into "halo" so alive-ness survives on a light background). Semantic classification colors
  adjusted for AA contrast in each theme.

---

## Dependency note

Phase 2's quality is capped by the NL-intent / vocabulary subsystem being real and correctly scoped —
the same `[U]` substrate the Teach flow writes into. If Teach and Metric Store are built in parallel
threads, pin that substrate once, first. The two features feed each other: **teaching produces the
synonyms and definitions the Store resolves against.**

**Shared rule — verification tiering.** Both surfaces promote definitions into the same governed
substrate, so they must agree on when an unverified thing may advance. The rule (owned in
[teach-build-plan.md](../teach%20mode/teach-build-plan.md) → *Shared rule: verification tiering*):
verification is **advisory at capture** and a **hard gate at promote** — a candidate may exist with a
`0 rows` / `model-not-governed` outcome, but promotion to governed requires `confirmed` (plus grounded
deps, no synonym conflicts, steward role). Enforce it on the shared promote path, not per-screen; the
`Define a Metric` prototype's readiness checklist merely renders it.
