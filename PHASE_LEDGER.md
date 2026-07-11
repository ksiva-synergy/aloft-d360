# Port Ledger — deferred / annotated items

Tracks work intentionally deferred to a later phase, and annotations against the
loaded port plan. Created during Phase 3 (Memory / FOER port).

---

## Phase 4 (Data Estate) — must-do

- **Restore real `src/lib/context/queue.ts`; remove the Phase 3 stub.**
  Phase 3 shipped a stub `queue.ts` exporting `enqueue`/`finalize` as throwing
  no-ops (`throw new Error('context queue not available until Phase 4 (Data Estate)')`),
  with `JobKind`/`TriggerKind` and both signatures copied verbatim from source so
  the stub is contract-identical to the real file. Memory only exercises
  `embed.ts`'s `embedQuery()` path, which never touches the queue, so the stub is
  never hit at runtime on Memory's paths.
  When restoring the real 724-line `queue.ts` in Phase 4 it also pulls in
  `@aws-sdk/client-ecs` (not added in Phase 3; added pinned to source's resolved
  `3.1045.0`, no caret).

  **Step 0 queue.ts swap verified: byte-identical to source (md5 match), no
  signature-type (TS2xxx) errors — stub signatures did NOT drift. The two TS2307
  'Cannot find module' errors (./silo, ./mapping) are the real queue.ts's own
  context/ sibling dependencies, invisible to a signature-level stub, and are
  resolved by the Step 1 context/ bulk copy — not a defect.**

- **Step 1 bulk copy — DONE, build green (exit 0).** Copied verbatim (byte-parity
  verified): `src/lib/context/` (31 files), `src/lib/databricks/` (6),
  `src/app/api/agent-lab/context/` (44 routes), `src/components/estate/` (48),
  `src/app/(agent)/agent-lab/estate/` (9). All 20 dynamic bracket routes
  hash-verified identical to source; `next build` compiles + type-checks + lints
  clean, 19/19 static pages. 8 new npm deps added pinned (no caret):
  `@aws-sdk/client-cloudwatch-logs@3.1068.0`, `@aws-sdk/client-secrets-manager@3.1063.0`,
  `@xyflow/react@12.10.2`, `cron-parser@5.5.0`, `dagre@0.8.5` (+ `@types/dagre@0.7.54` dev),
  `sonner@2.0.7`, `uuid@14.0.0`, `minimatch@3.1.5`.
  - **`uuid@14` added WITHOUT `@types/uuid`.** uuid@14 ships its own types
    (`"types": "./dist/index.d.ts"`); source's `@types/uuid@9` is a stale-major
    mismatch — deliberately omitted, build confirms TS is happy. Do NOT re-add it.
  - **`minimatch@3.1.5` declared EXPLICITLY in d360 — this improves on a verbatim
    copy.** A Phase 4 file imports `minimatch`, but it is **undeclared even in
    source's package.json** (source resolves it only via a hoisted transitive
    copy). Copying that verbatim would make d360 strictly more fragile than source
    (a lockfile regen / hoist change could vanish it). Declared explicitly at the
    version source currently resolves. **This is a real latent bug in SOURCE —
    flag upstream to the source repo owners to declare it there.**

- **VERIFIED-vs-UNVERIFIED split (read this before trusting "Phase 4: green").**
  **Phase 4 read paths live-verified (estate browse / Aurora); Databricks-execute,
  ECS-dispatch, CloudWatch, Secrets Manager compile-green but UNVERIFIED pending
  creds/cluster.** Green here means "Data Estate compiles and its routes resolve,"
  NOT "the harvest pipeline runs." The build proved 138 files typecheck + 19 static
  pages generate; it did NOT exercise the credentialed paths, which are the feature's
  core value and a large surface:
  - **Live-verified (read half):** `listEstateObjects`-equivalent read against real
    Aurora returned real data — org `spinor-demo`, 2 sources, 2,323
    `platform_context_objects`, 17,214 `platform_estate_objects`, sample rows
    `lifecycle=active`. Read layer (Prisma → Aurora) is wired, not just compiled.
    (`@xyflow/react/dist/style.css` side-effect import resolved in the production
    build; a visual eyeball of the dagre+xyflow relationship graph is deferred to
    the credentialed pass since it's auth-gated and needs harvested link data.)
  - **Compile-green but DARK (need creds/cluster):** Databricks execute
    (`databricks/execute.ts`, `token-client.ts`), ECS Fargate dispatch
    (`queue.ts` / `dispatch.ts` with the real `ECSClient`), CloudWatch Logs,
    Secrets Manager. These get a REAL verification gate (not a formality) when creds
    are provisioned — likely alongside **Phase 5**, which shares the Databricks
    connection. Do NOT read "Phase 4 committed" as "the write/harvest/dispatch
    pipeline works."

- **Phase 4 pre-seeded three PARTIAL subtrees that later phases own. Each later
  phase's blast-radius audit MUST treat these files as bucket B (already present),
  confirm byte-match, and NOT re-copy / fork them** (same shape as Phase 3 creating
  `context/embed.ts` which Phase 4 reused):
  - **`src/lib/semantic/governance.ts`** — semantic layer is **Phase 5** territory.
    Phase 4 created `src/lib/semantic/` with this ONE file (leaf: cuid2 +
    @prisma/client + @/lib/db, all present; only `writeAuditRow` used, by 2 context
    routes). **Phase 5 must treat governance.ts as present, confirm byte-match, not
    fork**, and copy the other 6 semantic/ files (compiler, context-builder, errors,
    execute, metric-views, types).
  - **`src/lib/knowledge/` (2 of 8 files)** — copied only `chunker.ts` (zero-import
    leaf) + `embed.ts` (leaf, only dep is @aws-sdk/client-bedrock-runtime, present).
    The other 6 (bindings, data-scoring, health, scoring-api, scoring, sources) were
    NOT copied. **NB: `knowledge/embed.ts` is a DISTINCT module from `context/embed.ts`**
    — disjoint exports (`embedText`/`embeddingToSql` vs `embedQuery`/`runEmbedJob`);
    they must never be merged.
  - **`infra/context/eventbridge-rule.json` (1 of 4 files)** — FIRST file copied
    outside `src/`. Repo-root path preserved (schedules.ts imports it via
    `../../../infra/context/...`). The other 3 (`deploy-notes.md`,
    `secrets-policy.json`, `task-definition.json`) are NOT referenced by Phase 4 and
    were left. **`infra/` is now a tree this migration touches — audit it in future
    phases, don't assume everything lives under `src/`.**

---

## SECURITY — now, not Phase 6

- **`vercel_token` live secret in `.env.local`.** Verified **not in any d360 git
  commit** (untracked, gitignored via `.env*`, 0 commits touch the path, 0 commits
  contain the token via `-S` pickaxe). But it sits in plaintext on disk in a new
  repo → **rotate the token** (flag to the Vercel account owner) and redact the
  on-disk value. History is clean; exposure surface is the on-disk plaintext.

- **Second live-secret set (Phase 5 gate): Azure OpenAI / Foundry / Bedrock-Mantle
  / Databricks credentials in `.env.local`.** Populated on disk to run the Phase-5
  three-link live gate (same exposure class as the Vercel token: gitignored via
  `.env*`, untracked, absent from `git status` — verified pre-commit). There are
  now **two** live-secret concerns in this repo: (1) the Vercel token (open since
  Phase 3) and (2) this Azure/Databricks/Mantle set. Treat both as **rotate-aware**
  if this repo is ever shared — the Databricks M2M client secret and AWS keys reach
  real production data (Link 1 hit a live warehouse). No secret value is in git
  history; exposure is on-disk plaintext only.
  - **Note:** the Azure OpenAI (`resource1`) and Foundry (`resource2`) API keys
    currently on disk are **rejected (401)** by both endpoints — likely stale /
    rotated / wrong-resource. Not a blocker (Bedrock is the default path) but worth
    refreshing before the Foundry/Azure model options are relied on.

## Phase 6 — env cleanup

- **`BEDROCK_REGION` duplicated in `.env.local`** (quoted `"us-east-1"` + unquoted
  `us-east-1`), pre-existing from an earlier phase. dotenv last-wins resolves it,
  but it bites when someone edits the wrong line. Dedup during Phase 6 env cleanup
  (alongside the token rotation above). Do NOT fix mid-phase.
- **`BEDROCK_REGION` is inert for the embed path.** `embed.ts::getBedrockClient()`
  **hardcodes** `region: 'us-east-1'` and does not read `BEDROCK_REGION` — noting so
  no one assumes editing that var reroutes embeddings.
- **`BEDROCK_SONNET_MODEL_ID` still blank.** Not needed for `embedQuery` (Titan,
  hardcoded), but Memory's synthesis LLM path (Sonnet) will need it filled before
  synthesis works end-to-end.

## Phase 6 — inherited debt (do NOT fix earlier)

- **Sync `params` in 2 Memory API routes** — inherited verbatim from source
  (source uses the same sync pattern, confirmed):
  - `src/app/api/agent-lab/memory/[id]/route.ts` — `{ params }: { params: { id: string } }`, `const { id } = params;`
  - `src/app/api/agent-lab/memory/[id]/curate/route.ts` — same sync pattern
  The other two dynamic routes (`runs/[id]`, `trace/[id]`) already use the async
  Next 15 pattern (`params: Promise<...>` + `await`). Build passes clean under
  Next 15.5.20 regardless. This is source-side inconsistency, not introduced by
  the copy — leave as-is until the Phase 6 sweep.

---

## Phase 3 — annotations against the plan

- **Route count: plan said 16, source has 15.** `find` over
  `src/app/api/agent-lab/memory` returns exactly 15 `route.ts` files and zero
  other files. Verified against source *file count* (not route table). Plan
  miscounted; not a silent drop. All 4 bracket routes hash-verified in d360.
- **marcus allowlist widened dal.ts → dal.ts + types.ts.** `types.ts` (41 lines,
  zod-only, type-only) is `dal.ts`'s type companion, not the marcus feature.
- **construction: single leaf only.** Copied `constructionState.ts` (79 lines,
  zod-only, type-only) — the one file `retrieve.ts` imports. The other 6 files +
  `__tests__` in source `src/lib/construction/` were NOT copied.
- **Companion deps not directly imported by a Phase 3 file but build-required
  (added anyway, present in source):** `echarts@6.1.0` (value-imported by
  `echarts-for-react`) and `@types/pg@8.20.0` (`pg` bundles no types).
- **Vector path functionally verified.** Ran one real `embedQuery`-equivalent
  `callTitan` call against live Bedrock (Titan v2, `us-east-1`, d360 creds) →
  returned a 1024-dim vector. This commit is not merely compile-green; the first
  Bedrock integration is confirmed working. (Synthesis/Sonnet path NOT yet
  live-tested — see `BEDROCK_SONNET_MODEL_ID` above.)

## Lessons

- **Leaf-copy approvals must confirm the leaf's own imports are satisfiable in
  d360 at approval time — not defer that to the phase build.** In the A/C step,
  `marcus/types.ts` and `construction/constructionState.ts` were approved as safe
  leaves because "imports only zod" — but `zod` was absent from d360 until this
  phase added it. So those leaves could not have type-checked at approval time;
  "cmp byte-identical" verified *file identity*, not *compile validity*. The files
  are fine now (build green), but the gates are different: a leaf that imports X
  isn't self-proving until X exists in the destination.

---

## Phase 5 (Inspector / Boost / Studio / Semantic / Dashboards) — annotations

### Sole sanctioned verbatim-deviation: `src/hooks/useInspectorChat.ts`

The migration's ONE intentional edit-not-copy. Every other Phase-5 file is
byte-identical to source. A future diff vs source WILL flag this file — it is
**intentional, not drift**.

**What changed** — removed the vestigial `useWorkbenchChat` coupling:
- Removed L4 value-import `import { useWorkbenchChat } from '@/components/agent-lab/workbench/useWorkbenchChat'`.
- `WorkbenchMessage` (type) + `AVAILABLE_MODELS` (value) still sourced from
  `@/components/agent-lab/workbench/types` (L4-5 after cut) — unchanged.
- Removed `const wb = useWorkbenchChat({ sessionId, artifactType: 'agent' })`.
- `sessionIdRef` init changed `wb.sessionId` → `sessionId` (prop) — identical initial value.
- Sync effect `sessionIdRef.current = wb.sessionId` → `= currentSessionId`, and
  **relocated below** the `currentSessionId` useState declaration (was above it →
  would have been a TDZ ReferenceError; the original only worked because it read
  the external `wb`, not inspector's own state).
- Dropped the two `wb.setSelectedModel(...)` calls (the L98 effect and the one in
  `handleModelChange`) — write-only sinks whose value inspector never reads back
  (inspector drives everything off its own `previewModel`). `handleModelChange`
  dep array `[wb]` → `[]`.

**Why** — D1 trace proved inspector's chat engine (its own `doSend` →
`fetch('/api/inspector/chat')` + SSE loop + local `localMessages`/`isStreaming`
state) is entirely self-contained; `useWorkbenchChat` was reached only for
`wb.sessionId` (a value inspector already shadows via `currentSessionId`) and
`wb.setSelectedModel` (a dead sink). Copying it verbatim would have dragged ~14
agent-lab/construction files (`useWorkbenchChat` → `useAgentChat`,
`artifactDraftSchemas`, `interaction-buffer/-types`, + the construction value-tree
`assumptionHelpers`/`buildPersona`) — re-importing exactly the subtree five phases
of pruning removed. Behavior is preserved exactly; build + lint green.

### Escape-scan finding the lib-audit missed (resolved, not deferred)

The D1-D5 lib-audit traced `useInspectorChat.ts` + the lib trees exhaustively but
did **not** trace `components/inspector/InspectorShell.tsx`, which value-imports
three UI components from `components/workbench/`. A pre-build `@/`-scan across all
114 Phase-5 files caught it. Full second-level closure proved **bounded**: 12
resolution files, all terminating in already-present d360 files + already-present
npm (`framer-motion`, `lucide-react`) — zero new lib subtree, zero new deps:
- `lib/agent-lab/artifactDraftSchemas.ts` (zod-only leaf; required by the type-only
  imports in the copied `agent-lab/workbench/types.ts`).
- `lib/construction/assumptionHelpers.ts` (type-only reach to the present
  `constructionState.ts`; does NOT drag buildPersona/computeCompleteness/etc.).
- 10 × `components/workbench/*` (see partial-slice below).

Post-fix full re-scan: **0 unresolved `@/` targets across all 114 files.** No third
entry point has an unmapped workbench/agent-lab/construction/marcus-lib reach.

### Partial-slice directory: `src/components/workbench/` = 10 of 29 source files

Copied (inspector-reachable closure — treat as complete, NOT partial-by-omission):
`PromptCanvas`, `StreamingMessage`, `InputComposer`, `AssumptionChip`,
`ClassSuggestionChip`, `HistoryDrawer`, `atoms`, `marcus/{useReflections,
ReflectionCard, DismissedReflection}`.

**The other 19 are DELIBERATELY absent** — future audits treat this dir as an
intentional bounded slice, not an incomplete copy: `AuditGateBanner`,
`CommissionDock`, `ConfigPanel`, `ConstructionCanvas`, `GuidedMode`, `IngestPanel`,
`NLMode`, `ObserverPanel`, `RunResultCard`, `StatusBar`, `WorkbenchShell`,
`guided/{GuidedShell, Step00Lens, Step01Prompt, Step02Tools, Step03Memory,
Step04Review}`, `marcus/ReviewPanel`, `useWorkbenchTokens`.

### Other Phase-5 notes

- **`lib/studio/` = 13 files, not 12 (plan estimate).** `__tests__/` (2) +
  `chart-dsl.schema.json` + 10 × `.ts`. Full dir copied; settled against source
  file count.
- **`components/agent-lab/workbench/types.ts` path correction.** Plan said
  `components/workbench/types.ts` — that file does not exist in source. The audited
  leaf is `components/agent-lab/workbench/types.ts` (the exact path
  `useInspectorChat` L4-5 import). Copied there.
- **`governance.ts` (Phase-4 pre-seed) untouched** — still
  `df33321a85d4dd8291de7a2a68c3afbc`, byte-identical, not overwritten by the
  semantic 6-file copy.
- **`@resvg/resvg-js@2.6.2` native binary verified** — not just install exit 0: a
  trivial `new Resvg(...).render().asPng()` produced a valid 95-byte PNG
  (`win32-x64-msvc` binary loads on Windows).
- **7 deps pinned exact (no caret):** `zustand@4.5.0`, `immer@10.0.3`,
  `@tanstack/react-virtual@3.13.23`, `ajv@8.20.0`, `@resvg/resvg-js@2.6.2`,
  `openai@6.39.1`, `react-grid-layout@2.2.3` (self-typed, NO `@types`). All present
  in source's package.json (as caret ranges); none is a source-missing dep.
- **Env: 6 of 7 keys already present**; appended only `FOUNDRY_TOOL_TIMEOUT_MS=`
  (BLANK). All 7 remain blank placeholders — live-cred gate NOT run.
- **Compile-green reached; NOT committed, live gate NOT run.** `npm run build` →
  Compiled successfully, exit 0. `npm run lint` → clean, exit 0 (`--max-warnings 0`).

### Deferred to a later phase / live-gate

- **Runtime (not compile) dependency:** `components/workbench/marcus/useReflections`
  fetches `/api/agent-lab/marcus/reflections{,/[id]}` at runtime (live in inspector
  — the hook is called unconditionally). Route presence is a runtime concern, not a
  build blocker; verify when the live gate runs.
- **Sync `params` and other inherited-verbatim source patterns** across the copied
  inspector/databricks routes are source-side debt, not copy-introduced.

---

## Phase 5 — three-link live gate (credentialed, run as its own step)

Compile-green is the weakest proxy for "works" in Phase 5: the whole feature is
the credentialed path, which compiles fine with blank env and does nothing. So the
commit gate was a live chain, run link-by-link in dependency order with real creds.

**Link 1 — Databricks query (Phase 4's dark path). 🟢 GREEN.** Drove the *real*
`executeDatabricksSQL` (import-free Phase-4 module) with an M2M token minted exactly
as `token-client.fetchToken` does. `SELECT current_catalog(), current_user(), 1+1`
→ `row_count=1`, `catalog=hive_metastore`, real service-principal identity, real
36-char `statement_id`. OAuth M2M ✅ · warehouse compute ✅ · read-only enforcement
✅ · result parse ✅. **This retroactively verifies the Phase 4 Databricks execute
path** — Phase 4 committed it compile-green-only; inspector is its first real
consumer and this is the first live query through it.

**Link 2 — inspector agent-loop completion. 🟢 GREEN (with a documented asymmetry).**
Drove the *real* `dispatchAgentLoop`. Inspector's DEFAULT model is `sonnet-4-6`
(Bedrock converse). Both `sonnet-4-6` and `haiku-4-5` completed a real turn:
`outcome=completed`, real token usage (in≈37/out=8), streamed the exact requested
token back. Loop wiring + send path (the code the refactor left byte-identical)
confirmed intact via a real completion.
  - **Dark (cred-blocked, wiring-proven):** the Foundry / Azure-OpenAI sub-path
    (`gpt-5-4`/resource1 = Azure OpenAI; `grok-4-3`/`kimi-k2-6`/`deepseek-v4`/
    resource2 = Foundry) — every model made a *real* HTTP round-trip to Azure
    (correct URL/headers/api-version) and got a genuine **401** (keys on disk
    rejected). The provider wiring, openai-SDK transport, and endpoint resolution
    are proven; only a live *completion* through Azure is unverified, pending valid
    keys. Same asymmetry discipline as Phase 4: wired ≠ completion-verified.

**Link 3 — chart pipeline end-to-end. 🟢 GREEN.** `emitChartSpec` (real Bedrock
sonnet-4-6) produced a `ChartDSLSpec` (kind=bar, title "Monthly Revenue") from a
synthetic result set → `renderSpecToPng` compiled it (studio compiler) → echarts SSR
→ resvg rasterized a valid **23,064-byte PNG**. Full agent→pipeline→studio→resvg
chain live.

### Findings the live gate caught that compile-green hid

1. **`assets/fonts/{ibm-plex-mono-400.ttf, inter-tight-400.ttf}` were MISSING.**
   `ssr-render.ts` has a module-load-time guard that throws if these fonts are
   absent at `process.cwd()/assets/fonts`. The Phase-5 copy was `src/`-only and
   missed these git-tracked binary assets. **Build stayed green** because the guard
   runs at runtime (server-only module), not during `next build`. **Added** (both
   byte-identical to source). Any SSR chart-PNG path (digest, chart export) would
   have thrown at runtime without them.

2. **`FOUNDRY_TOOL_TIMEOUT_MS=` blank line was actively harmful.** Appending it
   blank (per the env step) set it to empty-string; the code reads
   `parseInt(process.env.FOUNDRY_TOOL_TIMEOUT_MS ?? '45000')` — `??` catches
   null/undefined but **not `""`** — so it became `parseInt('')` = `NaN` → instant
   timeout on the Foundry path. **A blank placeholder there is worse than absent.**
   Removed the line so the code's own `'45000'` default applies (correct for both
   the gate and real runtime). Lesson: never blank-append an env var whose code
   default is guarded by `??`.

### Coverage honesty — what "Phase 5 committed green" does and does NOT mean

The three links prove the credentialed *paths* work (Databricks execute, agent-loop
completion via Bedrock, chart emit→render). They do **NOT** verify every inspector
surface. Explicitly NOT exercised by this gate:
- **Foundry/Azure-OpenAI model completions** — 401, cred-dark (above).
- **`useReflections` marcus-API path** (`/api/agent-lab/marcus/reflections`) — live
  in inspector at runtime but not driven here.
- **Dashboard-builder persistence** (versions/share/collaborators routes + DB).
- **Semantic layer** (`runSemanticChartPipeline`, semantic execute against
  Databricks, governance/promote/review routes).
- **The 22 inspector API routes end-to-end** (auth + DB + SSE) — only the lib
  functions beneath chat/boost/chart were driven directly.
These are separate surfaces; "gate green" ≠ "all of inspector verified."
