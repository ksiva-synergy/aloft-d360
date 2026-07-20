# Guided Builder — Phase 2 substrate pins (read-only verification pass)

**Date:** 2026-07-20
**Branch:** `feat/inspector-dashboards-reframe`
**Scope:** Pin the three `[U]` substrate items that Phase 2 (Stage 1 Intent + Stage 2 Blueprint)
is built on — NL-intent embeddings, synonym→prompt injection, and `chart-defaults.ts`. Read-only:
**no backfill run, no store mutated, no UI authored, no Phase-1 file touched.** Concept-grepped,
not name-trusted; every claim carries a `file:line`.

**Verdict up front:** All three pins flip from `[U]`/`[I]` to **`[C]` (static-confirmed)**. The
substrate exists, is org- and model-scoped by construction, and reaches the assembled prompt. The
**only** residual is a live-data question — *did the backfill run against the populated org, and
are there rows?* — which sits behind the same dark-cred gate as SEC-4 and is flagged
**runtime-pending**, not confirmed. This is the shared `[U]` substrate the Teach pass
([teach-phase0-substrate-pins.md](../teach%20mode/teach-phase0-substrate-pins.md)) and the Metric
Store plan also depend on — pinned once, here.

---

## Pin 1 — Captured-intent / NL-intent embeddings + org scoping `[C static]`

Powers Stage 1 starter topics (the "never a blank box" seed set).

### The store (real names)
- **Table / model:** `platform_nl_intent_embeddings` / `PlatformNlIntentEmbedding` —
  [schema.prisma:1979](../../prisma/schema.prisma#L1979). This is the **Phase-3.5D parallel table**,
  distinct from `platform_agent_memory` (which the Teach pass pinned for standing rules).
  Columns: `id, org_id, source_type ('measure'|'dimension'|'raw_chart'), source_id, intent_text,
  embedding (pgvector), model_id, created_by, created_at, updated_at`. Unique on
  `(source_type, source_id)`; indexed on `org_id` ([schema.prisma:1991-1992](../../prisma/schema.prisma#L1991)).
  Status is **not** denormalised — matching JOINs live to the source row
  ([schema.prisma:1976](../../prisma/schema.prisma#L1976)), so a promote/demote reflects instantly.
- **Write side:** `upsertIntentEmbedding()` — [intent-embed.ts:30](../../src/lib/semantic/intent-embed.ts#L30).
  Embeds `intent_text` via the **same** `embedQuery` (Titan-v2, 1024-dim) the context-builder uses;
  raw `INSERT … ON CONFLICT (source_type, source_id) DO UPDATE`. Non-fatal by design — a save never
  fails on embed error ([intent-embed.ts:71](../../src/lib/semantic/intent-embed.ts#L71)).
- **Read side:** `matchIntents()` (cosine-ranked, [intent-match.ts:150](../../src/lib/semantic/intent-match.ts#L150))
  and `listGovernedIntents()` (no-query, empty-state seeds, [intent-match.ts:197](../../src/lib/semantic/intent-match.ts#L197)).

### Org scoping — the crux (not existence)
**Column-level org scoping is present on both sides; the org *value* is a single env-resolved id,
not session-derived.** Concretely:
- Every write passes `org_id = ${args.orgId}` ([intent-embed.ts:59](../../src/lib/semantic/intent-embed.ts#L59)),
  and every runtime caller resolves that org via **`getDefaultOrg()`**, which reads
  `process.env.DEFAULT_ORG_SLUG` → `findFirstOrThrow` — explicitly *not* session/membership
  ([platform/agents.ts:79-90](../../src/lib/platform/agents.ts#L79)). Callers:
  - draft capture (measure/dimension): [drafts/route.ts:224](../../src/app/api/inspector/semantic/[modelId]/drafts/route.ts#L224), [:259](../../src/app/api/inspector/semantic/[modelId]/drafts/route.ts#L259) (org at [:47](../../src/app/api/inspector/semantic/[modelId]/drafts/route.ts#L47), [:154](../../src/app/api/inspector/semantic/[modelId]/drafts/route.ts#L154));
  - governed-def PATCH: [definitions/[definitionId]/route.ts:133](../../src/app/api/inspector/semantic/[modelId]/definitions/[definitionId]/route.ts#L133);
  - raw-SQL chart save: [charts/route.ts:142](../../src/app/api/inspector/charts/route.ts#L142).
- The **backfill** resolves org the *same* way — `process.env.DEFAULT_ORG_SLUG`
  ([backfill-nl-intent-embeddings.ts:24-25](../../scripts/backfill-nl-intent-embeddings.ts#L24)) — so
  backfill, runtime writes, and reads all target the **same single env-configured org**. They
  cannot drift relative to each other.

**Answer to the memory §5.8 question:** org is **hardcoded via env (`DEFAULT_ORG_SLUG`),
single-org**, not derived from request/session context. (The Teach pass found the memory-store path
uses a sibling `getDefaultOrg` on `DEFAULT_ORG_ID` — [teach-phase0 §1](../teach%20mode/teach-phase0-substrate-pins.md);
both are single-org, just different env vars for different subsystems.)

### How Stage 1 queries it — org-scoped **and** model-scoped
Stage 1 seeds come from `listGovernedIntents(orgId, { limit, modelId })`
([intent-match.ts:197](../../src/lib/semantic/intent-match.ts#L197)), already exposed at
`GET /api/inspector/semantic/[modelId]/intents` ([intents/route.ts:18-28](../../src/app/api/inspector/semantic/[modelId]/intents/route.ts#L18)).
The SQL filters `WHERE ie.org_id = ${orgId} AND (${modelId} IS NULL OR ie.model_id = ${modelId})`
([intent-match.ts:213-215](../../src/lib/semantic/intent-match.ts#L213)), returns **governed-only**
intents ([intent-match.ts:226](../../src/lib/semantic/intent-match.ts#L226)), dedups by intent text,
most-recent first. So the starter-topic query **is org-scoped and model-scoped** — a private draft
intent never surfaces here (visibility rules at [intent-match.ts:66-79](../../src/lib/semantic/intent-match.ts#L66)).

### Mechanism assertion (not a row count)
**The code CAN produce populated-, org-, and model-scoped intents.** The write/backfill/read loop is
internally consistent on one env-resolved org, the read query is doubly scoped, and status is
resolved live. What the code *cannot* self-verify is whether `DEFAULT_ORG_SLUG` points at the
**populated** org (vs a demo/empty org) and whether the backfill was actually run to produce rows —
that is the exact "empty-org backfill" risk (memory §5.8) and needs the live DB. **See runtime-pending.**

**Phase-2 readiness:** ✅ **Safe to build Stage 1 topic seeds on this.** `listGovernedIntents(org, {modelId})`
is the seed source and is correctly scoped. Blocked *only* if the runtime row-count check (below)
comes back empty for the target org — in which case the fix is data (run the backfill / govern
intents), not code.

---

## Pin 2 — Synonym resolution reaches the LLM context `[C static — live in assembled prompt]`

Powers Stage 1 disambiguation; guards the "dead synonym" (seam-6) false-green.

### Traced through to the assembled prompt (not just the table)
`buildSemanticContext()` loads synonyms onto the summary objects it returns —
`GovernedEntitySummary.synonyms` / dimension & measure `synonyms`
([context-builder.ts:174](../../src/lib/semantic/context-builder.ts#L174), [:181](../../src/lib/semantic/context-builder.ts#L181), [:188](../../src/lib/semantic/context-builder.ts#L188)).
That context is then **rendered into prompt text**: `buildSemanticPromptSection` emits each synonym as
`", also called: …"` for entities, dimensions, and measures
([prompts.ts:326-345](../../src/lib/inspector/prompts.ts#L326)), and `buildSystemPrompt` concatenates
the section into the system prompt ([prompts.ts:363](../../src/lib/inspector/prompts.ts#L363)). The
prompt even states the intent — *"A synonym nobody reads is dead weight"*
([prompts.ts:325](../../src/lib/inspector/prompts.ts#L325)). **Synonyms are asserted present in the
assembled context, not merely in a DB column.** Not flag-gated.

### Personal-vs-org scoping + the two real dead-synonym traps
- **Scoping:** governed synonyms live as `synonyms text[]` on the semantic def tables; their reach
  follows the definition's governance ladder. Standing **rules** (a separate vocabulary surface) are
  personal-first in `platform_agent_memory` via `teachRule()` and are **not** part of
  context-builder's output — see [teach-phase0 §2-3](../teach%20mode/teach-phase0-substrate-pins.md).
- **Trap 1 — governed-only load.** `buildSemanticContext` loads only `status='governed'`
  entities/dims/measures ([context-builder.ts:71](../../src/lib/semantic/context-builder.ts#L71), [:79](../../src/lib/semantic/context-builder.ts#L79)).
  A synonym on a **candidate or draft** definition is stored but **never injected** until governed.
- **Trap 2 — top-K cap (default 10).** Only the top-K pgvector-ranked entities are injected
  ([context-builder.ts:68](../../src/lib/semantic/context-builder.ts#L68), [:144](../../src/lib/semantic/context-builder.ts#L144)).
  Synonyms on entities beyond the cap never reach the prompt.

**Phase-2 readiness:** ✅ **Safe to build Stage 1 disambiguation on this** — synonyms genuinely reach
the LLM. Stage 1 UX must mirror the two traps: a synonym on a not-yet-governed or below-top-K field
is *dead until governed and ranked*, so don't render it as "live." (This is the seam-6 failure the
pin exists to prevent — asserted in assembled context, not the table.)

---

## Pin 3 — `chart-defaults.ts` `[C static — exists AND already shared across both pipelines]`

Powers Stage 2 `chartKindGuess`. **The plan's `[I]` "planned, not yet built" is stale.**

- **Exists:** [src/lib/dashboards/chart-defaults.ts](../../src/lib/dashboards/chart-defaults.ts) —
  a **pure** module (no I/O / React / Prisma), with an exhaustive unit suite
  ([__tests__/chart-defaults.test.ts](../../src/lib/dashboards/__tests__/chart-defaults.test.ts)).
- **Signature:** `recommendChartKind(query: SemanticQuery, resolvedDefs: ResolvedDefinitions): ChartRecommendation`
  ([chart-defaults.ts:111](../../src/lib/dashboards/chart-defaults.ts#L111)), returning
  `{ chartKind, rationale, alternatives }`. Plus `recommendedKindToWidgetKind()`
  ([chart-defaults.ts:210](../../src/lib/dashboards/chart-defaults.ts#L210)) mapping the recommender's
  superset kinds (`pie`/`table`) onto `WidgetSpec['chartKind']`, and `isTimeDimensionType()`.
- **Field-combination → chart-type rules** (top-down, first match; [chart-defaults.ts:99-203](../../src/lib/dashboards/chart-defaults.ts#L99)):
  1 measure / 0 dims → `kpi`; 2 measures / 0 dims → `scatter`; 1 time dim + measure → `line`;
  1 categorical + measure → `bar` (low- and high-cardinality both → bar, never pie); 2 dims + measure
  → `heatmap`; ≥3 dims or nothing plottable → `table`. Conservative on cardinality by design (no
  warehouse `COUNT(DISTINCT)` probe → treated low-card → bar, [chart-defaults.ts:12-16](../../src/lib/dashboards/chart-defaults.ts#L12)).
- **Shared by both pipelines — already wired (TIP §4.4 satisfied):**
  - **Chat pipeline:** `recommendChartKind` called at [chart-pipeline.ts:402](../../src/lib/inspector/chart-pipeline.ts#L402);
    `ChartRecommendation` type consumed in [useInspectorChat.ts:9](../../src/hooks/useInspectorChat.ts#L9).
  - **Builder:** [DashboardBuilder.tsx:237](../../src/components/inspector/dashboard-builder/DashboardBuilder.tsx#L237), [:268](../../src/components/inspector/dashboard-builder/DashboardBuilder.tsx#L268), [:376](../../src/components/inspector/dashboard-builder/DashboardBuilder.tsx#L376);
    alternatives surfaced in [WidgetConfigPanel.tsx:138](../../src/components/inspector/dashboard-builder/WidgetConfigPanel.tsx#L138).
  - Empty-state generator reuses `isTimeDimensionType` ([empty-states.ts:17](../../src/lib/dashboards/empty-states.ts#L17)).

**Phase-2 readiness:** ✅ **Safe to build Stage 2 chart-type guess on this — no build item.** It is
the single shared pure module the plan wanted, already called by both the chat pipeline and the
builder. Stage 2 blueprint just needs to call `recommendChartKind` with the resolved
measure/dimension shape. (One carry-forward: it needs `ResolvedDimension.type` — the
`platform_sem_dimensions.dimension_type` — to detect time axes; feed resolved types into the
blueprint step, not raw IDs.)

---

## Static-confirmed vs. runtime-pending split

| Finding | Status |
|---|---|
| `platform_nl_intent_embeddings` exists; columns; unique/index | **Static-confirmed** |
| Write/backfill/read all target one env-resolved org (`DEFAULT_ORG_SLUG`), column-scoped | **Static-confirmed** |
| Stage 1 seed query is org- **and** model-scoped, governed-only | **Static-confirmed** |
| Synonyms reach the **assembled prompt** (not just the table); governed-only + top-K traps | **Static-confirmed** |
| `chart-defaults.ts` exists, pure, and is wired into **both** chat + builder | **Static-confirmed** |
| **Actual embedding row count per org** (are there governed intents to seed?) | ⏳ **Runtime-pending (live creds)** |
| **`DEFAULT_ORG_SLUG` resolves to the *populated* org, not the demo/empty org** | ⏳ **Runtime-pending (live creds)** |
| Backfill was actually **run** on the target org (its embeddings exist) | ⏳ **Runtime-pending (live creds)** |

The two runtime-pending items are the substance of Risk 2 (substrate empty/wrong-org → generic
blueprints). They sit behind the **same dark-cred gate as the SEC-4 runtime verification** — do not
claim confirmed. Verification command when creds land (read-only):
`SELECT org_id, count(*) FROM platform_nl_intent_embeddings GROUP BY org_id;` and cross-check the
top-count `org_id` against the org `DEFAULT_ORG_SLUG` resolves to.

## One-line Phase-2 readiness verdict per pin

- **Pin 1 (Stage 1 topic seeds):** Safe to build — `listGovernedIntents(org, {modelId})` is correctly
  org+model-scoped; *blocked only if* the runtime row-count for the target org is empty (a data fix:
  run the backfill / govern intents, not a code fix).
- **Pin 2 (Stage 1 disambiguation):** Safe to build — synonyms verifiably reach the assembled prompt;
  UX must respect governed-only + top-K so a dead synonym isn't shown as live.
- **Pin 3 (Stage 2 chart-type guess):** Safe to build — `recommendChartKind` already exists as the
  shared pure module and is called by both pipelines; nothing to build here, just call it.

---

## Current status — Metric Store reconciliation (re-verified 2026-07-20)

> Supersedes earlier thread-derived "phase" estimates, which were assembled from planning
> summaries by a reviewer who had not read the tree. Where they conflict with the table below,
> **the table wins.** Every `file:line` here was re-confirmed by grepping the **symbol** (not the
> line) on this pass — lines drift, symbols don't. **All 17 references resolved; zero broken.**
> Two cited ranges were off by 1–2 lines from the true symbol location — corrected below and
> logged in the drift ledger, not silently repointed. Legend: `[C]` shipped & wired ·
> `[P]` prototype/mock only · `[U]` absent or unpinned.

### Three corrections to the earlier read

1. **Synonyms are NOT dead — they reach both paths.** Resolver:
   [intent-resolve.ts:50](../../src/lib/dashboards/intent-resolve.ts#L50) (`haystacks = [field.label, ...field.synonyms]`).
   Prompt: [context-builder.ts:174/181/188](../../src/lib/semantic/context-builder.ts#L174) load them →
   [prompts.ts:326](../../src/lib/inspector/prompts.ts#L326) `synHint()` emits `", also called: …"`
   (intent stated at [:325](../../src/lib/inspector/prompts.ts#L325), *"A synonym nobody reads is dead weight"*) →
   live via [chat/route.ts:175/180](../../src/app/api/inspector/chat/route.ts#L175)
   (`buildSemanticContext` → `buildSystemPrompt`). The seam-6 dead-synonym failure is closed in code.
   **Standing watch:** the prompt path only sees governed + top-K entities (Pin 2, Traps 1–2), so a
   synonym on a candidate or long-tail entity silently won't reach the model. **`[C]`, with a watch.**

2. **A multi-term resolver already ships — but on the wrong axis for the Store.**
   [resolve-intent/route.ts:111](../../src/app/api/inspector/semantic/[modelId]/resolve-intent/route.ts#L111)
   (`for (const term of terms)`) + [intent-resolve.ts:76](../../src/lib/dashboards/intent-resolve.ts#L76)
   (`classifyTerm`), wired from [IntentStage.tsx:111](../../src/components/inspector/dashboard-builder/guided/IntentStage.tsx#L111),
   is real and multi-term — but it classifies **governance state**
   (governed / ambiguous / not-governed / unrecognized) + `measure`/`dimension` kind
   ([route.ts:102-103](../../src/app/api/inspector/semantic/[modelId]/resolve-intent/route.ts#L102)).
   The Store's differentiator — typing a term to a **domain concept**
   (owner / flag / vessel-type / metric) — exists only as mock JS in
   [Multi-term Resolution (standalone).html:414-435](../metric%20store/Multi-term%20Resolution%20(standalone).html)
   (`TYPES`/`INDEX` map, e.g. `'tanker' → vtype`, `'spar' → owner`). So Phase 2 is *"add a domain-type
   taxonomy on top of an existing resolver,"* **not** *"build a resolver"* — smaller than earlier assumed.
   **Resolver `[C]`; domain-type classification `[P]`.**

3. **The populated-org backfill is unproven — the repo already flags it.** The backfill script is
   real and idempotent (skip-set at [backfill-nl-intent-embeddings.ts:28-32](../../scripts/backfill-nl-intent-embeddings.ts#L28),
   org-filtered fetch [:36-57](../../scripts/backfill-nl-intent-embeddings.ts#L36), Titan upsert
   [:106](../../scripts/backfill-nl-intent-embeddings.ts#L106)), but the org is env-only
   ([:24-25](../../scripts/backfill-nl-intent-embeddings.ts#L24) reads `DEFAULT_ORG_SLUG`) and the only
   committed value is a **demo** org ([task-definition.json:24](../../infra/context/task-definition.json#L24) = `spinor-demo`).
   The runtime-pending row already sits in this doc at [the split table above](#L162). No embeddings are
   proven to exist for the real populated org. This is the empty-org-backfill finding, live. **`[U]` (runtime).**

### Verified state — full table

| Item | Verdict | Evidence (re-grepped by symbol) |
|---|---|---|
| NL-intent backfill script | `[C]` | [backfill-nl-intent-embeddings.ts:36-57](../../scripts/backfill-nl-intent-embeddings.ts#L36) (org-filtered fetch), idempotent [:28-32](../../scripts/backfill-nl-intent-embeddings.ts#L28), Titan upsert [:106](../../scripts/backfill-nl-intent-embeddings.ts#L106) |
| …scoped to populated org | **`[U]`** | env-only [`DEFAULT_ORG_SLUG`:24-25](../../scripts/backfill-nl-intent-embeddings.ts#L24) → [`spinor-demo`](../../infra/context/task-definition.json#L24); [runtime-pending](#L162) |
| Synonyms → resolver + prompt | `[C]` (watch) | [intent-resolve.ts:50](../../src/lib/dashboards/intent-resolve.ts#L50); [context-builder.ts:174](../../src/lib/semantic/context-builder.ts#L174) → [prompts.ts:326](../../src/lib/inspector/prompts.ts#L326) → [chat/route.ts:175](../../src/app/api/inspector/chat/route.ts#L175) |
| Domain-type term classifier (owner/flag/vtype/metric) | **`[P]`** | mock only: [Multi-term Resolution (standalone).html:414-435](../metric%20store/Multi-term%20Resolution%20(standalone).html) |
| Multi-term resolve route (governance-state axis) | `[C]` | [resolve-intent/route.ts:111](../../src/app/api/inspector/semantic/[modelId]/resolve-intent/route.ts#L111); [intent-resolve.ts:76](../../src/lib/dashboards/intent-resolve.ts#L76); [IntentStage.tsx:111](../../src/components/inspector/dashboard-builder/guided/IntentStage.tsx#L111) |
| Catalog endpoint (flat/paginated) | `[C]` | [entities-catalog/route.ts:41](../../src/app/api/inspector/semantic/entities-catalog/route.ts#L41), `hasMore` [:153](../../src/app/api/inspector/semantic/entities-catalog/route.ts#L153) |
| Thematic shelving | **`[U]` app / `[P]` docs** | no shelf grouping in route (only `dimensionTypes` pivot [:146](../../src/app/api/inspector/semantic/entities-catalog/route.ts#L146)); plan only [metric-store-plan.md:31-36](../metric%20store/metric-store-plan.md#L31) |
| Spatial shelves-and-orbs Store route | **`[P]`** | estate nav = Overview/Catalog/Entities/Lineage/Jobs/Mapper/Silo [EstateNav.tsx:15-21](../../src/app/(agent)/agent-lab/estate/EstateNav.tsx#L15); prototype [Metric Store (standalone).html](../metric%20store/Metric%20Store%20(standalone).html) |
| lineage forward==reverse on live data | **`[P]`** | unit fixture only [lineage.test.ts:95](../../src/lib/semantic/__tests__/lineage.test.ts#L95); live path [estate/lineage/page.tsx:63](../../src/app/(agent)/agent-lab/estate/lineage/page.tsx#L63) is a **page**, not a widget |
| `BOOTSTRAP_CANDIDATE_PCT = 80` | `[C]` unchanged | [lineage.ts:484-485](../../src/lib/semantic/lineage.ts#L484); recalibrate caveat intact [:480](../../src/lib/semantic/lineage.ts#L480) |

### Drift ledger (cited line → true symbol location, this pass)

Logged loudly so a plausible-but-wrong "fix" never masquerades as green. All still resolve:
- Backfill env-org: reconciliation said `:23-26` → symbol (`DEFAULT_ORG_SLUG` read) is at **:24-25**.
- Estate nav tabs: reconciliation said `:14-22` → nav array entries are at **:15-21**.
- (All other cites landed within their stated range once re-grepped by symbol.)

### Phase-0 substrate pins still `[U]` — these gate Phase 2, Teach, AND Guided Dashboards

**Resolved symbols (re-grepped this pass):** the embeddings table is **`platform_nl_intent_embeddings`**,
org column **`org_id`**. Write path: raw `INSERT INTO platform_nl_intent_embeddings (id, org_id, …)`
at [intent-embed.ts:56-57](../../src/lib/semantic/intent-embed.ts#L56), `ON CONFLICT (source_type,
source_id) DO UPDATE` at [:63-64](../../src/lib/semantic/intent-embed.ts#L63). Backfill reads the same
table (`WHERE org_id = ${org.id}`) at [backfill-nl-intent-embeddings.ts:30](../../scripts/backfill-nl-intent-embeddings.ts#L30);
the captured-intents it will embed come from `platform_sem_measures` / `platform_sem_dimensions`
(`nl_intent IS NOT NULL`, [backfill:36-53](../../scripts/backfill-nl-intent-embeddings.ts#L36)) +
`platform_charts` ([:54-57](../../scripts/backfill-nl-intent-embeddings.ts#L54)).

#### PIN-A — TRACKED BLOCKER (dark-cred gate, same as SEC-4). Runnable-on-arrival.

Not a spec — the literal block below executes the instant creds land, no re-derivation:

```
ACTION:  Run scripts/backfill-nl-intent-embeddings.ts with DEFAULT_ORG_SLUG set to the
         POPULATED org (NOT spinor-demo). It is idempotent (skip-set at backfill:28-32),
         so re-runs are safe.

ASSERT:  -- (1) embeddings actually landed for the populated org:
         SELECT org_id, COUNT(*) AS embeddings
           FROM platform_nl_intent_embeddings
          GROUP BY org_id;
         -- (2) reconcile against what SHOULD have been embedded (Step 0.2 —
         --     "some rows exist" is NOT sufficient; the count must match):
         SELECT COUNT(*) AS captured_intents FROM (
           SELECT id FROM platform_sem_measures    WHERE org_id = :populated AND nl_intent IS NOT NULL
           UNION ALL
           SELECT id FROM platform_sem_dimensions  WHERE org_id = :populated AND nl_intent IS NOT NULL
           UNION ALL
           SELECT id FROM platform_charts          WHERE org_id = :populated AND nl_intent IS NOT NULL
                                                     AND deleted_at IS NULL
         ) t;
         PASS iff: embeddings(:populated) > 0 AND
                   embeddings(:populated) reconciles with captured_intents
                   (equal, minus rows with empty intent_text skipped at backfill:102-104).

GUARD:   populated org_id != demo org_id. Resolve both explicitly —
           SELECT id, slug FROM platform_org WHERE slug IN (:populated_slug, 'spinor-demo');
         — and confirm the green row's org_id is the POPULATED id, not spinor-demo passing
         in disguise (Step 0.3 — the empty/wrong-org signature).

FAIL-TO: embeddings(:populated) = 0, OR only the demo org_id appears in the GROUP BY, OR the
         count does not reconcile with captured_intents  ->  PIN-A stays [U]. Nothing that
         assumes "embeddings exist for the real org" may ship as working (Stage-1 topic seeds,
         PIN-B taxonomy, Teach retrieval, Guided starters).
```

#### PIN-B — AVAILABLE now (cred-free design), but gated on PIN-A to *ship as working*

Add domain-type classification (owner / flag / vessel-type / metric) **on top of** the existing
`resolve-intent` resolver ([route.ts:111](../../src/app/api/inspector/semantic/[modelId]/resolve-intent/route.ts#L111)
+ [intent-resolve.ts:76](../../src/lib/dashboards/intent-resolve.ts#L76)), backed by the model's real
distinct-values + synonyms — not a new resolver. Design is buildable now; **amber-ambiguity
representation is defined here** (a term matching >1 domain concept renders amber, never guessed —
mirrors the prototype's amber state and the resolver's existing `ambiguous` bucket). *May not ship as
working until PIN-A is green* — otherwise it just moves the unfalsifiable-ground problem up a layer
(a taxonomy over an empty/wrong-org embedding set classifies against nothing).

### Reconciled remaining spine — inherit state, not a thread

- **BLOCKED (needs creds):** **PIN-A** — the runnable block above. Tracked blocker behind the dark-cred
  gate (same as SEC-4); executes on arrival, no re-derivation.
- **AVAILABLE now (cred-free):**
  - **PIN-B taxonomy DESIGN** — domain-type (owner/flag/vessel-type/metric) layered on the existing
    `resolve-intent` resolver, incl. amber-ambiguity representation. Design now; **do not ship as
    working until PIN-A is green** (else the unfalsifiable-ground problem just moves up a layer).
  - **Spatial Store UI + shelving** — **zero substrate dependency**, buildable anytime as pure
    front-end (prototype [Metric Store (standalone).html](../metric%20store/Metric%20Store%20(standalone).html);
    shelving rule sketched at [metric-store-plan.md:31-36](../metric%20store/metric-store-plan.md#L31)).
- **STANDING (ride along, unchanged):** forward==reverse graduates the day a dashboard widget consumes
  a governed dimension (not before — today it's unit-fixture only, [lineage.test.ts:95](../../src/lib/semantic/__tests__/lineage.test.ts#L95));
  `BOOTSTRAP_CANDIDATE_PCT = 80` ([lineage.ts:484](../../src/lib/semantic/lineage.ts#L484)) recalibrates
  when a real governed estate settles below that ratio.
