# Build Plan — Metric Store

> **Goal.** A governed, browsable catalog of **metrics and entities**, organized spatially into
> "shelves" (thematic groupings) populated by "knowledge orbs" (individual metric/entity nodes) — with
> intent-aware search that **classifies each term before it answers** ("Spar" → owner, "Liberian" →
> flag, "tanker" → vessel type, "EEXI" → metric).
>
> **Status in one line.** This is **not greenfield and not a nav-wiring job.** ~60% of the Phase 1–2
> substrate already ships (catalog read + a 4-state multi-term resolver + a scored chart-defaults
> module); the missing ~40% is **front-loaded with the hardest slice** — entity-*value* classification
> — not a UI veneer. See [Size honesty](#size-honesty).
>
> **Grounding key** (aligned to the reconciliation legend, not the old "/mnt/project docs" one):
> `[C]` = shipped & wired in real code (file:line) · `[P]` = prototype/mock only (the
> `docs/metric store/*.html` estate) · `[U]` = absent or unproven-at-runtime, pin before trusting.
>
> **Source discipline.** Substrate facts are **cited to reconciled memory**, not re-derived here. The
> authority is the canonical reconciliation memory `nl-intent-metric-store-substrate-reconciled`
> (2026-07-20, source-verified; it supersedes the three earlier pins), mirrored in-repo — and so
> linkable from this doc — at
> [../inspector-guided/phase2-substrate-pins.md](../inspector-guided/phase2-substrate-pins.md)
> *§ "Current status — Metric Store reconciliation"*. The **fork** in Phase 0 and the entity-value gap
> in Phase 2 were additionally re-verified against real code on this pass; those carry their own
> `file:line`. Any place this plan diverges from memory is called out as a **FLAG**, not a silent
> restatement.

---

## Phase 0 — Confirm what's built, and resolve the resolve-path fork

The old Phase 0 ("confirm the two data sources") is superseded: the sources are confirmed, and the
real Phase-0 work is (a) inheriting the reconciled build-state and (b) resolving one dependency fork
that decides how far the data blocker reaches.

### What's already built `[C]`

- **Catalog read endpoint** `[C]` — `GET /api/inspector/semantic/entities-catalog` returns the
  governed model's entities with dimensions + measures grouped underneath, status-tagged, classified
  (synonyms / ai_context / dimension_type), and cross-linked to consuming dashboards; paginated +
  searchable (`~700` entities). Cited: reconciliation table, `entities-catalog` row
  ([entities-catalog/route.ts:41](../../src/app/api/inspector/semantic/entities-catalog/route.ts#L41)).
- **A 4-state multi-term resolver** `[C]` — `POST /api/inspector/semantic/[modelId]/resolve-intent`
  classifies each term `matched | ambiguous | not_governed | unrecognized`, wired into the guided
  builder. Cited: reconciliation "Three corrections" §2
  ([resolve-intent/route.ts:111](../../src/app/api/inspector/semantic/[modelId]/resolve-intent/route.ts#L111),
  [intent-resolve.ts:76](../../src/lib/dashboards/intent-resolve.ts#L76)). **Key caveat (cited):** it
  resolves on the **governance-state axis + measure/dimension kind**, *not* the owner/flag/vtype/metric
  **domain axis** the Store needs — see Phase 2.
- **Scored re-ranker (`disambiguation-rank`)** `[C]` — `POST .../disambiguation-rank` re-ranks a
  candidate list the **client already holds**, returning `{id,type,score,reason}[]` (+ `autoResolve`
  on a single governed-alias match). Cited: reconciliation §A. Note it is a **re-ranker, not a
  phrase→placement resolver** — and it is the one place a similarity **score already survives** (see
  §2.2). Plus synonyms reach both the resolver and the assembled prompt (reconciliation §B), and
  `recommendChartKind` is a shared pure module wired into both pipelines. Not on the Store's critical
  path, but the scored path already exists to build on.

### The fork — resolved on this pass (source-verified, not assumed)

> The kickoff flagged this as *"resolve before Phase 2, don't assume."* Resolved here against code.

**Question:** does Metric Store resolve ride the **deterministic classifier** (`intent-resolve.ts`, no
embeddings) or the **embedding path** (`matchIntents`, `nl_intent` embeddings)? This decides whether
the `nl_intent` data blocker (PIN-A) gates *resolve itself*, or only *starter-seeds and reranking*.

**Answer — the resolve path is layered, and only the top layer touches embeddings:**

1. **Core term resolution is deterministic and embedding-free** `[C]`. The route loads the
   **uncapped** governed+candidate field set straight from `platform_sem_dimensions` /
   `platform_sem_measures` and runs `fieldMatchesTerm → classifyTerm` — a pure label/synonym matcher,
   no vectors
   ([resolve-intent/route.ts:66-113](../../src/app/api/inspector/semantic/[modelId]/resolve-intent/route.ts#L66);
   [intent-resolve.ts:47-119](../../src/lib/dashboards/intent-resolve.ts#L47), whose own header calls
   embeddings "the *optional* embedding assist"). → **This layer is IMMUNE to the PIN-A `nl_intent`
   blocker.**
2. **The embedding assist runs only for would-be-`unrecognized` terms** and is best-effort — wrapped
   in try/catch, degrades to the deterministic true-absence when embeddings are unavailable
   ([resolve-intent/route.ts:116-143](../../src/app/api/inspector/semantic/[modelId]/resolve-intent/route.ts#L116)).
   It is the **only** `nl_intent` consumer on the resolve path. → **PIN-A degrades this layer**
   (fewer rescued unrecognized terms), but it already fails soft, so degradation ≠ breakage.
3. **Stage-1 starter seeds** (`listGovernedIntents`) read `platform_nl_intent_embeddings` directly
   ([intent-match.ts:197](../../src/lib/semantic/intent-match.ts#L197)). → **Fully PIN-A-gated**:
   empty substrate → empty seeds.

**Fork verdict:** Metric Store **resolve is largely immune** to the data blocker (the deterministic
core answers `matched`/`ambiguous`/`not_governed`/`unrecognized` from DB metadata); **only
starter-seeds and the unrecognized-term rescue/reranking are PIN-A-gated.** This confirms the
kickoff's hypothesis ("resolve *may be* immune") as **true**, and narrows the blast radius of the
blocker to seeds + reranking.

### The shared prerequisite — the `nl_intent` data blocker (PIN-A), front-loaded

Cited in full from reconciliation **PIN-A**
([phase2-substrate-pins.md#pin-a](../inspector-guided/phase2-substrate-pins.md)): `nl_intent` is
**universally null across all three orgs** in the live DB (`smoke-test-org`, `spinor-demo`,
`spinor-internal`); the measures/dimensions came from schema ingestion, which never sets `nl_intent`;
the capture path that fills it (guided/Teach authoring) has **never run against this DB**. Credentials
are **confirmed present and working** (Postgres, Bedrock/Titan-v2) — the blocker is **empty source
data, not provisioning**. `DEFAULT_ORG_SLUG` is still `spinor-demo` (a one-line change, not the
blocker).

**Consequence for this plan (do not re-derive — inherit):** pointed at any org today, the backfill
embeds **0 rows and exits cleanly**. So PIN-A is **not** an ops action that lands "any day"; it waits
on **upstream intent capture** (usage, or a deliberate `nl_intent` seed path) — which may never
happen on its own. That is a genuine **roadmap fork** the reconciliation records but does not resolve:
(a) accept empty Stage-1 seeds until authoring accumulates intents, or (b) build a small deliberate
`nl_intent` seed task. **Pin this once, shared with Teach and Guided** — same substrate, three
consumers.

**Net for Phase 0:** the data blocker gates **seeds + reranking**, *not* the resolve core. Build the
resolve core and catalog now; treat seeds as degradeable.

---

## Phase 1 — Catalog (done) + the shelf/orb placement model (the only build)

- **Catalog read = DONE** `[C]`. `entities-catalog` already returns everything an orb needs *except*
  spatial placement: per-def type, status, classification, `resolvesTo` estate location, and consumer
  cross-links ([entities-catalog/route.ts:102-143](../../src/app/api/inspector/semantic/entities-catalog/route.ts#L102)).
  Two fields are **explicitly omitted from the contract** and must stay omitted, not faked:
  `exampleValues` and `cardinality` — both require a live Databricks `DISTINCT` read through the
  `executeDatabricksSQL` chokepoint ([:158-171](../../src/app/api/inspector/semantic/entities-catalog/route.ts#L158)).
  This is the omissions-channel contract from
  [[entities-lineage-prototype-overclaims]] — surface as typed omissions, never a plausible empty
  panel.

- **Build ONLY the shelf/orb placement model** `[U]` app / `[P]` docs. Today grouping exists only as a
  `dimensionTypes` pivot in the route
  ([:146](../../src/app/api/inspector/semantic/entities-catalog/route.ts#L146)) and as static layout in
  `docs/metric store/*.html`; there is **no shelf/orb model** in app code (reconciliation table,
  *"Thematic shelving"* / *"Spatial shelves-and-orbs"* rows). Build a term/field → shelf + orb mapping
  on top of the existing catalog read. Start with a simple shelving rule (group by entity domain /
  metric category from semantic metadata — e.g. *Regulatory Efficiency*, *Ownership & Registration*,
  *Vessel Characteristics*).

- **Reuse the governed-only lens** `[C]` — candidate/ungoverned orbs render **dimmed/pulsing**, not as
  errors; governed render steady/bright. This is a **UX status rollup, not an execution gate**:
  candidate defs *do* execute inside a governed model, so a candidate orb is *capped/flagged*, never
  blocked ([[entities-lineage-prototype-overclaims]] §2). Governance ceiling = explicit rollup over
  real per-def status.

---

## Phase 2 — The differentiator (the real build — reordered hardest-first)

The differentiator is **domain-type classification of terms**, and it is **not** what the shipped
resolver does. The existing `resolve-intent` matches a term against **field labels/synonyms** on the
governance-state axis; the Store must type a term to a **domain concept** and, hardest of all, to an
entity **value**. Reordered hardest-first so the signature slice leads and the cheap plumbing trails.

### 2.1 — Entity-*value* classification `[P]` (the hardest slice, the real build)

"Liberian is a **flag value**," not "a dimension matched." This is a **different matching problem**
than anything shipped:

- The deterministic resolver matches term ↔ field **label/synonym** only
  ([intent-resolve.ts:47-57](../../src/lib/dashboards/intent-resolve.ts#L47)). It has **no access to
  distinct dimension values at all** — and value cardinality/examples are exactly what the catalog
  **omits** (live Databricks `DISTINCT` read required,
  [entities-catalog/route.ts:158-171](../../src/app/api/inspector/semantic/entities-catalog/route.ts#L158)).
- So domain-type/value classification exists today **only as mock JS** in
  [Multi-term Resolution (standalone).html:414-435](<./Multi-term Resolution (standalone).html>)
  (`TYPES`/`INDEX`, e.g. `'tanker'→vtype`, `'spar'→owner`). `[P]`, per reconciliation §2.

- **Mechanism is undecided — decide before building** (this ties back to the Phase-0 fork, but note it
  is a *distinct* data dependency):
  - **(a) Value index** — materialize per-dimension distinct values, classify against them. Needs the
    `executeDatabricksSQL` `DISTINCT` read path the catalog currently omits — **a different data
    dependency than PIN-A**, and one that *is* available (creds confirmed) if the read path is built.
  - **(b) Value embeddings** — embed values and match. **PIN-A-gated**, and inherits the empty-source
    problem.
  Layer whichever you pick **on top of** the existing `resolve-intent` resolver — extend it with a
  domain-type taxonomy, do **not** build a new resolver (reconciliation §2: "smaller than earlier
  assumed"). Represent a term matching >1 domain concept as **amber ambiguity — never guessed**
  (reconciliation PIN-B; mirrors the resolver's existing `ambiguous` bucket).

### 2.2 — Confidence-in-response `[C] value exists / [U] on the majority path`

- **True (cited):** cosine similarity is already computed and returned by the embedding path
  (`IntentMatch.similarity`, [intent-match.ts:143](../../src/lib/semantic/intent-match.ts#L143)), and
  the `resolve-intent` route **discards it** — the four-state `IntentDisambiguation` carries no
  confidence. (It survives in exactly one place: `disambiguation-rank`'s scoring — reconciliation §A.)
  Plumbing that value through is genuinely cheap where it exists.
- **⚠ FLAG — the kickoff's "cheap, just plumb an existing value" is only *partly* true, and I'm
  flagging it rather than restating it.** The cosine only exists on the **embedding-assist path**,
  which (i) runs *only* for would-be-`unrecognized` terms and (ii) is **PIN-A-gated**. The
  deterministic majority (`matched` / `ambiguous` / `not_governed`) go through boolean
  `fieldMatchesTerm` and carry **no score at all**
  ([resolve-intent/route.ts:112-113](../../src/app/api/inspector/semantic/[modelId]/resolve-intent/route.ts#L112)).
  So "surface confidence per term" is a free plumb for the embedding-rescued **minority**; a real
  per-term confidence for the deterministic matches is a **new** signal (a match-quality heuristic),
  not an existing value. This also reconciles the [[metric-store-multiterm-prototype]] "numeric
  per-term confidence % has no backing field" note: the value exists upstream but not for the terms
  that dominate the resolve path.

### 2.3 — Placement in the resolve response `[U]`

Extend `resolve-intent` (or a Store-specific sibling) to return, per term, the target **shelf + orb**
in addition to the candidate IDs it returns today. Small structural addition once 2.1 exists; the
route already loops per term and builds a per-term structure
([resolve-intent/route.ts:110-146](../../src/app/api/inspector/semantic/[modelId]/resolve-intent/route.ts#L110)).

---

## Phase 3 — Orb detail views

Now grounded in real spine (unchanged in intent; sources confirmed):

- **Metric orb** (e.g. EEXI): name, plain-language definition, formula/computation, the governed
  measure(s)/dimension(s) it's built from, **where in the data estate** it lives (the catalog's
  `resolvesTo` fullPath/column/expression), lineage, and `compileSemanticQuery`-derived **read-only
  SQL** as the "trust spine" ([compiler.ts:220](../../src/lib/semantic/compiler.ts#L220) — confirmed
  present). Governance status + last-verified stamp. Actions: "define / refine this metric" (→ the
  metric-authoring / Teach flow) and "ask Inspector about this" (deep-link).
- **Entity orb** (e.g. Flag): what kind of entity it is, how it's classified, example values, which
  metrics use it as a dimension, and where it lives in the estate. **Note:** example values require
  the on-demand Databricks `DISTINCT` read (the same omission as Phase 1) — render on demand or as a
  typed omission, never as a baked-empty field.

---

## Phase 4 — The spatial UI

Front-end build over Phases 1–3, now sitting on a **partly-built substrate** (`[P]` prototype exists;
no app route — reconciliation *"Spatial shelves-and-orbs Store route"* row):

- Shelves + knowledge orbs (governed = steady/bright; candidate = pulsing/dim).
- The **resolution strip** under the search bar: highlighted term → color-coded resolved type → the
  shelf & orb it maps to. **Two visual axes, kept distinct** (from [[metric-store-multiterm-prototype]]):
  underline = *classification* tier (solid/amber/red); orb style = *governance* (steady governed vs
  dashed-pulsing candidate). A port term is a solid classification but a candidate governance → drives
  the ceiling.
- "Did you mean…" chooser for ambiguous terms (inline, not a popover — sidesteps the
  `getBoundingClientRect`/`drawEdges` positioning trap noted in the prototype).
- Metric and entity detail panels.
- **Both light and dark themes** from shared tokens. Dark = orbs glow against deep space; light = orbs
  read as solid, softly-shadowed nodes with a colored **halo + saturation** (translate "glow" into
  "halo" so alive-ness survives on light). Classification colors adjusted for AA contrast per theme.

---

## Size honesty

- **~60% of the Phase 1–2 substrate already exists** `[C]`: catalog read + 4-state multi-term resolver
  + scored chart-defaults (reconciliation "Verified state — full table").
- **The missing ~40% is front-loaded with the hardest piece** — entity-*value* classification (§2.1) —
  not a UI veneer.
- **Metric Store is a multi-phase build** — **not** greenfield, **not** a nav-wiring job.
- **Do NOT ship a "Metric Store" nav label** until resolve + catalog + placement + value-classification
  all exist. Confirmed there is no such label today — the estate nav is
  `Overview / Catalog / Entities / Lineage / Jobs / Mapper / Silo Finder`
  ([nav-items.ts:28-36](../../src/lib/estate/nav-items.ts#L28)). This is the naming-lie caution shared
  with discoverability W3: a nav entry is a promise the surface behind it is real.

---

## Risks to carry

- **Data blocker → generic filler that reads like a UI bug** — **now bounded** by the resolved fork:
  it hits **starter-seeds + reranking**, *not* the resolve core (Phase 0). Where seeds are empty,
  render the honest empty state, not plausible-looking filler. Do not re-widen this to "resolve is
  blocked" — that was the assumption the fork disproved.
- **Value-classification mechanism undecided** (value-index-via-`DISTINCT` vs. value-embeddings) —
  **decide before Phase 2.1.** The two carry *different* data dependencies (the Databricks `DISTINCT`
  read path vs. PIN-A); the choice is not cosmetic.
- **Confidence-in-response is not uniformly cheap** (§2.2 FLAG) — free for embedding-rescued terms,
  a new heuristic for the deterministic majority. Don't scope it as a one-line plumb.
- **PIN-A may never self-resolve** — it waits on upstream capture, not provisioning (Phase 0). Decide
  the roadmap fork (accept-empty vs. build-a-seed-path) explicitly; don't leave it implicit.
- **Drift with reconciled memory** — substrate facts are cited to
  [../inspector-guided/phase2-substrate-pins.md](../inspector-guided/phase2-substrate-pins.md); the
  one place this plan sharpens memory (§2.2 confidence) is flagged, not silently diverged.

---

## Dependency note (shared substrate)

Phase 2's *seed/rerank* quality — not its resolve core — is capped by the `nl_intent` subsystem being
populated and correctly scoped: the same `[U]` substrate the Teach flow writes into. Build Teach and
Metric Store to **pin that substrate once, first** (PIN-A). The two features feed each other:
**teaching produces the intents and synonyms the Store's seeds resolve against** — which is precisely
why the substrate is empty today (the capture path hasn't run).

**Shared rule — verification tiering.** Both surfaces promote definitions into the same governed
substrate, so they must agree on when an unverified thing may advance. The rule (owned in
[teach-build-plan.md](../teach%20mode/teach-build-plan.md) → *Shared rule: verification tiering*):
verification is **advisory at capture** and a **hard gate at promote** — a candidate may exist with a
`0 rows` / `model-not-governed` outcome, but promotion to governed requires `confirmed` (plus grounded
deps, no synonym conflicts, steward role). Enforce it on the shared promote path, not per-screen; the
`Define a Metric` prototype's readiness checklist merely renders it.
