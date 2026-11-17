# Agent architecture: issues by category, fix order and target design

**Status:** Design proposal (no code changed) · **Date:** 2026-11-07
**Builds on:** `reports/Agent context and memory architecture.md` (the "research report") and its evidence ledger, `research_notes/Agent loop research/context_memory_evidence_ledger.md`. E-ids point to ledger rows. Change ids (WC-, ES-, L-, M-) match the research report §5.2.
**Amends:** `docs/agent-runtime/plan.md`

This document answers four questions:

1. How does the agent work today? (§1)
2. What is wrong with it, grouped by category? (§2)
3. What should be fixed first, and why in that order? (§3)
4. What should the architecture look like, and how does each flaw get fixed? (§4 and §5)

---

## 1. How the current architecture works

### 1.1 The parts

| Part | Where | What it does |
|---|---|---|
| **Surfaces** | Inspector chat, saved-agent chat, Try it, workbench chat and test-run, Teach, semantic blueprint, refine-item, flows copilot, boost runner | Nine API routes that each start an agent run |
| **Loop bodies** | `src/lib/inspector/providers/foundry-chat.ts` (Chat Completions, used in production; xAI Responses), `src/lib/inspector/agent-loop.ts` (Bedrock Converse) | Three separate copies of the "call model → run tools → repeat" loop. Each behaves differently |
| **Gateway** | LLM Lite (LiteLLM) | Every Inspector model key resolves to a gateway model id (E-01) |
| **Tools** | `src/lib/inspector/tools.ts` | `describe_schema`, `execute_tool` (SQL through `runWarehouseQuery` → `authorizeSql` → tier role → Databricks), `emit_chart`, `export_query_result` |
| **Prompt** | `src/app/api/inspector/chat/route.ts:247-328` | One long system string: base prompt + semantic context + answer voice + all insights + session knowledge + memory rules. Then vector-recalled memory is inserted as a fake assistant message |
| **Session knowledge** | `src/lib/inspector/session-knowledge-*.ts` | A structured summary of the session (schema paths, entities, heuristics, last SQL, narrative summary), saved in `workbench_sessions.progress` after each turn. Inspector only |
| **Query results** | `studio_query_results` table | Written **by the browser**, which sends each result back to the server after seeing it |
| **Long-term memory** | `platform_agent_memory`, `src/lib/memory/*` | Rules learned from past sessions (synthesis, admin button) and from Teach. Read through `selectMemoryAll` when `MEMORY_INJECT_ENABLED` is on |
| **Telemetry** | `agent_turn_log`, `agent_loop_log`, `tool_invocation_log`, `agent_cost_log` | Timing, tokens and redacted tool calls. Useful for metrics; **cannot** be used to resume a turn |

### 1.2 One Inspector turn, step by step

```
 Browser                                   Server (/api/inspector/chat)                      Model / warehouse
 ───────                                   ────────────────────────────                      ─────────────────
 1. Sends the WHOLE transcript ──────────► 2. Builds history: no length cap; latest
    (latest message included twice)           user message merged twice
                                           3. Builds ONE system string:
                                              base + semantic + voice + ALL insights
                                              + session knowledge + memory rules
                                           4. Adds recalled memory as a fake
                                              "assistant" message (chosen from the
                                              session's FIRST message, not this one)
                                           5. Loop (up to 15 times):  ─────────────────────► model call
                                              • model asks for a tool ◄──────────────────── tool call
                                              • execute_tool runs SQL ─────────────────────► Databricks
                                              • FULL result JSON goes back to the model
                                                and is re-sent on every later loop
                                              • a copy (≤1000 rows) streams to the UI
                                              • Stop button only sets a flag; the loop
                                                keeps running and running tools
 7. Receives query_result events,       ◄── 6. Streams text + events
    POSTs each one to /api/studio/results
    (the only durable copy of the rows)
                                           8. Labels the outcome (abort can show as
                                              "completed"); records cost only for
                                              completed or truncated turns
                                           9. Updates session knowledge (may add
                                              hard-coded demo facts)
 10. Autosaves transcript every 2 s
```

### 1.3 Who owns which piece of state

| State | Owner today | Problem |
|---|---|---|
| Inspector transcript | Browser | Server trusts whatever the client sends |
| Query result rows | Browser (echoes them back) | Lost if the tab closes; missing on saved agents and non-UUID sessions; client-authored |
| Results during a turn | Server memory, one request | Gone when the request ends |
| Session knowledge | Server | Partly built from browser-written rows |
| Long-term memory | Server | Governance state (Teach conflicts) not checked when read |
| Telemetry | Server | Skipped for non-UUID sessions; not a checkpoint |

---

## 2. Issues by category

Severity:
- **Critical:** gives wrong answers, leaks data across users, or lets untrusted text act as instructions.
- **High:** wastes money or context at scale, or loses state.
- **Medium:** structural or observability debt that blocks safe change.
- **Low:** docs or cleanup.

### Category 1: Turn lifecycle and correctness

| # | Issue | Evidence | Severity | Effect for users |
|---|---|---|---|---|
| 1.1 | Stop does not stop. The production loop never checks the abort signal mid-stream or before tools | E-04 | **Critical** | SQL keeps running after the user presses Stop; tokens are spent |
| 1.2 | Aborted turns are labelled `completed` (Bedrock) or as a timeout (xAI) | E-27 | High | Wrong metrics; aborted turns credited to memory |
| 1.3 | Finish reasons are never read. A `max_tokens` cut-off counts as success | E-03, research §2.3 | High | Truncated answers shown as complete |
| 1.4 | Hitting the 15-loop cap gives no answer, just a canned "Tool-call limit reached" footer | E-07 | **Critical** | Long investigations end with nothing |
| 1.5 | Malformed tool arguments silently become `{}` and the tool still runs | E-06 | High | Wrong queries with no error |
| 1.6 | Bedrock loop runs tools in `Promise.all` without per-tool try/catch | research §2.3 | Medium | One failing tool kills the turn |

### Category 2: Context size and token efficiency

| # | Issue | Evidence | Severity | Effect |
|---|---|---|---|---|
| 2.1 | Full SQL result JSON (up to 1,000–10,000 rows) goes to the model and is re-sent on every later loop | E-02 | High | Context grows quadratically; cost and latency rise; cap hit sooner |
| 2.2 | Latest user message sent twice | E-05 (confirm at runtime) | Medium | Wasted tokens; odd emphasis |
| 2.3 | Inspector history has no cap | E-08 | High | Long sessions grow without limit |
| 2.4 | All insights for the session are pasted in, uncapped | E-10 | Medium | Prompt grows with every analysis |
| 2.5 | No prompt caching on the production path; xAI uses a random cache key per run | research §2.3 | Medium | Static prefix paid in full every loop |

### Category 3: State ownership and persistence

| # | Issue | Evidence | Severity | Effect |
|---|---|---|---|---|
| 3.1 | Query rows are saved only when the browser sends them back | E-21 | High | Lost results; no server-side handle to reference |
| 3.2 | `studio_query_results` has no `turn_id`, principal, `statement_id` or SQL hash | E-22 | High | Cannot tie a result to who was authorized to see it, or to the turn |
| 3.3 | `emit_chart` charts "the last result" in memory, which races with `execute_tool` in the same batch | E-23 | Medium | Wrong chart |
| 3.4 | Saved-agent chat saves concatenated interim narration as the reply | E-18 | Medium | Follow-ups replay noise |
| 3.5 | Logs cannot reconstruct or resume a turn (no assistant messages, full outputs or turn-to-message link) | research §3.3 | Medium | Blocks durable runs; must not be treated as checkpoints |

### Category 4: Follow-up continuity (working context)

| # | Issue | Evidence | Severity | Effect |
|---|---|---|---|---|
| 4.1 | **Hard-coded demo facts** (vessels 60/78, fixed tables, "was validated") are injected as confirmed facts on substring matches | E-14 | **Critical** | False facts presented as verified, in any matching session |
| 4.2 | Entity names copied from warehouse rows into the system prompt as "confirmed … do not re-discover" | E-15 | High | Untrusted data gets instruction weight (injection path) |
| 4.3 | Earlier filters are lost: answers omit SQL by design, history is text only, and only the last SQL (≤1,200 chars) survives | E-16 | High | "Same, but only Q2" may drop the year filter |
| 4.4 | Saved agents have no session knowledge at all | research §3.2 | Medium | Weaker follow-ups than the Inspector |

### Category 5: Long-term memory governance and safety

| # | Issue | Evidence | Severity | Effect |
|---|---|---|---|---|
| 5.1 | Taught rules are `ACTIVE` immediately, even though the tool says they stay a candidate | E-30 | High | Unreviewed rules affect answers |
| 5.2 | Retrieval ignores Teach conflict and rejection state | E-31 | **Critical** | A rule known to conflict is still injected |
| 5.3 | Synthesized org rules go `ACTIVE` org-wide without human review | E-33 | High (owner decision) | One bad trace can change everyone's answers |
| 5.4 | Memory is injected as system instructions (`OPERATING MEMORY`) plus a fake assistant message | E-36 | **Critical** | LLM-extracted text, partly from warehouse output, acts with instruction authority (Studio risk S13) |
| 5.5 | Recall is chosen from the session's first message on every turn | E-32 | High | Topic changes get the wrong memory |
| 5.6 | Attribution is weak: a heuristic success score, aborted turns credited, keyed by session so later turns are ignored | E-37 | Medium | Memory reputation drifts |
| 5.7 | Synthesis and TTL expiry run only when an admin clicks a button; the referenced script is missing | E-34, E-35 | Medium | Stale rules stay live |

### Category 6: Code structure and testability

| # | Issue | Evidence | Severity | Effect |
|---|---|---|---|---|
| 6.1 | Three loop copies with different abort, caching, stop and error behaviour | E-41, research §2.3 | Medium | Every fix must be made three times |
| 6.2 | Nine callers; per-surface policy mixed into the loops | E-41 | Medium | Hard to reason about |
| 6.3 | Zero unit tests for any loop; the client is built inside the loop, so it cannot be faked | E-40 | High | Any refactor is risky |
| 6.4 | Existing plan (§6.5) would make Business AI Studio wrap the conversational harness, against Studio's own boundary | E-42 | Medium | Couples two products that must stay independent |

### Category 7: Observability and cost

| # | Issue | Evidence | Severity | Effect |
|---|---|---|---|---|
| 7.1 | Cost recorded only for completed and truncated turns | E-09 | High | Errored and aborted spend is invisible |
| 7.2 | Unknown gateway model ids priced as Sonnet; `toolCalls = loops - 1` | E-09 | Medium | Cost and tool counts wrong |
| 7.3 | Turn metrics skipped for non-UUID sessions | E-25 | Medium | Blind spot |
| 7.4 | No finish reason, request id or cost on turn logs; cache-write tokens hard-coded to 0 | research §3.3, §9.3 | Medium | Cannot diagnose stops or caching |
| 7.5 | No eval runner (tables exist) | research §4 | High | No way to prove a change did not hurt answers |

### Category 8: Documentation drift

| # | Issue | Evidence | Severity |
|---|---|---|---|
| 8.1 | `docs/AI-AGENT-MEMORY.md` describes Bedrock as primary, 8 loops and an overnight memory loop; none of it is true | E-39 | Low |
| 8.2 | `scripts/memory/synthesize.ts` is referenced but missing | E-34 | Low |

**Count:** 38 issues: 5 Critical, 15 High, 16 Medium, 2 Low.

---

## 3. What to fix first

The order follows three rules:

1. Stop wrong or unsafe answers before saving money.
2. Make the server own state before building anything on top of it.
3. Add tests before restructuring.

### Wave 0: Verify (2–4 days, read-only)

Run research report questions Q1–Q4, Q8 and Q9 and the gateway probe. They decide whether the memory issues are live in production, how many results the browser drops, whether the duplicate message is real, and whether the gateway supports caching and `tool_choice: 'none'`. Every query is `SELECT`-only through a CLI OAuth profile.

### Wave 1: Stop wrong and unsafe answers (about 1 week, small diffs)

All of these are local fixes with no schema change. Each can ship behind its own flag.

| Order | Fix | Issues closed | Why now |
|---|---|---|---|
| 1 | Delete the hard-coded vessel, table and "validated" facts from session knowledge | 4.1 | False facts today; pure deletion |
| 2 | Exclude Teach candidates in `conflict` or `rejected` from retrieval; mark unverified ones | 5.2, part of 5.1 | Known-bad rules are injected today; one join |
| 3 | Real abort: pass the `AbortSignal` into the request, check it in the stream and before each tool batch; add an `aborted` outcome | 1.1, 1.2 | Tools keep running after Stop |
| 4 | Read finish reasons; on `length`, continue once or label truncated | 1.3 | Truncated answers reported as complete |
| 5 | On the loop cap, make one tools-off wrap-up call that answers from gathered evidence | 1.4 | Users get nothing today |
| 6 | Malformed tool args return an error to the model instead of `{}`; per-tool try/catch on Bedrock | 1.5, 1.6 | Silent wrong queries |
| 7 | Send the latest user message once; key memory recall to the current message | 2.2, 5.5 | Tiny diffs |
| 8 | Record cost for every outcome; skip aborted and errored turns in attribution | 7.1, part of 5.6 | Money and memory reputation |

**Exit:** Stop prevents further tool calls; every turn has a truthful outcome and a cost row; a cap hit always gives a non-empty answer; no hard-coded entity ids reach any prompt.

### Wave 2: Server-owned results and bounded context (about 1.5–2 weeks)

| Order | Fix | Issues closed |
|---|---|---|
| 9 | `execute_tool` writes `studio_query_results` on the server, with new columns `turn_id`, `principal_id`, `statement_id` and `sql_hash` (one additive migration). The browser POST becomes an idempotent no-op | 3.1, 3.2 |
| 10 | Model gets a preview (columns, row count, first N rows under a char cap) plus a `result_id`. `emit_chart` and `export` take `result_id` | 2.1, 3.3 |
| 11 | Apply `historyForModel` (30 messages / 60k chars) to the Inspector; cap insights | 2.3, 2.4 |
| 12 | `turn_id` on the SSE `done` event, transcript messages and result rows; metrics for non-UUID sessions; correct pricing ids and tool counts | 7.2, 7.3, part of 7.4 |
| 13 | Saved agents save `finalText`, not concatenated narration | 3.4 |

**Exit:** no tool content above the cap enters context; every successful `execute_tool` has a server-written row tied to its principal and turn.

### Wave 3: One clean harness and one Context Builder (about 3–4 weeks)

| Order | Fix | Issues closed |
|---|---|---|
| 14 | `step()` interface with a fake adapter, plus characterization tests of current behaviour | 6.3 |
| 15 | Move the three providers behind `step()`; build `runAgentTurn` for conversational surfaces, with per-surface `TurnSpec` | 6.1, 6.2 |
| 16 | Context Builder: one function that assembles static prefix + dynamic data blocks with budgets; working context v2 with `activeFilters` (parsed from SQL) and `recentResults` (refs) | 4.3 |
| 17 | Memory and session entities go in a fenced **data** block, never in the system prompt; drop the fake assistant message | 5.4, 4.2 |
| 18 | Saved agents use the same working context | 4.4 |
| 19 | Studio wraps `step()` through its own `ModelGateway`; it does not wrap `runAgentTurn` | 6.4 |
| 20 | Cache-friendly layout (if the gateway probe is positive) | 2.5 |
| 21 | Attribution keyed by `turn_id` | rest of 5.6 |

### Wave 4: Evals, then behaviour changes (about 4 weeks)

Build the golden set and runner (research report §9), then consider budgets, tool-result clearing, a plan tool, verifiers and compaction, **only** where the evals show a need. Closes 7.5.

### Wave 5: Owner decisions (separate go/no-go)

- Synthesized org rules: review queue instead of `ACTIVE` (5.3).
- Teach rules: candidate until verified (rest of 5.1).
- Schedule the synthesis and refine sweep, or document it as manual (5.7).
- Durable runs on ADR-003 (3.5).
- Fix the stale docs and the missing script reference (8.1, 8.2). This can be done any time.

---

## 4. Target architecture

### 4.1 Principles

1. **The server owns state.** Results, working context and outcomes are written by the server. The browser displays them.
2. **Data is not instructions.** Only the static prompt is system authority. Memory, session facts and tool output go in fenced data blocks.
3. **One turn lifecycle.** Abort, stop reasons, wrap-up, outcome labels, cost and metrics are implemented once.
4. **Policy per surface, mechanism shared.** Surfaces differ only in a `TurnSpec` (tools, history source, caps, hooks).
5. **Shared providers, separate products.** Studio shares the provider `step()` layer, never the conversational harness.
6. **Telemetry is not a checkpoint.** Durable execution gets its own store when it is built.
7. **Memory is governed when read,** not only when written.

### 4.2 Layers

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ SURFACES (thin API routes)                                                           │
│ Inspector · Saved agents · Try it · Workbench · Teach · Boost · Blueprint · Copilot  │
│   each builds a TurnSpec { tools, historySource, caps, contextSources, hooks }       │
└───────────────┬──────────────────────────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────── turn/ (conversational layer) ─────────────┐
│ runAgentTurn(spec, input, signal)                                                    │
│   ├─ ContextBuilder ── static prefix (cacheable) │ dynamic data blocks (fenced)      │
│   │     sources: semantic · WorkingContext · MemoryPort · capped history             │
│   ├─ loop: step() → ToolExecutor → step() …  (abort-aware, cap → wrap-up call)       │
│   ├─ ToolExecutor: arg validation · per-tool isolation · dedupe · ResultStore write  │
│   └─ TurnOutcome { completed | truncated | aborted | errored, finishReason, cost }   │
└───────┬───────────────┬──────────────────┬─────────────────┬─────────────────────────┘
        │               │                  │                 │
┌───────▼──────┐ ┌──────▼───────┐ ┌────────▼───────┐ ┌───────▼──────────────────────────┐
│ ResultStore  │ │WorkingContext│ │ MemoryPort     │ │ Telemetry                        │
│ studio_query_│ │ progress.    │ │ (read-only,    │ │ turn/loop/tool/cost logs,        │
│ results      │ │ inspector-   │ │  governed)     │ │ keyed by turn_id                 │
│ (server      │ │ Knowledge v2 │ │ platform_agent │ │ (not checkpoints)                │
│  written)    │ │              │ │ _memory + teach│ │                                  │
└──────────────┘ └──────────────┘ └────────────────┘ └──────────────────────────────────┘
                │
┌───────────────▼─────────────────────────── step/ (shared provider layer) ────────────┐
│ step(StepRequest) → StepResult                                                       │
│   chat-completions · responses · converse · fake (tests)                             │
└───────────────┬───────────────────────────────────────▲──────────────────────────────┘
                │                                       │
          LLM Lite gateway                 Business AI Studio ModelGateway
                                           (own loop, budgets, checkpoints;
                                            reads MemoryPort/SemanticPort only)
```

### 4.3 Module layout

```
src/lib/agent-runtime/
  step/
    types.ts              StepRequest, StepResult, FinishReason
    chat-completions.ts   from foundry-chat.ts:406-684
    responses.ts          from foundry-chat.ts:189-402
    converse.ts           from agent-loop.ts:120-347
    fake.ts               replays recorded streams for tests
  turn/
    run-agent-turn.ts     loop, abort, wrap-up, outcome, cost, metrics
    turn-spec.ts          per-surface policy type
    context-builder.ts    ordered, budgeted static + dynamic blocks
    tool-executor.ts      validation, isolation, dedupe, result write, preview
    history.ts            shared historyForModel
  state/
    result-store.ts       server write/read of studio_query_results by result_id + principal
    working-context.ts    extends session-knowledge-core (v2 fields)
  memory/
    memory-port.ts        wraps selectMemoryAll with read-time governance
```

Existing pure logic (session-knowledge merge and format, `selectMemoryAll`, `buildSemanticContext`, `historyForModel`) moves or is wrapped. None of it is rewritten.

### 4.4 Key interfaces (sketch)

```ts
// step/types.ts
type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'aborted' | 'error';
interface StepRequest {
  model: string;
  staticSystem: string;            // cacheable, instructions only
  contextBlocks: ContextBlock[];   // fenced data, after the static prefix
  messages: ChatMessage[];
  tools: ToolSpec[] | 'none';      // 'none' for the wrap-up call
  limits: { maxOutputTokens: number };
  signal: AbortSignal;
}
interface StepResult {
  text: string;
  toolCalls: ToolCall[];
  reasoningState?: unknown;        // provider-specific; opaque to callers
  finishReason: FinishReason;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

// turn/turn-spec.ts
interface TurnSpec {
  surface: 'inspector' | 'saved_agent' | 'try_it' | 'workbench' | 'teach' | 'boost' | ...;
  tools: ToolSpec[];
  maxLoops: number;
  history: (ctx) => Promise<ChatMessage[]>;       // shared cap policy
  contextSources: ContextSource[];                 // semantic, workingContext, memory, insights
  afterTurn?: (outcome: TurnOutcome) => Promise<void>;
}

// turn/run-agent-turn.ts
interface TurnOutcome {
  turnId: string;
  status: 'completed' | 'truncated' | 'aborted' | 'errored';
  finishReason: FinishReason;
  finalText: string;               // never empty on truncated (wrap-up)
  resultIds: string[];
  costUsd: number;                 // always recorded
  loops: number; toolCalls: number;
}

// state/working-context.ts  (extends InspectorSessionKnowledge, version 2)
interface WorkingContextV2 extends InspectorSessionKnowledge {
  version: 2;
  activeFilters: { column: string; op: string; value: string; fromTurn: string }[]; // parsed from SQL, never LLM
  recentResults: { resultId: string; sqlHash: string; columns: string[]; rowCount: number; turnId: string }[]; // last 5
}

// memory/memory-port.ts
interface MemoryPort {
  select(scope: { principalId: string; orgId: string; query: string /* current turn */ }):
    Promise<{ rules: MemoryRule[]; unverified: MemoryRule[] }>; // conflict/rejected excluded
}
```

### 4.5 The same Inspector turn in the target design

1. The browser sends the new user message and `sessionId` (the transcript format is unchanged for now).
2. The server builds history with the shared cap and sends the message once.
3. The Context Builder produces:
   - a static system prefix (base, semantic, answer voice);
   - one data message with fenced blocks for working context (filters, recent result refs), capped insights and memory (governed, chosen from the current message).
4. `runAgentTurn` loops over `step()`. Each `execute_tool` writes the full result to the ResultStore under the caller's principal and turn, and returns a preview plus `result_id`. Charts and exports use `result_id`.
5. On Stop, the signal cancels the model request and no further tools run. On the loop cap, one tools-off call writes the answer.
6. `TurnOutcome` is recorded with finish reason and cost. Working context v2 is updated from the executed SQL. Memory attribution uses `turn_id` and skips aborted turns.

---

## 5. Every issue mapped to its fix

| Issue | Fix in target design | Component | Wave | Change id |
|---|---|---|---|---|
| 1.1 Stop doesn't stop | `AbortSignal` into `step()`; check before tool batch | `step/*`, `run-agent-turn` | 1 | ES-1 |
| 1.2 Abort mislabelled | `aborted` status in `TurnOutcome` | `run-agent-turn` | 1 | ES-1 |
| 1.3 Finish reason ignored | `StepResult.finishReason`; continue once on `length` | `step/*` | 1 | ES-1 |
| 1.4 No answer at cap | Tools-off wrap-up call | `run-agent-turn` | 1 | ES-1 |
| 1.5 Bad args → `{}` | Schema validation returns error to model | `tool-executor` | 1 | ES-1 |
| 1.6 No per-tool isolation | try/catch per tool | `tool-executor` | 1 | ES-1 |
| 2.1 Full results inlined | Preview + `result_id` | `tool-executor`, `result-store` | 2 | WC-1, WC-2 |
| 2.2 Duplicate message | Send once | `useInspectorChat.ts` | 1 | WC-4 |
| 2.3 History uncapped | Shared `historyForModel` | `turn/history` | 2 | WC-5 |
| 2.4 Insights uncapped | Budget in Context Builder | `context-builder` | 2 | WC-6 |
| 2.5 No caching | Static prefix / dynamic split | `context-builder` | 3 | L-3 |
| 3.1 Client-written rows | Server write in `execute_tool` | `result-store` | 2 | WC-1 |
| 3.2 No principal/turn on results | Additive columns | migration | 2 | WC-1 |
| 3.3 Chart race | Chart by `result_id` | `tools.ts` | 2 | WC-2 |
| 3.4 Narration saved as reply | Save `finalText` | agents chat route | 2 | — |
| 3.5 Logs not checkpoints | Keep as telemetry; durable store later | ADR-003 | 5 | ES-3 |
| 4.1 Hard-coded facts | Delete | `session-knowledge-core.ts` | 1 | WC-7 |
| 4.2 Warehouse text as confirmed fact | Fenced data block | `context-builder` | 3 | WC-8, M-2 |
| 4.3 Filters lost | `activeFilters` parsed from SQL | `working-context` | 3 | WC-8 |
| 4.4 No context on saved agents | Same working context | `TurnSpec` | 3 | WC-9 |
| 5.1 Teach rules live immediately | Mark unverified now; candidate-until-verified is an owner decision | `memory-port` | 1 / 5 | M-1 |
| 5.2 Conflicts ignored | Exclude `conflict`/`rejected` | `memory-port` | 1 | M-1 |
| 5.3 Synthesis auto-ACTIVE | Review queue | `curate.ts` | 5 | M-5 |
| 5.4 Memory as instructions | Fenced data block, no fake assistant turn | `context-builder` | 3 | M-2 |
| 5.5 First-message recall | Current message | `memory-port` | 1 | M-3 |
| 5.6 Weak attribution | Skip aborted (W1); key by `turn_id` (W3) | `attribution.ts` | 1 / 3 | M-4 |
| 5.7 Manual sweep | Schedule or document | infra / docs | 5 | M-6 |
| 6.1 Three loop copies | One `runAgentTurn` over `step()` | `turn/`, `step/` | 3 | L-2 |
| 6.2 Policy in loops | `TurnSpec` | `turn-spec` | 3 | L-2 |
| 6.3 No tests / no seam | `step()` + fake + characterization tests | `step/fake` | 3 (first) | L-1 |
| 6.4 Studio coupling | Studio wraps `step()` only | Studio `ModelGateway` | 3 | L-2 |
| 7.1 Missing cost rows | Cost on every outcome | `run-agent-turn` | 1 | ES-1 |
| 7.2 Wrong pricing/tool counts | Gateway id map; count real calls | `log-agent-cost.ts` | 2 | ES-1 |
| 7.3 Non-UUID metrics skipped | Always record with `turn_id` | `record-turn-metrics.ts` | 2 | ES-1 |
| 7.4 No finish reason/cache writes | Add fields | telemetry | 2–3 | ES-2 |
| 7.5 No eval runner | Golden set + runner | evals | 4 | — |
| 8.1 Stale memory doc | Rewrite to match code | docs | any | M-6 |
| 8.2 Missing script reference | Remove or add the script | `run-sweep.ts` | any | — |

### 5.1 Deliberately not changed

| Proposal | Decision | Reason |
|---|---|---|
| Second memory store or vector database | Reject | pgvector, `platform_agent_memory` and `progress` cover every need found |
| LangGraph or another agent framework | Reject | No evidence of benefit; adds dependency surface (ADR-004) |
| Jev-style progress scorer | Reject for now | No closed-choice decision to score, no labelled data, ADR-004 gate unmet |
| Moving the Inspector transcript server-side | Defer | API change with low measured need; revisit with durable runs |
| Team memory scope, goal memory | Defer | No demonstrated requirement; goal memory is Studio-owned |
| Budgets, compaction, plan tool, verifiers | Defer to Wave 4 | They change behaviour; only evals can show they help |

---

## 6. Risks of the fixes

| Risk | Mitigation |
|---|---|
| Previews make list answers worse ("top 50") | Preview cap is an env setting; prompt says the user sees the full table; cases L-1 to L-3 |
| Removing hard-coded facts changes demo answers | Intended; check demo scripts beforehand |
| Excluding conflicted rules changes some users' answers | Intended; run Q9 first to size it |
| Refactor without tests | Wave 3 starts with characterization tests; per-surface flags; no shadow runs (they would run SQL twice) |
| Double writes while moving result writes server-side | Browser POST becomes idempotent on `(session_id, sql_hash, turn_id)` |
| Memory moved out of the system prompt is followed less | Regression cases M-1 to M-5 before switching the flag |
