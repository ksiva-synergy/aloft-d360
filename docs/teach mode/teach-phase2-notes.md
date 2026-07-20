# Teach — Phase 2 notes (Retrieve · Verify · Conflict)

**Date:** 2026-07-20
**Status:** Shipped. Units 1–4 green (39 assertions across 3 files); LIVE checks 5 (recall→prompt)
and 6 (governed + candidate verify) **both PASSED** against real Postgres + Databricks + Bedrock,
DEFAULT_ORG; every written row hard-deleted (0 leftover). `tsc --noEmit` clean project-wide;
eslint clean on all touched files (`--max-warnings 0`).

Phase 2 puts real logic behind the Phase-1 seams: the retrieve fix that ends the taught-rule
starvation, conflict detection at capture, and verification wired onto the learning-card state
machine. It **reuses** the existing engines (`retrieve.ts`, `teach.ts`, `executeSemanticQuery`) —
no forks.

---

## Step 1 — the retrieve fix: blast-radius decision + Inspector-invariance evidence

### Decision: Option (a) — an additive personal-taught lane (the recommended starting point)

Callers of `retrieve.ts` retrieval:

| Caller | Passes `callerUserId`? | Notes |
|---|---|---|
| `api/inspector/chat/route.ts:220` — **the product surface** | yes (session; `null` if unresolved) | phase0+1a → system prompt; 1b → recall turn |
| `reflect-tools.ts` `defaultRecall` — **Teach recall** | yes | flattens phases → `RelatedMemoryHit[]` |
| `boost/runner.ts:111` — eval harness | **no** → `NO_USER_SENTINEL` | legacy `selectMemory` |
| `agent-lab/memory/canary-status` | — | imports `isFullPoolEnabled` only, not retrieval |
| `MountPanel.tsx` | — | client preview, never calls `selectMemory` |

The starvation (pre-existing, confirmed live in 142a020): `selectPhase1a` orders SCHEMA_MAP by
`confidence × GREATEST(helpful−harmful, 0) DESC LIMIT 10`. A fresh bullet scores 0
(`helpful_count=0`) and is truncated below the cap in any mature org (DEFAULT_ORG: 149 bullets,
10 net-positive fill every slot). The taught rule sits in the table, never in the prompt.

Option (a) — [`appendPersonalTaughtLane`](../../src/lib/memory/retrieve.ts) — runs a **second**,
recency-ordered, sub-capped, sub-budgeted query for the caller's **own** personal SCHEMA_MAP rows
and **appends** them (deduped) to the unchanged net-helpful set. Chosen over (b) recency-tiebreaker
and (c) relaxed-cap because those reorder/regrow the result for **every** caller — including the
shared org-visible set Inspector renders, which would trip the STOP condition. (a) touches nothing
the shared set sees.

### Why the STOP condition is NOT tripped (Inspector-invariance)

The lane changes a **non-personal caller's** output in zero cases:

- **Caller = `NO_USER_SENTINEL`** (boost, unresolved Inspector): the lane query is **not issued** —
  code path byte-identical. (unit: "sentinel never issues the lane query")
- **Caller resolved, zero personal rows** (the "non-personal caller" fixture of acceptance check 2):
  lane returns `[]` → append is a no-op → **same bullets, same order, same count**. (unit asserts
  deep-equal to the sentinel baseline)
- The net-helpful set is computed **first** and never reordered/evicted; the lane only **appends**
  novel ids (dedup by id).

**Max bullet count / budget.** Shared set stays at `PHASE_TIER1_CAP[SCHEMA_GLOBAL]=10` on the
main 600-token budget. The lane adds **≤5** rows on its **own** ~400-token sub-budget
(`MEMORY_PERSONAL_LANE_BUDGET`), never the shared 600 — so the net-helpful set is never squeezed.
Non-personal caller: **10 max, unchanged.** Personal caller: **≤15**, the extras being that user's
own taught rules. Fail-closed holds inside the lane (`visibility='personal' AND created_by=$caller`
— never an org row or another user's personal rule).

### The one judgment call (flagged, proceeded)

Because Inspector also passes `callerUserId` (3.5D built that so a user's own personal rules inject),
fixing the starvation means **an Inspector user who taught a rule now sees it injected in Inspector**
— which is 3.5D working as designed, not new behavior; the **shared org-visible set is untouched**.
Treated as in-scope for (a). If any additive injection into the Inspector prompt is deemed a
main-surface change needing sign-off, this is the point to veto — otherwise it stands.

### LIVE check 5 — captured → recalled → IN THE ASSEMBLED PROMPT (PASS)

Real PG + Bedrock, DEFAULT_ORG. Taught one personal rule for `__phase2_live_author__`, then a fresh
retrieve:

```
author:  phase1aCount=11  inRetrieve=true   inPrompt=true    (10 net-positive org + the lane's 1)
other:   phase1aCount=10  inRetrieve=false  inPrompt=false   (fail-closed: absent)
```

`inPrompt` = the marker text appears in `formatForInjection(phase1a, SCHEMA_GLOBAL)` — the exact
transform `chat/route.ts` appends to `finalSystemPrompt`, not merely a `retrieve()` return. Row
hard-deleted (0 leftover).

### teach.ts header correction

The module header's claim that a null-signature SCHEMA_MAP "reliably applies for everyone" was
**falsified** by the live run and is now corrected on two counts: (1) not "for everyone" — it is a
**personal** rule until `promoteRuleToOrg`; (2) not "reliably" — the net-helpful ranking starved it
until the lane. The header now points at `appendPersonalTaughtLane`.

---

## Step 2 — Conflict (detection + resolution capture; no governed write)

Detection runs **inside `capture_learning`**, downstream of the Step-1 fix (the personal lane is why
recall now sees the caller's own recent teachings at all):

1. capture writes the rule (unchanged) — **capture is never blocked** (C2).
2. recall the caller's memory for the new statement; **exclude the just-written id** (so a learning
   never conflicts with itself); populate `related_memory_hits`.
3. `detectConflict(statement, hits)` → on contradiction the learning is emitted `state='conflict'`
   with the `conflict` field populated. **The memory row still stands** — conflict only colours the
   card; it does not un-write the capture.

Recall/detect are wrapped so a transient failure can never sink a successful capture (advisory).

### Conflict field shape (aligns with the Phase-1 `ConflictInfo` seam / Phase-4 side-by-side)

```ts
interface ConflictInfo {
  existingMemoryId: string;   // the contradicting prior rule (platform_agent_memory id)
  existingStatement: string;  // its text — the "existing" side of the resolver
  note?: string;              // why they contradict, e.g. "same subject, differing month (january → april)"
}
// learning.state = 'conflict'; learning.related_memory_hits = the recalled set (minus self)
```

### The detector (injectable; deterministic default)

`ReflectToolDeps.detectConflict` is injectable (a future LLM-backed detector drops in without
touching the dispatcher). The **default** `defaultDetectConflict` is a **precision-oriented**
deterministic heuristic (`detectStatementConflict`): it fires only when the two statements clearly
share a subject (content-word overlap ≥ 0.4) **and** disagree on a decisive token — a differing
month, a differing assignment value (`status='A'` vs `status='ACTIVE'`), a differing standalone
number, or a negation/exclusion flip. Precision over recall by design: a missed conflict is caught
later at Build review; a false conflict wrongly stalls a capture-advance.

### Resolution capture — `resolveConflict` (no promotion, no auto-supersede)

A pure state transition + recorded outcome; **nothing is written to governed memory** (Build commits
later):

- `keep_new` / `scope_by_context` → learning advances out of `conflict` to `proposed`
  (`scope_by_context` records the disambiguating `scopeNote`).
- `keep_existing` → the new learning is `rejected` (the user kept the prior rule).

Returns `{ learning, resolution: { choice, scopeNote?, resolvedAt } }`. Reputation timing is
untouched (no credit anywhere on this path).

---

## Step 3 — Verify (advisory; the environment gate; live governed + candidate)

`verify_claim` already executed via `executeSemanticQuery` (Phase 1 wired it). Phase 2 adds the
**learning state-machine linkage**: `learningStateForVerification` maps a result onto the card —
**only `confirmed` → `verified`**; `unconfirmed` (0-row) and `not_verifiable`
(ungoverned/model-not-found/no-connection) stay `proposed` (honest, advisory, promotable-later per
the shared verification-tiering rule). The mapping rides on the existing `verification_result` event
as an additive `learningState` field — the shared `SEMANTIC_QUERY_SCHEMA` (also used by Inspector's
`emit_semantic_chart`) is **not** touched.

### ENVIRONMENT GATE — RESOLVED: YES, exercisable (a reversal of Phase 1)

Phase 1 could only hit *model-not-found* because DEFAULT_ORG had zero semantic models. **That has
changed.** DEFAULT_ORG now has **1 governed model** (`shdzdz8qrhxjwzkpkislsitz`) and **2 working
Databricks connections**. The model is `governed` while its fields are `candidate`; on the default
path `decideDefinitionAccess` allows `candidate` (authoring-access.ts:53), so confirmed governed
results are obtainable. Recorded in memory `teach-phase2-governed-verify-live`.

### LIVE check 6 — one governed + one candidate verify (PASS), through the real reflect-tools path

```
[GOVERNED]  state=confirmed       learningState=verified   rowCount=1
            (Date Dimension → MAX(days_in_month); ~4s)
[CANDIDATE] state=not_verifiable  learningState=proposed
            reason="Semantic model '…' has status 'candidate' — only governed…"
[CAPTURE]   ok=true  state=proposed   (capture UNBLOCKED under the ungoverned verify)
cleanup: leftover candidate-model=0  leftover captured-memory=0
```

The candidate case exercised the **real `SemanticModelNotGovernedError`** — the exact path Phase 1
could not reach — surfaced as a typed `not_verifiable`, no 500, capture unblocked. Seeded candidate
model + captured row hard-deleted.

---

## Acceptance checklist

| # | Check | Result |
|---|---|---|
| 1 | Retrieve fix: caller's fresh rule returned; other user none | **PASS** (unit) |
| 2 | Inspector-path invariance (fixture: same bullets/order/count) | **PASS** (unit) |
| 3 | Conflict state + field populated; non-contradicting doesn't; resolution records choice, nothing promoted | **PASS** (unit) |
| 4 | Verify: governed→verified; candidate→typed not-governed no-throw capture-unblocked; model-not-found→typed | **PASS** (unit) |
| 5 | LIVE captured→recalled→in assembled prompt (author), absent (other) | **PASS** (live) |
| 6 | LIVE one governed verify + one candidate-model verify | **PASS** (live) |

---

## Watch-items that bit

- **`server-only` throws under plain node** (not just vitest): tsx compiles `src/*.ts` to CJS, so a
  live harness importing `retrieve.ts`/`teach.ts`/`execute.ts` needs a `Module._load` shim for
  `server-only` (`--require ./_so-cjs.cjs`). The ESM resolve-hook approach does NOT cover the CJS
  `require`. Harness only; not committed.
- **Assignment-token overlap dilution** (unit caught, pre-live): `status='a'` and `status='active'`
  were counted as distinct content words, dropping subject overlap below threshold so the value
  contradiction was missed. Fixed by stripping the `=value` suffix for the overlap computation and
  judging the value separately.
- **CrewNC verify times out at ~51s** (`Query CANCELED`): the sync executor uses
  `on_wait_timeout=CANCEL` (≤50s); a big table cancels. Not a path failure — pick a small table
  (Date Dimension) for a live verify smoke check.

## Watch-items noted, not fixed (carried forward)
- Single-org `getDefaultOrg` → `DEFAULT_ORG_ID` (column-tenancy only).
- SYNONYM injection is a **separate** dead-thing path (governed + top-K(10) entities in
  `buildSemanticPromptSection`) — NOT the SCHEMA_MAP ranking this phase fixed. If a taught vocab term
  seems not to inject, suspect that path, not `retrieve.ts`.
- `MEMORY_INJECT_ENABLED` + rule-type gating must stay on / injecting type for live runs.
- Conflict default detector is precision-oriented (deterministic). Raising recall (LLM-backed) is a
  clean drop-in via the injected `detectConflict` seam — a follow-up, not built here.
- verify-before-capture (C2) remains undecided-but-defaulted-open; flag if product wants a gate.

## Files
| File | Change |
|---|---|
| [src/lib/memory/retrieve.ts](../../src/lib/memory/retrieve.ts) | `appendPersonalTaughtLane` (Step-1 fix) + constants |
| [src/lib/memory/teach.ts](../../src/lib/memory/teach.ts) | corrected falsified module-header claim |
| [src/lib/inspector/reflect-tools.ts](../../src/lib/inspector/reflect-tools.ts) | conflict detection + resolution + verify→state; `detectConflict` dep |
| [src/lib/memory/retrieve.personal-lane.test.ts](../../src/lib/memory/retrieve.personal-lane.test.ts) | acceptance checks 1–2 |
| [src/lib/inspector/__tests__/reflect-tools.phase2.test.ts](../../src/lib/inspector/__tests__/reflect-tools.phase2.test.ts) | acceptance checks 3–4 |
