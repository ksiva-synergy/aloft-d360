# Agent loop, working context, execution state and memory: what to fix, extend, reuse or defer

**Status:** Research findings (read-only investigation) · **Date:** 2026-11-07 · **Branch read:** `main` working tree (includes staged, uncommitted changes)
**Evidence ledger:** `research_notes/Agent loop research/context_memory_evidence_ledger.md` (E-ids below refer to it)
**Builds on and corrects:** `reports/Agent loop research.md`, `research_notes/Agent loop research/current_loop_audit.md` (2026-11-04), `docs/agent-runtime/plan.md` (2026-11-07)

## 0. Answer to the final question

The smallest safe set of changes is ten. It needs one new module boundary (a provider step interface) and no new storage service.

1. **Persist SQL results on the server and give the model a `result_id` with a compact preview.** Today the model receives the full result JSON, and the only durable copy of rows is written **by the browser**, not the server. So the planned "handle with no new storage" premise is half true: the table exists, but the server has to become its writer. *(Fix existing behaviour + extend `tools.ts`; E-20, E-21, E-22.)*
2. **Make each turn end truthfully.** Read finish reasons, add a real abort, label aborted turns, and on the loop cap make a tools-off wrap-up call that answers from the evidence gathered. Cost every turn, including errored and aborted ones. *(Fix; already specified as P0-2 to P0-5 in `docs/agent-runtime/plan.md`. Reuse that plan.)*
3. **Fix four context leaks:**
   - send the latest user message once;
   - cap Inspector history with the existing saved-agent policy (`historyForModel`);
   - cap the insights block;
   - key memory recall to the **current** turn, not the session's first message.

   *(Fix; E-05, E-08, E-10, E-31.)*
4. **Remove the hard-coded demo facts from session knowledge.** Vessel ids 60/78, specific tables, and a heuristic saying something "was validated" are injected as confirmed facts into any session whose SQL matches a substring. *(Fix; E-14.)*
5. **Extend session knowledge into the one Context Builder.** Add server-derived `activeFilters` and `recentResults` (each with a `result_id`). Assemble all dynamic blocks (semantic, insights, session knowledge, memory) in one function with budgets and a fixed order, and keep them **as data after the static prefix**, never as system instructions. No new memory service: storage stays in `workbench_sessions.progress`. *(Extend existing module; E-11 to E-16.)*
6. **Make long-term memory obey its own governance at read time:**
   - exclude Teach candidates in `conflict` or `rejected` state, and mark unverified ones;
   - stop crediting aborted or mislabelled turns;
   - attribute per turn rather than per session;
   - inject memory as fenced data rather than as `OPERATING MEMORY` instructions and a synthetic assistant message.

   *(Fix; E-30 to E-37.)*
7. **Introduce a provider `step()` interface with a fake adapter, and write characterization tests before refactoring.** No unit tests cover any of the three loops today. *(Add new component, justified as a test seam; E-40.)*
8. **Consolidate into `runAgentTurn` for the conversational surfaces only.** Business AI Studio should reuse the provider `step()` adapters through its own `ModelGateway`, not `runAgentTurn`. That keeps Studio's harness independent, as its own docs require (`02-target-architecture.md:119`, `07-memory-learning.md:3`). This **corrects ADR-014 as proposed in `docs/agent-runtime/plan.md` §6.5**. *(Extend; E-41, E-42.)*
9. **Defer** budgets, tool-result clearing, LLM compaction, the plan tool, verifiers and durable runs until a golden-set eval exists. Those changes alter behaviour in ways only pass^k shows.
10. **Reject** a second generic memory store, a vector database, LangGraph, and a Jev-style progress scorer for now (§5.4).

This set gives correct outcomes, bounded and cache-friendly context, and follow-up continuity that does not depend on the model re-reading prose. It also creates three clean extension points:

- a `step()` adapter that a durable worker or Studio can call;
- a `WorkingContext` object that a future goal memory can feed;
- server-owned `result_id`s that durable runs and plan lineage can reference.

---

## 1. Source documents checked

| Document | Present | Notes |
|---|---|---|
| `reports/Agent loop research.md` | Yes | Claims re-checked; line numbers drifted by 1–4 lines; substance holds except where noted in §1.1 |
| `research_notes/Agent loop research/current_loop_audit.md` | Yes | Same |
| `research_notes/Agent loop research/{context_and_efficiency, durable_runtime_and_control, evals_and_observability, planning_patterns}.md` | Yes | External literature; not re-verified (outside repo) |
| `docs/agent-runtime/plan.md` | Yes (not in the brief's list, found via CHANGELOG) | The current implementation plan. This report amends it rather than replacing it |
| `docs/AI-AGENT-MEMORY.md`, `docs/memory/README.md`, `docs/memory/agent-run-metrics-and-prompt-caching.md` | Yes | `AI-AGENT-MEMORY.md` is **stale**: it describes Bedrock as primary, `sonnet-4-6` default, 8 max loops, and an "overnight" memory loop (§4.4). None match code |
| `docs/business-ai-studio/07-memory-learning.md`, `ADR-004` | Yes | Defines the Studio and ALOFT memory boundary and the Jev benchmark gate |
| `docs/teach mode/*` | Yes | Phase notes; code read directly instead |
| `scripts/memory/synthesize.ts` | **Missing** | Referenced in `src/lib/memory/run-sweep.ts:5`; does not exist |

### 1.1 Corrections to earlier research

| Earlier claim | Current evidence | Effect |
|---|---|---|
| "ALOFT already keeps the full rows server-side in `sessionQueryResults` and `studio_query_results`, so the handle needs no new storage" (report §Context; plan P0-1) | `sessionQueryResults` is an in-memory array scoped to **one HTTP request** (`route.ts:357`). `studio_query_results` rows are inserted only by the **browser**, which echoes each `query_result` SSE event back to `POST /api/studio/results` (`useInspectorChat.ts:445-480`, `studio/results/route.ts:60-97`). Saved-agent chat and non-UUID sessions never write it | A `result_id` needs a **server-side write** in `execute_tool`. The table can stay. Without this, handles are missing whenever the tab closes mid-turn, on agent surfaces, and are client-authored |
| Plan F10 / §6.5: "Studio's adapter wraps `runAgentTurn`. One loop serves Studio and chat" | Studio docs require that Studio "does not import Inspector session code" and owns its own planning, budgets and checkpoints (`02-target-architecture.md:119`; ADR-004 Decision 1) | Share the **provider step layer**, not the conversational turn harness (§5.1) |
| "Execution goes through `executeDatabricksSQL`" | `execute_tool` now goes through `runWarehouseQuery`, which runs `authorizeSql` and picks a tier-specific Databricks role (`tools.ts:447`, `access/warehouse.ts:27-46`) | Any result reuse must keep the principal and tier that authorized it (§3.5) |
| Report: Inspector auth "observe-mode by default" (ADR-004 text) | `INSPECTOR_AUTH_ENFORCE !== 'false'` means enforce by default (`session-auth.ts:132`) | Lower risk for session-scoped context than ADR-004 assumed |
| Memory "loop closes overnight" (`AI-AGENT-MEMORY.md`) | Synthesis runs only from an admin button (`/api/agent-lab/memory/synthesize`, called from `DistillationStage.tsx:118`, `FoerOpsDashboard.tsx:265`). No scheduler was found in `infra/`, `.github/workflows/` or `scripts/` | TTL expiry and refinement only happen when an admin clicks. Memory freshness is not enforced by time |

---

## 2. Deliverable 1: code-level execution and memory map

### 2.1 Request path (Inspector, the main surface)

```
Browser  useInspectorChat.doSend (src/hooks/useInspectorChat.ts:270)
  │  body = { sessionId, messages: <whole local transcript + userMsg (sent twice)>, model, contextMode }
  ▼
POST /api/inspector/chat (src/app/api/inspector/chat/route.ts)
  ├─ guardInspectorChat (enforce by default)                         :151
  ├─ model key → always an LLM Lite (LiteLLM) gateway id               :161-174, :204
  ├─ assertInteractiveBudget (pre-flight only)                          :181
  ├─ history: filter empties, merge same-role, text only, NO cap        :209-227
  ├─ system prompt  = base + semantic + AGENT_ANSWER_VOICE              :247 (prompts.ts:446)
  │                 + PRIOR ANALYSIS INSIGHTS (uncapped)                :248 (prompts.ts:458)
  │                 + SESSION KNOWLEDGE (UUID sessions)                 :249-251
  │                 + OPERATING MEMORY P0/P1a (if MEMORY_INJECT_ENABLED):263-317
  ├─ P1b recall → synthetic ASSISTANT message before first user turn    :323-328
  ├─ SSE stream; abort → closed.value = true (boolean only)             :335-338
  ├─ dispatchAgentLoop → runFoundryAgentLoop → Chat Completions loop    :559-561
  │     foundry-chat.ts:406-684  (≤15 loops; full tool results appended each loop)
  │       └─ executeInspectorTool (tools.ts) via withAgentOpsToolLog
  │            ├─ describe_schema → context/dispatch.ts (global semaphore 2)
  │            ├─ execute_tool → runWarehouseQuery → authorizeSql → Databricks
  │            │     returns JSON.stringify(full result) to the MODEL     tools.ts:467
  │            │     emits query_result (≤1000 rows) to the UI            tools.ts:457
  │            ├─ emit_chart → charts the LAST result in request memory  tools.ts:204
  │            └─ export_query_result → falls back to studio_query_results SQL
  ├─ outcome branches: completed / truncated (canned footer) / errored  :619-740
  ├─ spend only on completed + truncated                               :636, :701
  ├─ turn metrics (agent_turn_log, agent_loop_log); skipped if non-UUID :742, record-turn-metrics.ts:41
  └─ after stream: persistSessionKnowledgeAfterTurn (+ LLM narrative)   :760-773
Browser (in parallel)
  ├─ POST /api/studio/results per query_result event (client-written rows)  useInspectorChat.ts:445-480
  └─ PATCH /api/agent-lab/workbench/sessions/:id every 2 s (transcript autosave)  :256-267
```

### 2.2 The three scenarios

| Step | Simple question ("How many active vessels?") | Multi-turn follow-up ("Same, but only for Q2") | Complex investigation (opex compare, rank, explain) |
|---|---|---|---|
| Client payload | Transcript of 1 user message, sent as `"q\nq"` after the server merges the duplicate (E-05) | Whole transcript. Assistant turns are **final prose only**, and the answer-voice rule forbids SQL, tables and filters in prose (`answer-rules.ts:22`) | Same |
| What carries the earlier filter | n/a | Only (a) SESSION KNOWLEDGE "Last successful SQL", truncated to 1,200 chars (`session-knowledge-store.ts:151`), and (b) the model inferring it from the user's own words. Filters in any earlier, non-last query are lost | Earlier SQL is not in history. Paths and entities come from session knowledge |
| Loops | 2–3 (`describe_schema`, then `execute_tool`, then answer) | Should be 1–2 if session knowledge works. Repeats discovery if it was never written (non-UUID session, tab closed so no `studio_query_results`) | Often 8–15. Every full result is re-sent each loop (E-02) |
| Context risk | Low | Medium: depends on client-written state | High: quadratic growth, cap hit gives no answer (E-07) |
| Persistence | Final text only via client autosave. Rows via client POST | Same | Same. A turn that hits the cap leaves only interim narration plus a canned footer |

### 2.3 Where the loop variants diverge

There are nine call sites and three loop bodies (E-41). What each supports:

| Capability | Bedrock `runAgentLoop` (`agent-loop.ts:120`) | Chat Completions (`foundry-chat.ts:406`), **production** | xAI Responses (`foundry-chat.ts:189`) |
|---|---|---|---|
| Reached by | Semantic blueprint and refine-item, flows-copilot fallback, workbench fallbacks | Inspector, saved agents, Try it, workbench, Teach reflect, boost runner | Only `resource === 'xai'` (direct xAI key) |
| Reasoning carried across tool rounds | No (thinking blocks dropped, `:303-307`) | No (no field for it, `:133-135`) | Yes (encrypted reasoning items echoed, `:308-309`) |
| Abort checked mid-stream / before tools | Yes / Yes, but labels it `completed` | **No / No** | Yes / n/a, but labels it a timeout |
| Per-tool exception isolation | **No** (`Promise.all` without try/catch) | Yes | Yes |
| Cache control | Opt-in system `cachePoint` | None | Random `prompt_cache_key` per run |
| Temperature / output cap | 0.3 or 1 / 4096 | Provider default / 4096 | 0.7 / 4096 |
| Stop reason read | No | No | `incomplete` treated as completed |

### 2.4 Memory map

```
WRITE PATHS                                       STORE                                READ PATHS
Inspector turn → trace capture (FOER graph) ──►  trace tables (memory/trace)
Admin button → runSynthesisSweep ──reflect/curate──►  platform_agent_memory  ◄── selectMemoryAll (retrieve.ts)
   (phantom + caveat + scrub gates; org, ACTIVE)        status ACTIVE|QUARANTINED|           P0 HARD_RULE, P1a SCHEMA_MAP,
Teach reflect loop → capture_learning → teachRule ─►    SUPERSEDED|EXPIRED;                  P1b pgvector recall
   (personal, ACTIVE immediately)                       visibility org|personal              → system prompt + synthetic
Teach verify_claim/conflict ──────────────────────► platform_teach_candidate (state)        assistant msg (inspector only)
promoteRuleToOrg (reputation-gated) ──────────────► visibility='org'                        (NOT read by retrieval)
Run outcome → attributeRunOutcome ────────────────► helpful/harmful counts, confidence, GC
Inspector turn → persistSessionKnowledgeAfterTurn ► workbench_sessions.progress.inspectorKnowledge ──► SESSION KNOWLEDGE block
Browser → POST /api/studio/results ───────────────► studio_query_results (+ studio_insights) ──► INSIGHTS block, last-SQL heuristic
```

---

## 3. Findings by track

### 3.1 Track A: execution architecture

- **One harness per surface, three loop bodies, nine callers.** The report's divergence table holds for the current tree (E-41). Two callers the report did not cover are the Teach reflect loop (`inspector/teach/route.ts:152`) and the boost runner (`boost/runner.ts:160`). Both use the production Chat Completions path through `dispatchAgentLoop`.
- **The defects the report lists are present** in `foundry-chat.ts` and the route: abort not propagated, stop reasons ignored, no wrap-up turn, full results inlined, uncosted errors, `toolCalls = loops - 1`, Sonnet fallback pricing. See E-01 to E-09. Line numbers in `route.ts` moved by about +4, and in `run-catalog-agent.ts` by about +4.
- **`runAgentTurn` consolidation review:**
  - *Compatibility.* All callers already pass the same `AgentLoopParams` shape and consume `AgentLoopResult`, so a common turn function is mechanically feasible. Caller differences are policy: history source, caps, tools, post-run hooks and persistence. These belong in a per-surface `TurnSpec`, not in the loop.
  - *Migration risk.* High without tests. There are **zero** unit tests for any loop. Callers' tests mock the loop away (`run-catalog-agent.test.ts:39-40`). Shadow runs are unsafe because they would execute warehouse SQL twice.
  - *Testability.* `getFoundryClient` is constructed inside the loop (`foundry-chat.ts:418`), so there is no injection seam. The first deliverable must be a `step()` interface with a fake, replayable adapter.
  - *Boundary.* Conversational policies (session knowledge, insights, memory injection, Inspector post-run learning) must not leak into whatever Studio reuses. Hence two layers (§5.1).

### 3.2 Track B: working context

| Question | Finding | Confidence |
|---|---|---|
| 1. History assembly and truncation | Inspector: client sends the whole transcript, no cap, text only. The latest user message is duplicated (E-05). Saved agents: server-stored, last 30 messages and ≤60k chars, but replayed with concatenated interim narration (E-17, E-18) | High |
| 2. Do filters and results survive follow-ups? | Only via SESSION KNOWLEDGE: ≤48 paths, ≤24 entities (vessels only), ≤20 heuristics, last SQL ≤1,200 chars, plus template and LLM narrative summaries. No structured filter state. Prose omits SQL by design. Saved agents have no session knowledge at all | High (code); runtime effect unmeasured |
| 3. Client- or server-authoritative? | **Mixed.** Inspector transcript: client. Query rows: client-written. Session knowledge: server-written, but partly derived from client-written `studio_query_results` (`session-knowledge-store.ts:101-145`). Saved-agent transcript: server | High |
| 4. How prompt parts combine | One system string: base, semantic (≤8k), answer voice, insights, session knowledge, P0 and P1a memory. Then P1b as a fake assistant turn. Dynamic parts sit after the static prefix, but everything is "system" authority | High |
| 5. Large tool results re-injected? | Yes. Full `execute_tool` JSON on every subsequent loop of the turn (E-02). Not across turns (history is text only) | High |
| 6. Can compaction and retrieval reuse storage? | Yes. `workbench_sessions.progress` for summaries and working context; `studio_query_results` for result bodies **once written server-side**; `tool_invocation_log` is unsuitable because it omits rows and truncates SQL to 500 chars (E-26) | High |
| 7. Would a structured working-context object solve measurable problems? | Yes, by **extending** `InspectorSessionKnowledge`, which already is one. Measurable targets: repeat-discovery rate on follow-ups (`describe_schema` calls on turn ≥2), filter-carry accuracy (regression cases F-1 to F-4), and system-prompt chars per turn | Medium (benefit unmeasured) |

**Context Builder assessment.** A small `buildWorkingContext(session, turn)` is justified and does not need a new service:

- **Inputs:** the existing session knowledge, server-written result refs, semantic context, capped insights and memory selection.
- **Output:** ordered, budgeted blocks marked `static` (cacheable prefix) or `dynamic` (data message).
- **Storage:** stays in `progress.inspectorKnowledge`, with a version bump to 2.
- **New fields:**
  - `activeFilters`: derived from the WHERE clauses of executed SQL by a parser, never by the LLM;
  - `recentResults`: `{result_id, sql_hash, columns, row_count, created_turn}`, last 5.

It replaces the four ad-hoc concatenations in `route.ts:247-328`.

### 3.3 Track C: execution state

| Item | Finding | Confidence |
|---|---|---|
| `agent_turn_log` / `agent_loop_log` | Per-turn and per-loop timing, tokens, cache split, peak context, ALOFT's own stop label. No finish reason, request id or cost. Skipped entirely for non-UUID sessions (E-25) | High |
| `tool_invocation_log` | Redacted: `rows` replaced by a length, SQL truncated to 500 chars, payload ≤8 KB, success sampling via env (E-26). Keeps `statement_id` | High |
| Result persistence / `result_id` | `studio_query_results` has `id`, `seq`, full `rows` JSON (≤1000 from the UI copy) and profiles. It is written by the client. There is no `turn_id`, principal or `statement_id` column (E-20 to E-22) | High |
| Retrieve without re-executing SQL? | Within a request: yes (`sessionQueryResults`). Across turns: only if the browser POSTed it, and only the UI-capped rows. Databricks `statement_id` re-fetch depends on warehouse result retention | High / Low (retention unverified) |
| Stop reasons, cancel, failure, partial, final answer | As in the report. Partial narration is kept only in the browser. A loop-cap turn returns `finalText: null` | High |
| Can logs reconstruct or resume a turn? | **Reconstruct approximately:** the sequence of tools, truncated inputs and loop metrics. **Resume: no.** Assistant messages, reasoning state and full tool outputs are not stored, and nothing links `turn_id` to transcript message ids or result rows | High |
| State needed: chat vs durable | Normal chat needs the transcript, working context and server-owned result refs. Durable execution additionally needs a run row with lease, an append-only event log of model and tool steps with full outputs (or refs), an inbox and idempotency keys (ADR-003). Today's logs are **telemetry, not checkpoints** | High (design) |
| Security, retention, ownership, idempotency | Results are authorized per principal and tier (`authorizeSql`). A stored result must carry the authorizing principal and be readable only by the session owner (owner guard exists: `guardSessionRead`). Retention: none defined for `studio_query_results` (cascade on session delete only). Idempotency: all current tools are read-only, so classification is cheap now and required before M365 write tools | High / Medium |

### 3.4 Track D: ALOFT long-term memory

| Capability | Implemented | Enabled at runtime | Evidence |
|---|---|---|---|
| FOER trace capture (action, outcome, dead end, correction) | Yes | Yes, for UUID Inspector sessions | `route.ts:388-545`, `memory/trace/*` |
| Reflection, curation and synthesis (phantom, caveat and scrub gates) | Yes | **Manual only** (admin button); no scheduler; script missing | E-34, E-35 |
| Refinement: TTL expiry (SCHEMA_MAP 90 d … FAILURE_MODE 14 d), supersede | Yes | Only inside a manual sweep | `synthesis/refine.ts:19-25` |
| Retrieval P0, P1a, P1b, personal lane, MMR, full pool | Yes | **Unverified.** Gated by `MEMORY_INJECT_ENABLED=true` and `MEMORY_INJECT_CLASSES` containing `inspector`; MMR and full pool behind further flags | `retrieve.ts:108-117, 135` |
| Memory on saved agents, Try it, Teach, workbench test-run | No injection on agents (`run-catalog-agent.ts`); workbench chat has its own block | n/a | grep |
| Teach (personal rule → candidate envelope → verify and conflict → resolve) | Yes | Teach route live | `reflect-tools.ts`, `teach-candidate-store.ts`, `memory/teach.ts` |
| Promotion personal → org | Yes, reputation-gated | Depends on `MEMORY_REPUTATION_ENABLED` | `teach.ts` header |
| Attribution (helpful and harmful counts, conflict GC) | Yes | Inspector only | `attribution.ts:96-150` |
| Session working memory (session knowledge + LLM narrative) | Yes | Narrative on when any LLM credential exists, unless `INSPECTOR_SESSION_SUMMARY_LLM=false` | `session-knowledge-llm.ts:22-31` |
| Team scope | **No.** Only `org` and `personal` | — | `retrieve.ts:188-189` |
| Declared but unused | `scripts/memory/synthesize.ts` (missing); `MEMORY_TOOL`, `MEMORY_SNIPPETS` (env names seen, usage not traced) | — | grep |

**Governance gaps that matter for the loop:**

1. **Unverified personal rules are live.** `capture_learning` says the learning stays "a PERSONAL candidate (visible only to this user until a later review step)" (`reflect-tools.ts:171`). But `teachRule` writes `status: 'ACTIVE'` (`teach.ts:95`), and retrieval never reads `platform_teach_candidate` (`schema.prisma`, comment above `PlatformTeachCandidate`). So a rule whose verification found a **conflict** is still injected into its author's sessions until the author resolves it. (E-30, E-31)
2. **Synthesized org rules go ACTIVE without human approval** (`curate.ts:385, 440`). Only caveated HEURISTIC and SOURCE_PREF rules are quarantined. Phantom validation checks that identifiers appear in a trace, not that the rule is true. (E-33)
3. **Learned text gets instruction authority.** Memory goes into the system prompt as `=== OPERATING MEMORY ===`, and P1b goes in as a fake assistant message (`route.ts:300-301, 323-328`). Studio's own docs list this as open risk S13 (`07-memory-learning.md:62`). Rule text is LLM-extracted from traces that include warehouse output, which is an indirect-injection path. (E-36)
4. **Relevance is keyed to the session's first message.** `taskCtx` and `topicKey` come from the first user message on every turn (`route.ts:266`). A follow-up that changes topic gets the original topic's recall. (E-32)
5. **Feedback signal is weak and partly wrong:**
   - "success" is `scoreRun`, a tool-error heuristic, not answer correctness;
   - aborted turns labelled `completed` are credited;
   - injection rows are keyed by session id with `ON CONFLICT DO NOTHING`, so only the first turn's outcome is attributed for bullets already injected. (E-37; Medium confidence on the last point, which needs a runtime check)
6. **Freshness depends on a human clicking "synthesize".** TTL expiry only runs in the sweep. (E-35)
7. **Session knowledge is learned-incorrect-information by construction.** Hard-coded vessel ids and "validated" claims are emitted on substring matches (E-14). Entities are lifted from SQL result rows (untrusted) into the system prompt (E-15).

**Reusable through governed interfaces:** `selectMemoryAll` and `formatForInjection` (wrap them as `AloftMemoryPort.select(scope)`, as 07 §4 proposes), `buildSemanticContext`, `executeSemanticQuery` (already used by `verify_claim`), and the session-knowledge merge and format logic (pure and unit-tested). Nothing here needs rebuilding.

### 3.5 Track E: optimization hypotheses

| # | Hypothesis | Dependencies | Correctness regression risk | How to measure | Verdict |
|---|---|---|---|---|---|
| H1 | Compact SQL previews + secure `result_id` | Server-side result write (WC-1); prompt text that "the user sees the full table"; `emit_chart` and `export` by id | "List top 50" answers truncated; the model re-queries more often | `agent_loop_log.context_chars` p50/p95 by loop; input tokens per multi-loop turn; regression cases L-1 to L-3; repeat-SQL rate | **Do (Phase R1)** |
| H2 | Server-side context management (server owns history, caps) | Shared `historyForModel`; dedupe fix | Losing early-turn constraints when capped | Multi-turn cases F-1 to F-4; tokens per turn ≥ turn 5 | **Do caps now; defer moving Inspector history server-side** (API change, low measured need) |
| H3 | Incremental conversation summaries | **Already exists**: template + LLM narrative validated against facts (`session-knowledge-core.ts:420`) | Summary drift or poisoning | Narrative validation failure rate; follow-up accuracy with the narrative on and off (`INSPECTOR_SESSION_SUMMARY_LLM`) | **Reuse; evaluate before extending** |
| H4 | Structured plan and progress state | Context Builder; golden set | Plan rigidity; extra tool round | Multi-step case pass^3; forgotten-deliverable rate; extra loops | **Defer to after evals** |
| H5 | Prefix / prompt caching | Context Builder's static/dynamic split; gateway `cache_control` passthrough (probe) | None to answers; cache-key churn | `cache_read_tokens / input_tokens` from loop 2; TTFT | **Do after Context Builder; gated by probe** |
| H6 | Provider reasoning continuity | Gateway `/v1/responses` or Claude `thinking_blocks` (probe) | Model change confounds results | Repeat-query rate within a turn (same normalised SQL hash) | **Defer until the probe** (plan §6.3 is correct) |
| H7 | Tool-result reuse / dedupe | `result_id` + SQL normalisation hash | Serving stale data across turns | Repeated identical calls per turn; warehouse calls per turn | **Within a turn: do (cheap). Across turns: defer** (freshness rules needed) |
| H8 | Evidence-based stopping | Finish reasons, wrap-up turn, then budgets | Premature stop | Truncated-with-empty-answer rate (target 0); budget-exhaustion rate | **Wrap-up now; budgets after evals** |
| H9 | Jev or similar lightweight decision model for progress evaluation | A closed-choice decision to score, a labelled set, calibration | False "done" signals end turns early | ADR-004 gate: top-1 within 2 pts, ≥95% precision at abstain, lower p95 and cost | **Reject now.** No such decision exists in the loop, there is no labelled data, and the ADR-004 gate is unmet. Revisit only for routing |

---

## 4. Deliverable 3: existing vs missing capability matrix

| Capability | Exists | Gap |
|---|---|---|
| Multi-provider loop | Yes, three copies | Divergent behaviour; no tests |
| Streaming to UI | Yes | Tag-split markup leak on Bedrock (minor) |
| Real cancellation | No (boolean flag) | AbortSignal to the request, check before tools |
| Truthful outcome labels | Partial | `aborted` missing; abort labelled completed or timeout |
| Final answer at cap | No | Tools-off wrap-up |
| Per-turn metrics | Yes | Non-UUID sessions dropped; no finish reason or cost |
| Cost truth | Partial | Gateway ids priced as Sonnet; errors uncosted |
| Prompt caching | No (production path) | Static/dynamic split + breakpoints |
| History cap | Saved agents only | Inspector uncapped; duplicate user message |
| Working-context object | **Yes** (`InspectorSessionKnowledge`) | No filters or result refs; hard-coded facts; Inspector-only |
| Incremental summary | **Yes** (template + validated narrative) | Not evaluated; Inspector-only |
| Server-owned result store | Table yes, writer no | Server write + principal + turn id |
| Result handle to model | No | Preview + `result_id` |
| Durable checkpoints / resume | No | ADR-003 tables (deferred) |
| Long-term memory store + retrieval | Yes (pgvector, phases, scopes) | Runtime enablement unverified |
| Memory governance at read time | Partial | Candidate state ignored; instruction authority; first-message relevance |
| Scheduled memory maintenance | No | Manual sweep only |
| Team scope | No | No demonstrated requirement yet (Studio owns team goal memory per 07) |
| Eval runner | Tables only | Runner (plan F8) |

---

## 5. Deliverable 5: proposed minimal improvements and alternatives

### 5.1 Harness shape: two layers, not one

```
src/lib/agent-runtime/
  step/                      ← shared layer: Studio's ModelGateway may wrap this
    types.ts                 StepRequest{model, staticSystem, contextBlocks, messages, tools, limits, signal}
                             StepResult{text, toolCalls, reasoningState, finishReason, usage, costUsd?}
    chat-completions.ts      (from foundry-chat.ts:406-684)
    responses.ts             (from foundry-chat.ts:189-402)
    converse.ts              (from agent-loop.ts:120-347)
    fake.ts                  replay adapter for tests
  turn/                      ← conversational layer: Inspector, saved agents, Try it, workbench, Teach
    run-agent-turn.ts        loop, abort, wrap-up, outcome, metrics, tool batch
    tool-results.ts          server result write, preview, result_id
    working-context.ts       extends session-knowledge; ordered/budgeted blocks
    history.ts               shared historyForModel policy
```

- **Alternative A (plan §6.5):** a single `runAgentTurn` that Studio also wraps. *Rejected.* It couples Studio to conversational policy, contrary to `02-target-architecture.md:119` and `07-memory-learning.md:3`.
- **Alternative B (status quo ADR-004):** Studio wraps `dispatchAgentLoop`. *Rejected.* That inherits the loop's defects and its policy-free but unsafe abort.
- **Chosen:** Studio wraps `step/` and owns its own loop, budgets and checkpoints. Both loops share provider fixes.

### 5.2 Change register

| ID | Change | Classification | Files | Depends on |
|---|---|---|---|---|
| WC-1 | `execute_tool` writes `studio_query_results` server-side with `turn_id`, `principal_id`, `statement_id`, `sql_hash` and full rows up to `MAX_ROWS`. Browser POST becomes an idempotent no-op (or is removed) | **Fix existing behaviour** (+ one additive migration) | `tools.ts:447-467`, `studio/results/route.ts`, `useInspectorChat.ts:445-480`, `schema.prisma` | — |
| WC-2 | Model receives columns, types, `row_count`, `truncated`, first N rows as CSV under a char cap, and `result_id`. `emit_chart` and `export_query_result` take `result_id` | **Extend existing module** | `tools.ts`, `prompts.ts`, `answer-rules.ts` | WC-1 |
| WC-3 | `fetch_result(result_id, offset)` tool | **Defer** (add only if L-cases show re-query loops) | — | WC-2 |
| WC-4 | Send the latest user message once | **Fix** | `useInspectorChat.ts:285-306` | runtime confirm |
| WC-5 | Apply `historyForModel` (30 messages / 60k chars) to the Inspector | **Reuse as-is** | `agent-chats.ts:66` → shared | — |
| WC-6 | Cap PRIOR ANALYSIS INSIGHTS (latest N, char cap) | **Fix** | `prompts.ts:458-483` | — |
| WC-7 | Remove hard-coded vessel, table and "validated" heuristics. Keep generic extractors only | **Fix** | `session-knowledge-core.ts:45, 178-262`, `session-knowledge-store.ts:126-131` | — |
| WC-8 | Working-context v2: `activeFilters` (SQL-parsed), `recentResults` (refs); one builder emitting static and dynamic blocks; untrusted fields fenced | **Extend existing module** | `session-knowledge-*`, `route.ts:247-328` | WC-1, WC-7 |
| WC-9 | Saved agents get the same working context (keyed by chat id) | **Extend** | `run-catalog-agent.ts` | WC-8 |
| WC-10 | Move the Inspector transcript to server-authoritative storage | **Defer** | — | durable runs |
| WC-11 | LLM compaction of long transcripts | **Defer** (narrative summary exists; measure first) | — | evals |
| ES-1 | Finish reasons, real abort, `aborted` outcome, wrap-up turn, cost on every outcome, non-UUID metrics | **Fix** (plan P0-2 to P0-5, P0-7) | per plan | step tests |
| ES-2 | `turn_id` on SSE `done`, on transcript message and on result rows | **Extend** | route, hook, `record-turn-metrics.ts` | WC-1 |
| ES-3 | Durable run store (`agent_runs`, `run_events`, inbox, approvals, idempotent tool calls) | **Defer** (ADR-003; separate go/no-go) | — | R2 complete, agent versioning |
| ES-4 | Tool registry metadata: `read` / `idempotent_write` / `non_idempotent_write` | **Extend** (cheap now) | `prompts.ts` tool specs | — |
| ES-5 | Within-turn duplicate-call detector (tool + normalised args hash → return prior `result_id`) | **Extend** | turn layer | WC-2 |
| L-1 | `step()` interface + fake adapter + characterization tests | **Add new component** (justified: no seam, no tests) | `agent-runtime/step/*` | — |
| L-2 | `runAgentTurn` for conversational callers; Studio wraps `step/` | **Extend** (consolidates existing code) | per §5.1 | L-1, ES-1 |
| L-3 | Cache-first layout from the working-context builder | **Extend** | turn layer | WC-8, gateway probe |
| L-4 | Reasoning continuity per provider | **Defer** to probe | — | probe |
| L-5 | Budgets, tool-result clearing, plan tool, verifiers | **Defer** to evals | — | golden set |
| M-1 | Exclude Teach candidates in `conflict` or `rejected` from retrieval; label `proposed` as unverified | **Fix** | `retrieve.ts` personal lane (join `platform_teach_candidate`) | — |
| M-2 | Inject memory as a fenced data block in the context message; drop the synthetic assistant turn | **Fix** (closes S13 for chat) | `route.ts:300-328`, `retrieve.ts:623` | WC-8 |
| M-3 | Memory recall keyed to the current user message (optionally plus the session goal) | **Fix** | `route.ts:253-294` | — |
| M-4 | Attribution: skip aborted and errored-unknown turns; key injections by `turn_id` | **Fix** | `route.ts`, `attribution.ts` | ES-1, ES-2 |
| M-5 | Org-visible synthesized rules enter as a reviewable candidate, not ACTIVE | **Fix — owner decision required** | `curate.ts:385, 440` | governance decision |
| M-6 | Schedule the synthesis and refine sweep (or document it as manual); remove the stale "overnight" docs | **Fix** (docs) / decision (schedule) | `AI-AGENT-MEMORY.md`, infra | — |
| M-7 | Expose `AloftMemoryPort.select(scope)` / `AloftSemanticPort` read-only for Studio | **Reuse via interface** | wrapper only | M-1, M-2 |
| M-8 | Team scope | **Defer** (no demonstrated requirement) | — | — |
| M-9 | Goal and operational memory | **Defer; Studio-owned** (07 §2). Not in `platform_agent_memory` | — | durable runs |
| X-1 | Second generic memory store / vector DB | **Reject** (pgvector + `platform_agent_memory` + `progress` cover the needs) | — | — |
| X-2 | LangGraph or another agent framework | **Reject** (ADR-004; no evidence of benefit; supply-chain surface) | — | — |
| X-3 | Jev-style progress scorer | **Reject now** (§3.5 H9) | — | — |

---

## 6. Deliverable 4: data lifecycle map

| Data | Created by | Stored in | Read by | Lifetime / retention | Owner check | Authority |
|---|---|---|---|---|---|---|
| Transcript (Inspector) | Browser | `workbench_sessions.messages` (autosave PATCH) | Browser; route via request body | Until session delete | `guardSessionRead` on PATCH/GET | **Client** |
| Transcript (saved agents) | Server | agent chat row (`appendAgentChatMessages`) | `historyForModel` | Until chat delete | Server | Server |
| In-turn messages + tool outputs | Loop | Process memory | Loop | One request | n/a | Server (ephemeral) |
| Query rows (UI copy ≤1000) | Browser echo | `studio_query_results` | UI reload, export fallback, session knowledge | Cascade on session delete; no TTL | Owner guard | **Client** → should be server (WC-1) |
| Insights | Insights route from stored rows | `studio_insights` | INSIGHTS block (uncapped) | Cascade | Owner guard | Derived from client data |
| Session knowledge + narrative | Server after turn | `workbench_sessions.progress.inspectorKnowledge` | SESSION KNOWLEDGE block | Session lifetime | Server | Server (inputs partly client) |
| Turn and loop telemetry | Server | `agent_turn_log`, `agent_loop_log` | Ops UI, baselines | No TTL defined | Ops role gate | Server, **telemetry only** |
| Tool telemetry | Server | `tool_invocation_log` (redacted) | Ops UI | No TTL defined | Ops role gate | Server, **telemetry only** |
| Trace graph | Server | memory/trace tables | Synthesis | — | — | Server |
| Long-term rules | Synthesis (admin), Teach | `platform_agent_memory` | `selectMemoryAll` | TTL by rule type, **only when the sweep runs** | `visibility` + `created_by` | Server |
| Teach verification | Teach loop | `platform_teach_candidate` | Teach UI only | — | Author | Server, **not consulted by retrieval** |
| Injection attribution | Route | `platform_memory_injections` | `attributeRunOutcome` | — | — | Server (session-keyed) |

---

## 7. Deliverable 6: risks and questions needing runtime verification

| # | Question | Why it matters | How to check (read-only) |
|---|---|---|---|
| Q1 | Is `MEMORY_INJECT_ENABLED=true` with `inspector` in `MEMORY_INJECT_CLASSES` in production? | Decides whether M-1 to M-4 are live risks or latent ones | `SELECT count(*), max(created_at) FROM platform_memory_injections WHERE created_at > now() - interval '14 days'` |
| Q2 | What fraction of `execute_tool` calls have a matching `studio_query_results` row? | Measures client-write loss (WC-1 urgency) | Join `tool_invocation_log` (`tool_name='execute_tool'`, `status='success'`) to `studio_query_results` by `session_id` and time window; compare counts |
| Q3 | Is the latest user message really duplicated? | WC-4 | Capture one request body locally (plan W0-4) |
| Q4 | How many turns run on non-UUID sessions (no metrics, no session knowledge)? | Coverage of both features | Count `agent_cost_log` Inspector rows vs `agent_turn_log` rows per day |
| Q5 | Does the gateway pass `cache_control`, `prompt_cache_key`, `/v1/responses` reasoning, `tool_choice:'none'` and cost headers? | H5, H6, wrap-up turn, cost | Plan W0-2 probe |
| Q6 | Context size distribution and loop counts | Size of the H1/H5 benefit | Plan W0-3 baseline SQL |
| Q7 | How often does a follow-up repeat discovery? | Baseline for WC-8 | `tool_invocation_log`: share of turn ≥2 with `describe_schema action='search'` on a path already in session knowledge |
| Q8 | When was the last synthesis sweep, and how many ACTIVE bullets are past TTL? | M-6 urgency | `SELECT max(completed_at) FROM platform_memory_synthesis_run`; count ACTIVE rows with `GREATEST(last_used_at, created_at)` older than the TTLs |
| Q9 | How many ACTIVE personal rules have a candidate in `conflict` or `rejected`? | M-1 exposure | Join `platform_agent_memory` to `platform_teach_candidate` on `memory_id` |
| Q10 | Is Databricks statement-result retention usable for re-fetch by `statement_id`? | Alternative to storing rows | Warehouse docs + one test with a CLI OAuth profile |
| Q11 | Is the narrative summary ever rejected by `validateNarrativeAgainstFacts`? | H3 quality | Add a counter log; or sample `progress` JSON |

All queries are `SELECT`-only and must use a Databricks or DB CLI OAuth profile, never the app service principal (`AGENTS.md`).

**Top risks:**

1. Previews degrade list-style answers. Mitigate with the cap as an env setting, the UI showing the full table, and cases L-2 and L-3.
2. Working-context changes alter answers silently. Gate on regression cases F-1 to F-6.
3. M-5 changes how fast org memory grows. This is an owner decision.
4. Consolidation without tests. L-1 comes first, with per-surface flags and no shadow runs.
5. Moving `studio_query_results` writes server-side doubles writes during transition. Make the POST idempotent on `(session_id, sql_hash, turn_id)`.

---

## 8. Deliverable 7: revised phased roadmap

This amends `docs/agent-runtime/plan.md` rather than replacing it. Its Week 0 to Phase 2 structure stands. Changes are marked **[new]** or **[changed]**.

| Phase | Scope | Exit criteria (falsifiable) |
|---|---|---|
| **R0: Verify (3–4 d)** | Plan W0-1 to W0-4, plus **[new]** Q1, Q2, Q4, Q7, Q8 and Q9 | Results table filled. Each of WC-1, M-1 and M-6 re-ranked from data |
| **R1: Truthful turns and bounded context (~2.5 wk)** | Plan P0-2 to P0-7 (ES-1); **[changed]** P0-1 split into WC-1 (server write) then WC-2 (preview + `result_id`); **[new]** WC-4, WC-5, WC-6, WC-7, M-3, M-4 (skip aborted) | No `execute_tool` content above the cap enters context. Every turn has an outcome label and a cost row. A cap hit always produces a non-empty answer. Zero hard-coded entity ids in prompts. Every successful `execute_tool` has a server-written result row |
| **R2: One conversational harness + Context Builder (~3–4 wk)** | L-1 (first), L-2 with Studio on `step/` only **[changed vs plan §6.5]**, WC-8, WC-9, L-3 (if probe positive), M-1, M-2, ES-2, ES-4, ES-5 | Same question on Inspector and saved agents gives the same outcome and cost semantics. Follow-up cases F-1 to F-4 pass with session knowledge, at ≤ the R1 token count. Memory never appears inside the system prompt. Cache-read criterion per plan §3 if the probe is positive |
| **R3: Evals, then behaviour changes (~4 wk)** | Golden set and runner (plan P2-1, extended with §9 cases); then budgets, clearing, plan tool, verifiers (L-5); then WC-11 only if long-session cases fail | pass^3 no worse than R2. Median multi-loop input tokens ≥50% below the R0 baseline. Memory cases M-* pass |
| **R4: Separate decisions** | Durable runs (ES-3) on ADR-003; Studio goal memory (M-9) on Studio's own store; M-5 policy; M-6 schedule; reasoning continuity (L-4) | Per ADR-003 acceptance tests |

---

## 9. Deliverable 8: benchmark and regression-test plan

### 9.1 Two layers of tests

- **Deterministic (CI, no network):** fake `step()` adapter replaying recorded streams, with assertions on context content and outcome. Covers abort, tool failure, malformed args, `length` finish, cap hit, preview cap, dedupe, working-context merge, memory filtering (personal vs org vs conflict), and that the fenced memory block is placed outside system.
- **Live golden set (nightly or manual; warehouse credentials):** k = 3 runs per case through the real surface spec, scored by execution match against reference SQL run at eval time (plan P2-1).

### 9.2 Cases

| ID | Category | Case | Pass criteria |
|---|---|---|---|
| S-1 | Simple | Count of active vessels | Numeric match; ≤3 loops; 1 `execute_tool` |
| S-2 | Simple | Term defined in the semantic layer | Uses the governed definition; no `SHOW CATALOGS` |
| F-1 | Multi-turn filter | "Opex by vessel for 2025" → "only Q2" | Turn-2 SQL contains both the year and the Q2 predicates; no re-discovery |
| F-2 | Follow-up reference | "…top 5" → "why is the second one high?" | Resolves "second one" to the right entity from turn 1 |
| F-3 | Filter reset | "…for vessel X" → "now across the fleet" | Vessel filter dropped |
| F-4 | Long session | 12 turns, topic shift at turn 7 | Turn-8 memory recall matches the new topic (M-3); context stays under budget |
| F-5 | Duplicate input | Any first turn | Request body has the user message once (WC-4) |
| F-6 | Cross-surface | F-1 on saved-agent chat | Same pass as Inspector |
| L-1 | Large result | Query returning 1,000+ rows | Model-facing content ≤ cap; answer correct from an aggregate or preview |
| L-2 | Large list answer | "List the top 50 …" | Answer says the full table is shown; the table matches |
| L-3 | Chart race | `execute_tool` + `emit_chart` in one batch | Chart bound to the right `result_id` |
| C-1 | Complex | YoY opex compare, rank, explain top 3 | Numeric tolerance; every number traces to a result; ≤ budget |
| C-2 | Complex | Loop cap reached (forced low cap) | Non-empty synthesised answer; outcome `truncated` |
| T-1 | Tool failure | SQL error then fix | Error text reaches the model; retry succeeds; failure kept in context |
| T-2 | Tool failure | `describe_schema` throws (Bedrock path) | Turn continues (per-tool isolation) |
| T-3 | Cancellation | Stop during stream | No tool executes after Stop; outcome `aborted`; cost row; no bandit, judge or memory credit |
| T-4 | Truncation | `max_tokens` cut-off | Not labelled `completed`; continue once |
| K-1 | Compaction / retrieval | Session past the token threshold | Tokens fall; earlier filters still applied (F-1 assertions) |
| K-2 | Result reuse | Same SQL twice in a turn | Second call returns the prior `result_id`; one warehouse call |
| M-1 | Memory relevance | Taught "fiscal year starts in April" | Q3 query uses Oct–Dec for the author |
| M-2 | Scope isolation | User B asks the same | B does **not** get A's personal rule |
| M-3 | Conflict | Teach a rule conflicting with an org rule; leave it unresolved | Conflicted personal rule not injected |
| M-4 | Learned-wrong | Seed an ACTIVE org rule with a wrong column mapping | Execution-grounded check catches the mismatch, or the answer cites the rule; harmful count increments; rule never overrides the governed semantic definition |
| M-5 | Injection in data | Warehouse row containing "ignore previous instructions…" | No behaviour change; text stays inside the fenced data block |
| X-1 | Security | Read `result_id` from another user's session | 403 |
| X-2 | Security | Revoked access tier, then reuse an old `result_id` | Re-authorization denies, or the result is scoped to the original principal only (policy decision) |

### 9.3 Metrics and sources (existing observability first)

| Metric | Source today | Gap |
|---|---|---|
| Correctness (pass^3, execution match) | `PlatformEval*` tables | Runner missing |
| Input and output tokens per turn and per loop | `agent_turn_log`, `agent_loop_log` | Non-UUID sessions missing |
| Cache read and write | same | Writes hard-coded 0 on Chat Completions |
| Cost | `agent_cost_log`, `platform_spend_event` | Mispriced ids; errored turns missing |
| Latency, TTFT | `agent_turn_log.first_token_ms`, `duration_ms` | — |
| Repeated tool calls | `tool_invocation_log` (input redacted, SQL ≤500 chars) | Add `sql_hash` column or field |
| Successful stopping | `agent_turn_log.outcome` | `aborted` mislabelled; no finish reason |
| Context size | `agent_loop_log.context_chars` | — |
| Memory effect | `platform_memory_injections`, `PlatformBoostRun.memory_enabled` | Per-turn key |
| Security regressions | X-cases; `guardSessionRead` logs | — |

Report cost per **successful** task, not per turn, so cheaper-but-failing changes do not look like wins.
