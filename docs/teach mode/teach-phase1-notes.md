# Teach — Phase 1 notes (the Reflect loop)

**Date:** 2026-07-20
**Status:** Shipped. Five acceptance checks green (13 assertions), `tsc --noEmit` clean project-wide, eslint clean (`--max-warnings 0`).

Phase 1 stands up the Reflect-mode agent loop that extracts candidate learnings from a
teaching conversation and emits them as typed events. It **wires existing engines**
(`teach.ts`, `retrieve.ts`, `executeSemanticQuery`) to a Reflect loop — it does not
re-implement any of them.

---

## Files

| File | Role |
|---|---|
| [src/lib/inspector/reflect-prompt.ts](../../src/lib/inspector/reflect-prompt.ts) | `MARCUS_REFLECT_SYSTEM_PROMPT` — layer one of the "no tasks" control |
| [src/lib/inspector/reflect-tools.ts](../../src/lib/inspector/reflect-tools.ts) | The allowlist, the 3 wrapped tools, learning-item model, pure helpers |
| [src/app/api/inspector/teach/route.ts](../../src/app/api/inspector/teach/route.ts) | SSE route; reuses `runAgentLoop` + `guardInspectorChat` |
| [src/lib/inspector/__tests__/reflect-tools.test.ts](../../src/lib/inspector/__tests__/reflect-tools.test.ts) | The five acceptance checks |

---

## The seam chosen: a dedicated `/api/inspector/teach` route that reuses loop internals

**Not** a mode-flag on `/api/inspector/chat`, and **not** a copy-paste fork.

- `chat/route.ts` is loaded with bandit/cost/judge/reflection lifecycle machinery
  (`reportToBandit`, `writeBanditObservation`, `scoreRun`, `evaluateTrajectoryReflection`,
  trace capture) that is meaningless for a knowledge-capture loop. A `mode: 'reflect'`
  flag would have to be threaded through system-prompt selection, tool-config selection,
  and every emit branch.
- The new route **imports** the shared internals: `runAgentLoop` (the Bedrock/Foundry loop),
  `guardInspectorChat` (same session-ownership posture), `resolveToolCatalogEntry` (connection
  resolution), and the Reflect tool layer. The only things swapped are the **system prompt**
  and the **tool allowlist** — exactly the two things that make it "Teach".

### Inventory findings that shaped this (Step 1)
- `teach.ts` was **only** reachable via REST routes (`memory/rules/*`), **never an agent tool**.
  Phase 1 wraps `teachRule` as the candidate-only `capture_learning` tool.
- **No interactive Reflect loop existed.** `marcus/inspectorReflect.ts` + `marcus/reflect.ts`
  are post-hoc trajectory scorers, not an interactive loop. Plan unchanged → built.

---

## The two-layer "no tasks" control

**Layer one (prompt):** Marcus is told to *understand, not execute*; to decline task requests
("build me a dashboard") and redirect; to ask clarifying questions; to extract discrete,
type-tagged learnings; and to treat verification as *advisory*.

**Layer two (allowlist — the hard guardrail):** `buildReflectToolConfig()` returns **exactly
three** tools. Because the agent can only call tools present in the `ToolConfiguration`,
withholding a tool makes the action structurally impossible.

| Tool | Wraps | Class |
|---|---|---|
| `recall_memory` | `selectMemoryAll` (retrieve.ts) | read |
| `capture_learning` | `teachRule` (personal + `SCHEMA_MAP`) | write-**candidate**, emits `learning_item` |
| `verify_claim` | `executeSemanticQuery` (governed gate → `executeDatabricksSQL`) | read-only, advisory |

**Withheld** (asserted absent by the test): `emit_semantic_chart`, `emit_chart`,
`execute_tool` (raw SQL), `describe_schema`, and every dashboard/chart mutation. The
dispatcher also refuses any non-allowlisted tool as defence-in-depth.

### The wrapped tools
- **`capture_learning`** — personal-first, `created_by` = the session user, `rule_type='SCHEMA_MAP'`.
  SCHEMA_MAP is the **only** type that reliably injects for a freshly-taught bullet (a
  `HARD_RULE` silently never injects until `harmful_count ≥ 1` — the Phase-0 dead-rule trap).
  The learning's semantic type (metric_definition / …) is **card metadata**; it does not change
  the injecting rule_type.
- **`recall_memory`** — flattens the three retrieval phases into typed `RelatedMemoryHit[]`.
- **`verify_claim`** — governed-only; validation/governance/draft errors are caught and surfaced
  as a typed `{ state: 'not_verifiable' }`, never a 500 (Phase-1 requirement; full UX is Phase 2).

---

## Reputation-timing decision (Step 3): **no credit at capture** — DEFAULT taken

Capture is not promotion, so a Teach capture does **not** move reputation. Reputation attaches
later, when **Build** promotes a learning (reusing `creditAuthoringPromotion` at that moment).

**Key correction from the inventory:** `teachRule()` **already** does not credit — only
`promoteRuleToOrg()` calls `creditAuthoringPromotion` ([teach.ts:158](../../src/lib/memory/teach.ts#L158)).
So "no credit at capture" is the *existing* behavior, not a new suppression. To make the decision
**explicit and testable** (rather than implicit), `ReflectToolDeps` carries an injectable
`credit` hook and the `CAPTURE_CREDITS_REPUTATION = false` constant; `capture_learning` never
invokes the hook. The test snapshots the hook's call count **before/after** a capture and asserts
**delta 0 to nobody** — a delta assertion, not row-existence (avoids the seam-3/6 weak-assertion trap).

---

## Verify-before-capture (C2): capture stays **unblocked** — DEFAULT taken

Matches current code and the Phase-1 brief. Verification is advisory; a claim that cannot be
verified is still captured. The `learning.verification_result` / `learning.state` fields exist as
**Phase-2 seams** but nothing gates on them.

> **Flag carried forward:** if product later decides teaching must verify *before* it captures,
> that flips a Phase-2 gate (it would move the gate onto the capture path, which today has none —
> [phase0 C2](teach-phase0-substrate-pins.md)). Raising it now, per the brief; not building it here.

---

## `learning_item` event schema (Step 4)

Emitted through the SSE `emit`, driven by tool events — never by scraping chat text. The
learning's own `type` is nested under `learning` so it does not collide with the SSE envelope's
`type` discriminator.

```jsonc
{
  "type": "learning_item",
  "learning": {
    "id": "<callId>",
    "type": "metric_definition | enterprise_convention | estate_navigation | vocabulary_entity | other",
    "statement": "…",
    "state": "proposed",              // proposed → verifying → verified/conflict/rejected (P1 emits proposed)
    "verification_result": null,      // Phase-2 seam
    "related_memory_hits": [],        // Phase-2 seam
    "conflict": null,                 // Phase-2 seam
    "memoryId": "<platform_agent_memory id>",
    "createdAt": "<ISO>"
  }
}
```

Field shape matches the Phase-4 prototype card model (type · statement · state · verify · conflict
· recall) so the rail binds without translation. Additional events: `memory_recall` (recall
affordance seam) and `verification_result` (verify seam).

---

## Watch-item that bit: `server-only` under vitest

`retrieve.ts`, `teach.ts`, and `execute.ts` each transitively import `server-only` (via
`context/embed` and `platform/agents`), which **throws** when loaded in the vitest node
environment. Statically importing them into `reflect-tools.ts` would have made the whole test file
un-loadable.

**Fix:** the engine calls are **lazy-imported inside `DEFAULT_DEPS`** (mirroring how `tools.ts`
lazy-imports `chart-pipeline`), and error classes are imported from the node-safe
`@/lib/semantic/errors` (explicitly written to avoid server-only). Module load of
`reflect-tools.ts` therefore pulls no server-only code; tests inject deps and never trigger the
lazy imports. This is also why the acceptance tests are pure/injected rather than DB-integration.

---

## Watch-items noted, not fixed (from Phase 0)
- **Single-org `getDefaultOrg` → `DEFAULT_ORG_ID`** — org is column-scoped but the value is a
  single env id, not per-user. The route resolves org via `getDefaultOrg()` like the rest of the
  system; do not assume per-session org resolution.
- **Synonyms inject only when `governed` AND top-K (10)** — not relevant to Phase-1 capture
  (we write SCHEMA_MAP bullets, not synonyms), but Build/vocabulary work must respect it.
- **Memory-rule injection is flag-gated (`MEMORY_INJECT_ENABLED`) + rule-type-gated** — a captured
  learning is only *live in the agent's context* when the flag is on and the class is allowed.
  We default to the injecting rule type (SCHEMA_MAP); surfacing "now applied" UX must not imply a
  dead rule is live.

---

## Non-goals honoured (deferred)
- Deep retrieve/verify/**conflict** logic → Phase 2 (seams left: `verification_result`, `state`,
  `related_memory_hits`, `conflict`).
- Candidate-feed / **Build** handoff surface + promotion-time reputation → Phase 3
  (the `credit` hook is the wiring point).
- Full **Teach page UI** → Phase 4 (event shape already aligned to the prototype card).
