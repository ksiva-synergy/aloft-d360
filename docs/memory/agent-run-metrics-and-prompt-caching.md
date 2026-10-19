# Agent Run Metrics & Prompt Caching

> **What this covers.** How Aloft records what an agent turn *cost* and *where its time went* —
> turn timing, model-vs-tool time per loop, prompt-cache hits, and context growth — and how the
> run detail page (`/agent-lab/runs/[sessionId]`) turns that into something readable.
> Also explains prompt caching: what is cached today, per provider, and what is proposed.
>
> **Related docs:** [../agent-ops-build-plan.md](../agent-ops-build-plan.md) (Agent Ops overview),
> [../AI-AGENT-MEMORY.md](../AI-AGENT-MEMORY.md) (FOER trace graph),
> [../inspector-context-modes.md](../inspector-context-modes.md).

**Status (2026-10-17)**

| Piece | Status |
|---|---|
| Server-side turn + loop metrics (`agent_turn_log`, `agent_loop_log`) | ✅ Built — migration applied 2026-10-17 (prod `aloftdb`) |
| Cache-aware cost (`computeCostUsd`) | ✅ Built |
| Run detail page: insights, turn story, waterfall, loop breakdown | ✅ Built |
| Bedrock prompt caching for Inspector chat | 🟡 Proposed — not enabled (see [§6](#6-proposed-bedrock-prompt-caching-for-inspector-chat)) |

---

## 1. Why this exists

Before this work, the run page could not answer basic questions:

- **"Turn time 0ms."** Turn timing (`turnOps`) was built only in the browser
  ([`useInspectorChat.ts`](../../src/hooks/useInspectorChat.ts)) and saved inside the chat message. If the
  message wasn't saved after streaming, the timing was lost.
- **No model-vs-tool split.** Only tool durations were logged; model "thinking" time was invisible.
- **Cost ignored caching.** Every input token was priced at the full rate, even when the provider
  served it from cache.
- **No context size.** A run with 256k input tokens and 3k output tokens is dominated by context
  re-sent each loop, but nothing showed how that context grew.

All of these are now measured **on the server**, independent of the browser.

---

## 2. Key concepts

| Term | Meaning |
|---|---|
| **Session** | One chat (`workbench_sessions.id`). Contains many turns. |
| **Turn** | One user message → the agent's final answer. Identified by a server-generated `turn_id`. |
| **Loop** | One LLM call inside a turn. The model either requests tools (→ another loop) or answers (→ turn ends). |
| **Tool call** | One tool execution (`describe_schema`, `execute_tool`, …) requested by a loop. Parallel within a loop. |
| **Context** | Everything sent to the model on a loop: tools + system prompt + conversation so far. Grows every loop. |
| **Prompt cache** | Provider-side reuse of an identical request prefix — cheaper and faster input. See [§5](#5-prompt-caching-explained). |

```
Turn (agent_turn_log)
 ├─ Loop 1 (agent_loop_log)   model 1.2s ──► tools: describe_schema ×6 (1.4s)
 ├─ Loop 2                    model 0.9s ──► tools: execute_tool ×2 (4.3s)
 └─ Loop 3                    model 2.1s ──► answer (stop_reason = end_turn)
```

---

## 3. What is recorded

### 3.1 `agent_turn_log` — one row per turn

| Column | Meaning |
|---|---|
| `turn_id` | Unique per request. Also written to `tool_invocation_log.run_id` so tool rows link to their turn. |
| `session_id`, `surface` | Session and where it ran (`inspector` / `workbench`). |
| `model` | Effective model id (after any fallback). |
| `started_at`, `duration_ms` | Request received → turn finished (server wall clock). |
| `first_token_ms` | Request received → first streamed text chunk (user-perceived TTFT). |
| `llm_ms` / `tool_ms` | Sum of model time / tool-batch time across loops. Remainder = "other" (prompt build, scoring). |
| `loops`, `tool_calls`, `tool_errors` | Counts. |
| `input_tokens`, `output_tokens` | Totals. **Input includes cached tokens** (normalized across providers). |
| `cache_read_tokens`, `cache_write_tokens` | Portion of input served from / written to the prompt cache. |
| `peak_context_chars` | Largest context sent in any loop. |
| `outcome`, `error` | `completed` / `truncated` / `errored` / `aborted`. |

### 3.2 `agent_loop_log` — one row per LLM call

| Column | Meaning |
|---|---|
| `turn_id`, `loop` | Which turn, which loop (1-based). |
| `started_at`, `llm_ms` | Request sent → stream finished. |
| `first_token_ms` | Request sent → first streamed token (text, reasoning or tool call). |
| `tool_ms` | Wall time of the tool batch this loop triggered. Parallel calls overlap, so this can be less than the sum of individual call durations. |
| `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` | Per-call usage (input includes cached). |
| `context_messages`, `context_chars` | Size of the conversation sent on this call. ÷4 ≈ tokens. |
| `tool_calls`, `stop_reason` | `tool_use` / `end_turn` / `max_loops` / `aborted`. |

### 3.3 Existing tables these join with

| Table | Role | Note |
|---|---|---|
| `tool_invocation_log` | Every tool call: input, output, duration, status | `run_id` now = `turn_id`. **Sampled** if `AGENT_OPS_SAMPLE_SUCCESS_RATE` < 1 (errors always logged). `input_tokens`/`output_tokens` columns exist but are never written. |
| `agent_cost_log` | One row per Inspector turn, `run_id` = session id | Now includes `duration_ms` and cache-aware `cost_usd`. Workbench does not write cost rows. |
| `bandit_observations` | Quality scores (C/T/S/G/V) and tool trajectory | Used as a fallback source of tool rows for older sessions. |

---

## 4. How it is recorded

### 4.1 Data flow

```
POST /api/inspector/chat  (or /api/agent-lab/workbench/chat)
 │
 ├─ new TurnMetricsRecorder({ sessionId, surface })        → turn_id, start clock
 │
 ├─ runAgentLoop / runFoundryAgentLoop(loopParams)
 │    each loop:
 │      measureContext(system, messages)                    → context size
 │      call model, stream                                  → llm_ms, first_token_ms,
 │                                                             tokens, cache tokens
 │      run tools in parallel                               → tool_ms
 │      onLoopMetrics(metrics) ──► recorder.addLoop()
 │
 │    executeTool → withAgentOpsToolLog({ runId: turn_id }) → tool_invocation_log
 │    onTextChunk ──► recorder.markFirstToken()
 │
 ├─ logAgentCost({ ...recorder.tokenTotals(), durationMs }) → agent_cost_log
 │
 └─ recorder.flush({ outcome, toolCalls, toolErrors })      → agent_turn_log
                                                               + agent_loop_log (one transaction)
```

`flush()` runs on every exit path — completed, truncated, errored, client abort, and the route's
`catch`. It is fire-and-forget and swallows DB errors, so **chat never breaks** if the tables are missing.

### 4.2 Code map

| File | Responsibility |
|---|---|
| [`src/lib/inspector/agent-loop.ts`](../../src/lib/inspector/agent-loop.ts) | `LoopMetrics` type, `measureContext()`, `onLoopMetrics` callback; Bedrock loop instrumentation. |
| [`src/lib/inspector/providers/foundry-chat.ts`](../../src/lib/inspector/providers/foundry-chat.ts) | Same instrumentation for Foundry / xAI / OpenAI-compatible models (Grok, GPT). |
| [`src/lib/agent-ops/record-turn-metrics.ts`](../../src/lib/agent-ops/record-turn-metrics.ts) | `TurnMetricsRecorder` — collects loops, writes both tables. |
| [`src/app/api/inspector/chat/route.ts`](../../src/app/api/inspector/chat/route.ts) | Wires the recorder into Inspector chat; cache-aware cost log. |
| [`src/app/api/agent-lab/workbench/chat/route.ts`](../../src/app/api/agent-lab/workbench/chat/route.ts) | Wires the recorder into Workbench chat. |
| [`src/lib/lifecycle/log-agent-cost.ts`](../../src/lib/lifecycle/log-agent-cost.ts) | Pricing table, cache rates, `computeCostUsd()`. |
| [`src/lib/agent-ops/session-cockpit.ts`](../../src/lib/agent-ops/session-cockpit.ts) | Builds the run page payload; matches turn rows to turns; fills `turnOps` from server data when missing. |
| [`src/app/api/agent-lab/runs/[sessionId]/route.ts`](../../src/app/api/agent-lab/runs/[sessionId]/route.ts) | Loads all tables for a session (turn/loop queries return `[]` if tables don't exist). |
| [`prisma/migrations/20261017_agent_turn_loop_log/`](../../prisma/migrations/20261017_agent_turn_loop_log/migration.sql) | Creates the two tables. |

### 4.3 Provider differences handled

| Concern | Bedrock (Claude) | OpenAI-compatible (Grok, GPT via Foundry/xAI) |
|---|---|---|
| Usage field | `metadata.usage.inputTokens` **excludes** cache tokens | `usage.prompt_tokens` **includes** cached tokens |
| Cache fields | `cacheReadInputTokens`, `cacheWriteInputTokens` | `prompt_tokens_details.cached_tokens` (no write count) |
| Normalization | metrics `inputTokens = inputTokens + cacheRead + cacheWrite` | used as-is |
| First token | first `contentBlockDelta` / `contentBlockStart` | first delta with `content` or `tool_calls` |

### 4.4 Matching turns on the run page

Chat messages and server rows are joined in `buildSessionCockpit`:

1. A turn row belongs to the chat turn whose window (user message timestamp → next user message)
   contains its `started_at`. Each row is used at most once.
2. Tool rows with `run_id` = that `turn_id` are attached to the turn exactly; rows without one fall back
   to timestamp windows (older data).
3. If the chat message has no `turnOps`, one is synthesized from the server row — so duration, tokens,
   loops and outcome appear everywhere the UI already used `turnOps`.

---

## 5. Prompt caching explained

### 5.1 What it is

The provider remembers the processed **beginning** of a request. If the next request starts with the
**exact same** text, those tokens are billed at a discount and the first token arrives sooner. It is
prefix-only: one changed character ends the match.

### 5.2 Anatomy of an Inspector request

```
┌─ tools list ──────────────────────────────┐  stable
├─ system prompt ───────────────────────────┤
│  base prompt + org semantic catalog       │  stable (per org / connection)
│  session insights                         │  changes per turn
│  session knowledge                        │  changes per turn
│  memory rules (P0 / P1a)                  │
├─ conversation ────────────────────────────┤
│  earlier turns (+ P1b task-scoped recall) │
│  this turn: user msg → tool calls →       │  grows every loop
│  tool results → tool calls → …            │
└───────────────────────────────────────────┘
```

Inside one turn, loop *N* re-sends everything loop *N-1* sent plus new tool results. That is why
agent runs are input-heavy (e.g. 256k in / 3k out) — and why caching matters.

System prompt assembly: [`route.ts`](../../src/app/api/inspector/chat/route.ts) builds
`[basePrompt, insightsContext, sessionKnowledgeContext]`, then appends memory blocks.

### 5.3 What is cached today

| Model path | Caching | What is cached |
|---|---|---|
| **Grok / GPT** (Foundry, xAI) | ✅ Automatic, provider-side | The longest identical prefix — tools, system prompt, earlier loops. No code needed. We now **read** `cached_tokens` so the hit rate is visible. |
| **Claude on Bedrock — Inspector chat** | ❌ Off | Nothing. Bedrock caches only where the request contains a `cachePoint`. |
| **Claude on Bedrock — semantic blueprint** | ✅ System prompt | [`blueprint/route.ts`](../../src/app/api/inspector/semantic/[modelId]/blueprint/route.ts) passes `cacheSystemPrompt: true`. |

The opt-in switch is `AgentLoopParams.cacheSystemPrompt` in
[`agent-loop.ts`](../../src/lib/inspector/agent-loop.ts): it appends `{ cachePoint: { type: 'default' } }`
after the system prompt. Below the model's minimum cacheable size it is silently ignored.

### 5.4 How cost is calculated

`computeCostUsd(model, inputTokens, outputTokens, { readTokens, writeTokens })`:

```
fresh = inputTokens − readTokens − writeTokens
cost  = fresh × inPrice
      + readTokens  × inPrice × rate.read
      + writeTokens × inPrice × rate.write
      + outputTokens × outPrice
```

| Family | `rate.read` | `rate.write` |
|---|---|---|
| `claude*` | 0.10 | 1.25 |
| `grok*` | 0.25 | 1.00 |
| `deepseek*` | 0.10 | 1.00 |
| others (OpenAI-style) | 0.50 | 1.00 |

These are approximate list-price ratios kept in `cacheRates()` — **verify against current provider
pricing** and update in one place. Models missing from `MODEL_PRICING` fall back to `claude-sonnet-4`
($3 / $15 per M) — currently true for `grok-4.7`.

---

## 6. Proposed: Bedrock prompt caching for Inspector chat

**Not implemented.** It changes what Claude runs are billed, so it needs an explicit decision.

### 6.1 The change

1. **Cache the stable prefix** — pass `cacheSystemPrompt: true` in Inspector's `loopParams`.
   Tools + system prompt are then read at 10% on every loop after the first.
2. **Moving cache marker on the conversation** — on each loop, add a `cachePoint` after the last
   message. Loop *N* writes its context; loop *N+1* reads all of it and pays full price only for the
   new tool results. This is the bigger win because history is the part that grows.
3. **Optional, all providers** — move memory rules above session insights / knowledge so the stable
   prefix is longer and is reused across turns, not just within one.

### 6.2 Expected effect (illustrative)

8 loops, context growing 20k → 60k tokens, ~320k input total, $3 / M input:

| | Input cost |
|---|---|
| No cache | 320k × $3/M ≈ **$0.96** |
| With both markers | ~260k read @ 10% + ~60k written @ 125% ≈ **$0.30** (~70% less) |

Plus lower time-to-first-token on later loops.

### 6.3 Trade-offs and limits

- Cache **writes** cost 25% more — a single-loop turn (no tools) gets slightly more expensive.
- Cache lifetime is ~5 minutes: always fine within a turn; follow-ups only hit if quick.
- Max 4 `cachePoint` markers per request; minimum cacheable size ~1k tokens (smaller = no-op, no error).
- Supported on Claude (and Nova) models on Bedrock only.
- Measure before/after with the **Prompt cache** card and `agent_turn_log.cache_read_tokens`.

---

## 7. Run detail page

Route: `/agent-lab/runs/[sessionId]` → [`SessionCockpit.tsx`](../../src/components/agent-ops/SessionCockpit.tsx),
components in [`src/components/agent-ops/cockpit/`](../../src/components/agent-ops/cockpit/).

| Where | Shows | Needs server metrics? |
|---|---|---|
| Header KPIs | Turns, cost, tokens (in/out split), tool calls (ok/err), time in tools | No |
| KPI "Model vs tools" | Model time vs tool time, avg first token, coverage (x/y turns recorded) | Yes |
| KPI "Prompt cache" | Cache hit % of input tokens | Yes |
| KPI "Turn time" | Total turn duration, outcomes | Uses `turnOps` or server |
| Overview → *What stands out* | Rule-based insights ([`insights.ts`](../../src/components/agent-ops/cockpit/insights.ts)) | Some |
| Overview → *How the agent worked* | Per turn: question → tool steps (`describe_schema ×6 → …`) → answer | No |
| Overview → *Where the time went* | Share of tool time per tool | No |
| Overview / Timeline → *Execution timeline* | Waterfall; real clock time if timestamps exist, else sequential | No |
| Turns → *Loop by loop* | Per loop: model vs tool bar, context size, cached tokens | Yes |
| Call inspector (side drawer) | SQL (highlighted), input, output, error; ↑/↓ to step, Esc to close | No |

**Insight rules** (in order): failed calls · all succeeded · identical repeated calls · one tool > 50%
of calls · input-token share · cache hit rate · model vs tool share · context growth > 2× within a turn ·
busiest turn · slowest call. Add new rules in `deriveInsights()`.

---

## 8. Setup

1. **Apply the migration** (additive — creates two tables, touches nothing else):
   ```bash
   npx prisma db execute --file prisma/migrations/20261017_agent_turn_loop_log/migration.sql --schema ./prisma/schema.prisma
   npx prisma migrate resolve --applied 20261017_agent_turn_loop_log
   ```
2. **Regenerate the client and restart the server** — `npx prisma generate`. On Windows, stop
   `next dev` first or the query-engine DLL rename fails with `EPERM`.
3. **Run a new chat.** Only turns after deploy are recorded; older sessions are not backfilled and
   the UI hides server-only panels for them.
4. **Check sampling:** if `AGENT_OPS_SAMPLE_SUCCESS_RATE` < 1, successful tool rows are dropped and
   call counts / tool time are under-reported. Turn and loop metrics are never sampled.

Verify:

```sql
SELECT turn_id, duration_ms, first_token_ms, llm_ms, tool_ms, loops,
       input_tokens, cache_read_tokens, outcome
FROM agent_turn_log
WHERE session_id = '<session-id>'
ORDER BY started_at;

SELECT loop, llm_ms, tool_ms, context_chars, input_tokens, cache_read_tokens, stop_reason
FROM agent_loop_log
WHERE turn_id = '<turn-id>'
ORDER BY loop;
```

---

## 9. Caveats

- `context_chars` is a JSON length of the messages + system prompt — a size signal, not an exact token count.
- `tool_ms` is batch wall time; parallel tools overlap.
- "Other" time in the turn bar = `duration_ms − llm_ms − tool_ms` (prompt build, memory recall, scoring).
- If a Bedrock call fails and the route falls back to Grok, loops from the failed attempt are usually
  absent (the error throws before a loop reports); the turn row records the effective model.
- Whether xAI returns `cached_tokens` for every Grok model depends on the provider; 0% may mean
  "not reported", not "no caching".
- Turn ↔ chat matching uses message timestamps (client clock) vs `started_at` (server clock); large
  clock skew could mismatch turns. Tool rows avoid this via `run_id`.

---

## 10. Tests

| Test | Covers |
|---|---|
| [`src/lib/agent-ops/__tests__/session-cockpit.test.ts`](../../src/lib/agent-ops/__tests__/session-cockpit.test.ts) | Turn-row matching, `run_id` attachment, `turnOps` fallback, server aggregates |
| [`src/lib/lifecycle/__tests__/log-agent-cost.test.ts`](../../src/lib/lifecycle/__tests__/log-agent-cost.test.ts) | Full price, Anthropic read/write rates, Grok read rate, no negative cost |

```bash
npx vitest run src/lib/agent-ops src/lib/lifecycle src/lib/inspector
```

---

## 11. Open follow-ups

- [ ] Decide on Bedrock prompt caching for Inspector ([§6](#6-proposed-bedrock-prompt-caching-for-inspector-chat)).
- [ ] Add real `grok-4.7` pricing to `MODEL_PRICING`.
- [ ] Write cost rows for Workbench chat (currently none).
- [ ] Populate or drop the unused `tool_invocation_log.input_tokens` / `output_tokens` columns.
- [ ] Surface already-fetched data not yet shown: per-turn `costLog`, tool output size, SQL row counts
      (`studio_query_results`), bandit `score_v` / `tool_calls_discovery`.
- [ ] Show a "sampled data" badge on the run page when tool logging is sampled.
