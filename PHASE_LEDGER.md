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
  When restoring the real 724-line `queue.ts` in Phase 4: it is a **pure file
  replacement with zero type delta**. **Verify no type errors after the swap — if
  the swap produces type errors, the Phase 3 stub signatures drifted from source**
  and must be reconciled. Restoring the real file also pulls in `@aws-sdk/client-ecs`
  (not added in Phase 3).

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
