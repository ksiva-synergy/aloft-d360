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
