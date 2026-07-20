# Teach — Phase 3 notes (read-only typed candidate feed / Build hand-off)

**Date:** 2026-07-20
**Status:** Shipped. Unit checks 1–4 green (22 assertions across 2 files); LIVE check 5
(and the two guardrail proofs) **PASSED** against real Postgres, DEFAULT_ORG; every seeded
row hard-deleted (0 leftover). `tsc --noEmit` clean; eslint clean on all touched files
(`--max-warnings 0`).

Phase 3 shapes Teach's output as a clean, typed, **read-only** hand-off a future Build
thread consumes. Teach captures candidates and stops at the boundary — it does **not**
commit, promote, or write governed memory.

---

## Step 1 — the hand-off contract (reported before building) + the gap that surfaced

### The gap (STOP-and-report, resolved by decision)
The Step-1 pin found that a pure read-only projection of `platform_agent_memory` could
reconstruct **only 4 of the 10 contract fields**. The Reflect loop emits the typed envelope
(`type`, `state`, `verification_result`, `conflict`, `resolution`, session) **only as
transient SSE `learning_item` events** — none of it was persisted. The capture row
([teach.ts:84](../../src/lib/memory/teach.ts#L84)) is a fixed shape: `rule_type` hard-coded
`'SCHEMA_MAP'` (the taxonomy type dropped), `status` always `'ACTIVE'` (no state),
`source_session_ids: []` (no session). Verification comes from a **separate** `verify_claim`
call (shared `SEMANTIC_QUERY_SCHEMA`, own callId — not bound to the learning); resolution
(`resolveConflict`) was **test-only**, never called in the live loop.

So the session-id watch-item was real, but the whole envelope had the same shape of problem.
**Decision (user):** persist the envelope at capture, then project — landed as **two
commits** with a clean read-only boundary (below). This did **not** relax Phase 3's read-only
scope; it reopened a small piece of Phase 2 (capture persists what it emitted).

### The contract — `TeachCandidate` (the interface Build codes against)
Defined in [teach-feed.ts](../../src/lib/inspector/teach-feed.ts):

```ts
interface TeachCandidate {
  id: string;                         // platform_agent_memory.id — the durable id Build references
  type: LearningType;                 // metric_definition | enterprise_convention | estate_navigation | vocabulary_entity | other
  statement: string;                  // rule_text
  state: 'proposed' | 'verified' | 'conflict' | 'resolved';
  verification_result: VerificationResult | null;  // incl. honest not_verifiable (governed-gate) — never fabricated
  conflict: ConflictInfo | null;      // existing-vs-new
  resolution: ConflictResolution | null;            // the recorded choice, or null
  author: string;                     // created_by
  sessionId: string | null;           // the Teach session that captured it; null if unresolved
  capturedAt: string;                 // ISO — captured_at
}
```
`TeachFeed = { candidates, readyCount, conflictCount, total }`.

### The projection query + scoping (read-only, fail-closed)
[getTeachFeed](../../src/lib/inspector/teach-feed.ts) reads the companion table joined to the
memory row:
```
FROM platform_teach_candidate tc JOIN platform_agent_memory m ON m.id = tc.memory_id
WHERE tc.org_id = $org AND tc.author_user_id = $caller
  AND m.status = 'ACTIVE' AND m.visibility = 'personal' AND tc.state <> 'rejected'
ORDER BY tc.captured_at DESC   [AND tc.session_id = $session]
```
- **Fail-closed:** a null/empty `authorUserId` returns an empty feed **without querying** —
  never another user's candidates. Mirrors the Phase-2 personal-lane visibility clause.
- **Rejected excluded:** a rejected candidate's memory row is `SUPERSEDED`, so `status='ACTIVE'`
  excludes it (plus `state <> 'rejected'` belt-and-braces) — the *same* soft-delete that removes
  it from recall.
- **Read-only:** a `$queryRaw` SELECT; no side effects. (Proven live — snapshot unchanged.)

### Ready-count semantics
`readyCount = verified + resolved + proposed` (i.e. `total − conflictCount`). A `conflict`
is **not** ready (awaits the user's resolution); rejected are already excluded. Display state
is derived: `conflict` > `resolved` (resolution recorded) > `verified` > `proposed`.

---

## Two-commit structure & where state/type landed (lane-invariance)

**Commit 1 — capture-shape persistence (Phase-2-adjacent).** New companion table
`platform_teach_candidate` (1:1 with the memory row) holds the envelope. Chosen over columns
on `platform_agent_memory` so the hot retrieval path is left *physically unchanged*:

| Field | Lands in | Lane impact |
|---|---|---|
| `type` | `platform_teach_candidate.learning_type` (additive) | none — `rule_type` stays `'SCHEMA_MAP'` (unchanged) |
| `state` (proposed/verified/conflict) | `platform_teach_candidate.state` | none — memory row stays `status='ACTIVE'` (still injects for its author, as designed) |
| `rejected` | memory row `status='SUPERSEDED'` (existing soft-delete) + `state='rejected'` | intended removal, via the lane's **pre-existing** `status='ACTIVE'` filter |
| `verification` / `conflict` / `resolution` | companion JSONB | none |
| session | `session_id` | none |

Wiring: `sessionId` threaded route→context→capture; `capture_learning` persists the envelope
(best-effort — a persist failure never blocks a capture, C2); `verify_claim` gained an optional
`learningId` via a **new** `VERIFY_CLAIM_SCHEMA` (spreads — never mutates — the shared
`SEMANTIC_QUERY_SCHEMA`) so a verification attaches to its candidate; a resolve **service**
(`resolveCandidateByMemoryId`, reusing the shared `nextStateForResolution`) records the choice
and supersedes on `keep_existing`.

**Lane-invariance evidence (LIVE, proven):** `retrieve()` phase1a is **byte-for-byte identical**
before vs after the companion write. The lane's output changes in exactly one case — a
user-initiated **rejection** removes that user's own rule from their own recall, via the
pre-existing `SUPERSEDED` filter. Every other case is unchanged.

**Commit 2 — the read-only feed + boundary.** `TeachCandidate` contract + `getTeachFeed`
projection, `GET /api/inspector/teach/candidates` (fail-closed auth, reuses `guardInspectorChat`),
and the **Digest** surface ([TeachDigest.tsx](../../src/components/inspector/teach/TeachDigest.tsx)
at `/agent-lab/teach/digest`): candidate list + "ready to hand off" count + an **inert**
"Open in Build →" marker (a handler-less `<span>` — no promote/commit behind it) + boundary copy.

---

## The hand-off boundary IS inert by construction (integrity guarantee)
- **No promote/credit path exists in the Phase-3 surface.** `grep` over `teach-feed.ts`,
  `teach-candidate-store.ts`, the endpoint, and `TeachDigest.tsx` for `promoteRuleToOrg` /
  `creditAuthoringPromotion` / `applyOutcomeForUser` / `evaluatePromotionEligibility` →
  **NONE**. There is no underneath to a flipped flag.
- **The feed reads only.** The only `fetch` in the Digest is the GET feed; the only `onClick`
  is a retry (re-reads). "Open in Build →" carries no handler.
- **Read-only proven live:** two feed reads left every companion + memory row unchanged
  (count / state / status / `updated_at`).

---

## Acceptance checklist

| # | Check | Result |
|---|---|---|
| 1 | Projection: mixed states populate every field; not_verifiable keeps typed state; rejected excluded | **PASS** (unit — teach-feed.test.ts) |
| 2 | Fail-closed scoping: author sees own; different/null user sees NONE | **PASS** (unit + live) |
| 3 | Read-only: feed read mutates no row; no promote/credit invoked | **PASS** (live snapshot + grep) |
| 4 | Ready-count = verified + resolved + proposed | **PASS** (unit + live) |
| 5 | LIVE: teach proposed/verified/conflict, feed projects honestly, cross-user none, zero mutation, hard-delete | **PASS** (live — 20/20) |
| — | Guardrail 1: lane byte-for-byte invariant | **PASS** (live) |
| — | Guardrail 2: reject → gone from feed AND recall | **PASS** (live) |

Unit files: [teach-feed.test.ts](../../src/lib/inspector/__tests__/teach-feed.test.ts) (10),
[reflect-tools.phase3.test.ts](../../src/lib/inspector/__tests__/reflect-tools.phase3.test.ts) (12);
existing reflect-tools suites still green (no regression).

---

## No write/promote/credit path was touched
Phase 3's feed is strictly read-only. Commit 1's capture-shape writes are additive
persistence of what the loop already emitted — **no** promote, **no** reputation credit, **no**
governed-memory write anywhere in this phase. Reputation still fires only when **Build**
promotes (a future thread).

## Watch-items carried to Build
- **Build's scope:** review/resolve UI over conflicts, org promotion via the existing gate
  (`promoteRuleToOrg` + `creditAuthoringPromotion` **at promote-time**), commit/curation. The
  resolve **service** (`resolveCandidateByMemoryId`) exists for Build/Phase-4 to wrap in an
  endpoint/UI; Phase 3 exercised it only to prove reject→gone.
- **Verification attach is LLM-reliant:** `verify_claim` attaches only when Marcus passes the
  `learningId` the prompt instructs. No id → advisory-only, nothing persisted (no
  misattribution). A deterministic capture↔verify binding is a Phase-4 option.
- **Single-org `getDefaultOrg` → `DEFAULT_ORG_ID`** (column-tenancy only) — unchanged.
- **Conflict detector** remains precision-first/deterministic (Phase-2 follow-up); the feed
  reflects detected conflicts, it does not improve detection.
- **Migration** `20260720_teach_candidate` is the schema of record; applied live via
  `prisma db execute` (idempotent `IF NOT EXISTS`).

## Files
| File | Change |
|---|---|
| [prisma/migrations/20260720_teach_candidate/migration.sql](../../prisma/migrations/20260720_teach_candidate/migration.sql) | companion table + indexes |
| [prisma/schema.prisma](../../prisma/schema.prisma) | `PlatformTeachCandidate` model |
| [src/lib/inspector/teach-candidate-store.ts](../../src/lib/inspector/teach-candidate-store.ts) | persist / attach / resolve writers (server-only) |
| [src/lib/inspector/teach-feed.ts](../../src/lib/inspector/teach-feed.ts) | `TeachCandidate` contract + read-only projection |
| [src/lib/inspector/reflect-tools.ts](../../src/lib/inspector/reflect-tools.ts) | sessionId ctx, persist/attach deps, `VERIFY_CLAIM_SCHEMA` + learningId, `nextStateForResolution` |
| [src/lib/inspector/reflect-prompt.ts](../../src/lib/inspector/reflect-prompt.ts) | instruct passing `learningId` on verify |
| [src/app/api/inspector/teach/route.ts](../../src/app/api/inspector/teach/route.ts) | thread `sessionId` into the tool context |
| [src/app/api/inspector/teach/candidates/route.ts](../../src/app/api/inspector/teach/candidates/route.ts) | read-only feed endpoint |
| [src/components/inspector/teach/TeachDigest.tsx](../../src/components/inspector/teach/TeachDigest.tsx) | Digest surface + inert hand-off boundary |
| [src/app/(agent)/agent-lab/teach/digest/page.tsx](../../src/app/(agent)/agent-lab/teach/digest/page.tsx) | Digest page |
