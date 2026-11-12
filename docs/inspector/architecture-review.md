# Inspector: current architecture review and improvement plan

**Status:** research and proposal only, no code changed · **Date:** 2026-11-04 · **Scope:** Inspector chat (conversational research over business data). Workflow automation, scheduled tasks and long-running orchestration are out of scope.

**Evidence used:**
- Code read on `feature/ui-redesign` (`path:line` below).
- Read-only aggregate queries on the **dev** database tables `agent_turn_log`, `agent_loop_log` and `tool_invocation_log`, last 30 days. That's **45 Inspector turns (18 Oct – 4 Nov 2026)**, mostly team testing. These are real measurements, but a small dev sample, and setup errors inflate the error rate.
- No production logs were read.
- The LLM Lite gateway configuration isn't in the repo.

## 0. Summary

Inspector is **one ReAct-style tool loop**. A single LLM decides every step and calls six tools. Around it sits a lot of deterministic machinery:
- semantic context;
- memory injection;
- a read-only SQL guard;
- chart validation and compilation;
- session knowledge.

There's no planner, no router and no sub-agents.

**What the dev traces show:**
- **Model time dominates latency.** Per turn, the median is **19 s of model time against 3 s of tool time**.
- **The dominant cost is schema discovery.** It's one model round trip per lookup.
  - In the latest 11-loop turn, **8 loops and 18 `describe_schema` calls came before the first SQL query**.
  - Across Inspector turns, `describe_schema` calls outnumber SQL calls 198 to 144.
- **A one-call discovery action already exists but isn't exposed to the model.** `describe_schema action:'research'` returns the candidates, their columns and their relationships in one call (`src/lib/context/dispatch.ts:117-161`). It's missing from the tool's enum (`src/lib/inspector/prompts.ts:177`).

**The smallest meaningful improvement is to make discovery a single step and keep everything else.** After that, fix the loop's endings and measurement:
- wrap-up when the loop cap is hit;
- stop reasons;
- a real Stop;
- tool-error counting;
- costing.

Only then consider a light plan tool for complex questions, after measuring whether it helps.

**A framework migration (LangGraph.js, Deep Agents JS) isn't justified by the evidence.** The bottlenecks are discovery round trips and context. Neither framework removes those.

## 1. Current-state map

### 1.1 Components actually used

| Layer | What | Where |
|---|---|---|
| UI | `InspectorShell`, dashboard pane, cards (query progress, export, disambiguation, pin) | `src/components/inspector/*` |
| Client state and streaming | `useInspectorChat` `doSend`: POSTs the whole local transcript, reads SSE events, handles Stop through `AbortController` | `src/hooks/useInspectorChat.ts:270-330, 740-746` |
| API | `POST /api/inspector/chat`, `maxDuration` 300 s | `src/app/api/inspector/chat/route.ts:138-802` |
| Auth | Proxy requires a signed-in user for `/api/**` (`src/proxy.ts:24-26`). `guardInspectorChat` checks sign-in and session ownership, enforced by default (`src/lib/inspector/session-auth.ts:86-118, 132`) | |
| Model choice | Feature default `inspector_chat`, or the requested key if the role allows it. **Only LLM Lite keys are served** (`route.ts:158-171`) | `src/lib/llmlite/*` |
| Loop actually run | `dispatchAgentLoop` → `runFoundryAgentLoop` → **OpenAI Chat Completions against the LLM Lite gateway** (`route.ts:555-557`, `providers/factory.ts:10-12`, `providers/foundry-chat.ts:406-684`). The Bedrock `runAgentLoop` (`agent-loop.ts`) isn't reached by Inspector | |
| Models seen in traces | `grok-4.7` direct xAI (18–30 Oct, 28 turns); `aws_bedrock/xAI-Grok-4.7` through the gateway (30 Oct – 4 Nov, 8 turns); a few test turns on other models | dev `agent_turn_log` |
| Tools | `execute_tool` (SQL), `describe_schema` (catalog), `emit_chart`, `export_query_result`; plus `emit_semantic_chart` and `emit_disambiguation` when governed semantic entities exist | `prompts.ts:133-225, 301-374`; `tools.ts:111-488` |
| Data | Databricks SQL through one **shared M2M service principal** per connection (`src/lib/databricks/token-client.ts`, `tools.ts:385-454`); catalog from harvested metadata (`src/lib/context/describe.ts`, `dispatch.ts`); governed semantic layer (`src/lib/semantic/*`) | |
| Post-turn (background, after the stream closes) | Bandit report; bandit observation plus **LLM judge** (semantic quality and groundedness scorers); trajectory reflection; memory-outcome attribution; session knowledge plus **LLM narrative summary**; **LLM first-turn reflection** (first turn only) | `route.ts:615-783`; `lifecycle/judge-batch.ts:56-90`; `boost/scorers/{semantic,groundedness}.ts`; `inspector/session-knowledge-llm.ts:17-35`; `marcus/reflect.ts:162+` |

### 1.2 Sequence: what happens for one question

```mermaid
sequenceDiagram
  participant UI as useInspectorChat (browser)
  participant API as POST /api/inspector/chat
  participant Ctx as Context builders
  participant Loop as runFoundryAgentLoop
  participant GW as LLM Lite gateway (Grok 4.7)
  participant T as executeInspectorTool
  participant DB as Catalog / Databricks
  UI->>API: whole transcript + sessionId + model
  API->>API: auth + ownership, budget pre-check, model key
  API->>Ctx: semantic context, insights, session knowledge, memory (DB reads)
  Ctx-->>API: system prompt (static base + per-session blocks)
  loop up to 15 model calls
    API->>Loop: messages
    Loop->>GW: chat.completions (stream, max 4096 out, tools)
    GW-->>Loop: text and/or tool calls
    Loop->>T: all tool calls of this response (Promise.all)
    T->>DB: describe_schema / SQL / chart / export
    DB-->>T: results (full result to model, capped copy to UI)
    T-->>Loop: tool results appended to messages
  end
  Loop-->>API: finalText / truncated / errored
  API-->>UI: SSE text, tool cards, query_result, charts, suggestions, done
  API->>API: background: judge (LLM), narrative summary (LLM), reflections, bandit, memory
```

### 1.3 Traced examples (dev, real turns; tool names and timings only)

**Simple lookup** (latest completed turn with 1–2 tool calls):
- **What it did:** 3 model calls, 2 × `describe_schema search` (1.2 s and 1.4 s).
- **Size and time:** 30k input tokens, **14.4 s** total, **8.6 s** to first token.
- **No SQL** ran.
- **Turns with no tools** (7 completed) answer directly in **2.1 s** median.

**Complex investigation** (latest turn with ≥10 loops). It completed in 11 model calls, 20 tool calls, **76 s** and **351k input tokens**.

| Loops | What happened | Model time | Context (chars) |
|---|---|---|---|
| 1 | 4 × `describe_schema`, cold start, 0 cache reads | 15.0 s | 22k |
| 2–8 | 14 more `describe_schema` calls, 1–3 per loop | 1.8–7.7 s each | 61k → 125k |
| 9–10 | first and second `execute_tool` SQL (3.9 s and 2.2 s) | 11.6 s, 8.0 s | 141k → 152k |
| 11 | final answer | 13.1 s | 163k |

The context grew mainly from **schema descriptions**, before any query rows existed.

### 1.4 Measured profile (dev, 45 turns, 30 days)

| Measure | Value |
|---|---|
| Outcomes | 30 completed · 4 truncated (hit 15 loops) · 10 errored · 1 aborted. Errors are mostly setup problems (invalid key ×2, missing credentials, credential object invalid ×2, connection errors ×3), plus one 45 s gateway timeout |
| Completed turns: duration | p50 **39 s**, p90 78 s |
| Completed turns: time to first token | p50 6.1 s; all turns p95 **53 s** |
| Completed turns: loops and tools | p50 **5** loops, **7** tool calls |
| Completed turns: input tokens | p50 **72k**; all turns p95 347k. Output p50 1.1k |
| By size | 0 tools: 2.1 s · 1–2 tools: 33 s · 3–6: 20 s · 7–12: 52 s, 107k tokens · 13+: **68 s, 326k tokens** (11 of 34 finished turns) |
| Context per loop (p50) | 30k chars at loop 1 → 96k at loop 9 → 138k at loop 15 |
| Prompt cache | **80% of input tokens were cache reads** (Grok automatic caching, direct and through the gateway). **Loop 1 has 0 cache reads**, so the prefix isn't reused across turns |
| Tool latency in Inspector turns | `describe_schema` p50 0.2 s, p95 1.7 s · `execute_tool` p50 1.7 s, p95 15.4 s |
| Discovery mix | `search` 111 · `describe` 81 · `list` 3 · `profile` 2 · `relations` 1 · `research` 0 (not offered) |
| Charts | `emit_chart` 2 and `emit_semantic_chart` 3 across all Inspector turns |
| Exact repeat calls | **0** identical tool inputs repeated within a turn |
| Tool errors | `tool_invocation_log` shows 7 failed `describe_schema` and 7 failed `execute_tool` calls in Inspector turns, yet `agent_turn_log.tool_errors` = **0** for all 45 turns (§3, W8) |

## 2. Answers to the eight questions

**1. Frontend and backend:** see §1.1.
- Libraries: OpenAI Node SDK against the gateway (`foundry-chat.ts`), AWS SDK Bedrock (chart repair, `chart-pipeline.ts:1, 204`), Prisma, ECharts for charts (`src/lib/studio/compiler`).

**2. Reasoning pattern:** **ReAct-like**, with native tool calling, one model and no plan object.
- The prompts are the static base prompt (`prompts.ts:16-85`) plus answer rules (`answer-rules.ts`), tool specs (`prompts.ts:133-225`) and the semantic section (≤8,000 chars, `prompts.ts:380`).
- Per-session blocks come after them: insights (`prompts.ts:458-483`), session knowledge (`session-knowledge-store.ts:93`) and memory (`route.ts:254-314`).
- Tool decisions are made entirely by the model. No plan is generated.

**3. Deterministic vs LLM-driven:**

| Deterministic | LLM-driven |
|---|---|
| Auth and ownership, budget pre-check, model key, semantic context, memory selection | Every choice of what to look up and which SQL to run |
| SQL guard: first keyword must be a read verb, single statement only (`databricks/execute.ts:59-149`); row cap 1,000 by default | The final answer and its suggestions. Suggestions are extracted by regex, with fixed fallbacks (`route.ts:112-134, 617`) |
| Chart DSL validate, repair and compile when the model supplies a spec (`tools.ts:216-253`) | Chart repair fallback (`chart-pipeline.ts:118-215`) |
| Semantic query compile and execute (`chart-pipeline.ts:368+`, `semantic/execute`) | Background judge, narrative summary and first-turn reflection |

Mechanics:
- **Dependencies:** none are modelled. The model sequences steps across loops.
- **Parallelism:** all tool calls in one model response run in parallel (`foundry-chat.ts:598-652`). A **process-wide limit of 2** applies to `describe_schema` across all users (`context/dispatch.ts:9-26`).
- **Retries:** none explicit, only SDK defaults. Tool errors go back to the model as text.
- **Timeouts:** a 45 s stall timer per model call (`foundry-chat.ts:453-454`) and route `maxDuration` 300 s.
- **Cancellation:** see W4.

**4. Chat context:**
- **History:** the client sends the whole transcript, uncapped (`useInspectorChat.ts:306`).
  - The server keeps only text and merges consecutive same-role messages (`route.ts:206-224`).
  - Prior SQL and results reach the model only through **session knowledge**, which is bounded (`session-knowledge-store.ts:108-167`).
- **Intermediate results:** inside a turn, everything is re-sent every loop with no trimming (`foundry-chat.ts:595, 656-658`).
- **Limits:** no context guard.
- **Streaming:** SSE events with `text_replace` to swap interim narration for the final text (`route.ts:550-552`).

**5. Research and data:**
- **Retrieval:** catalog search blends pgvector with keyword and exact-name evidence (`describe.ts`, `dispatch.ts:105-161`). Knowledge bases aren't wired into Inspector.
- **Semantic layer:** governed models and entities only; drafts are excluded (`chart-pipeline.ts:385-400`).
- **SQL:** `execute_tool` with the read-only guard. CSV export up to 100k rows.
- **Verification:** **none before the answer.** Groundedness is scored *after* the turn, in the background, by an LLM judge (`judge-batch.ts:85-90`).
- **Citations:** the answer rules ask for evidence (`answer-rules.ts`), but nothing enforces it.
- **Data permissions:** see W1.

**6. Specialists:** none. There are no routers, sub-agents or handoffs. Given the traces (one sequential chain: discover → query → answer), **tools are simpler and sufficient**.

**7. Performance:** see §1.3–1.4. Simple lookups take 3 model calls and about 14 s even without SQL. Complex turns take 11–15 model calls, about 70 s and over 300k input tokens.
- **Unknown:** real per-turn cost. The price table mis-prices gateway model ids (W9). Background model calls aren't costed (W7). Getting the real figure needs the gateway's per-request cost or a fixed price table.

**8. Weak spots:** §3.

## 3. Findings

### What works well (keep)
- One loop, with parallel tool calls inside each response.
- A strong read-only SQL guard with single-statement enforcement.
- Typed chart DSL with deterministic validation and compilation.
- A governed semantic layer, with drafts excluded from the LLM.
- Bounded session knowledge carried across turns.
- Detailed per-loop metrics: tokens, cache split, context size, timings.
- Fast direct answers: 2.1 s when no tools are needed.
- Ownership-checked sessions.
- Within-turn caching on Grok: about 80% of input is cache reads.

### Weak spots (evidence-backed)

| # | Finding | Evidence | Effect |
|---|---|---|---|
| **W1** | **Chat runs warehouse SQL without the `inspector:use` permission.** The direct SQL route requires it (`api/databricks/connections/[id]/execute/route.ts:26`), but `/api/inspector/chat` only checks sign-in and ownership (`session-auth.ts:86-118`), and the proxy only checks sign-in (`proxy.ts:24-26`). All queries use one shared service principal | code | Any signed-in user (default role `member`, `rbac.ts:22`) can query the warehouse through chat. **Needs an owner decision (§6)** |
| **W2** | **Schema discovery takes many model round trips.** The one-call `research` action exists but isn't offered | `dispatch.ts:117-161` vs `prompts.ts:177`; traces: 8 of 11 loops were discovery; 198 describes vs 144 SQL; `research` used 0 times | Most of the latency and tokens of complex turns |
| **W3** | **Hitting the loop cap gives no answer.** Tools stay available on the last loop, there's no wrap-up call, and `finalText` is null, so the user gets a canned footer | `foundry-chat.ts:459, 661-668`; `route.ts:672-683`; traces: 4 of 45 turns | Wasted work in exactly the most expensive turns |
| **W4** | **Stop doesn't stop the current step.** There's no abort check inside the stream or before the tool batch, and the model request's `AbortController` is tied only to the stall timer. Aborted turns can be labelled `completed` or `truncated` and still feed the bandit and memory | `foundry-chat.ts:453-506, 597-652`; `route.ts:615-671, 740` | Tokens and SQL keep running after Stop; learning data is polluted |
| **W5** | **Stop reasons are ignored.** A `length` finish is reported as completed; broken tool arguments silently become `{}` | `foundry-chat.ts:469-506, 601` | Silent truncation at 4,096 output tokens |
| **W6** | **No cross-turn prompt reuse.** Loop 1 always has 0 cache reads. Per-session blocks are in the system prompt, and the insights block is uncapped | traces; `route.ts:244-248, 297-298`; `prompts.ts:458-483` | Every turn pays a cold ~8–9k-token prefix and slower first tokens (loop 1: 15 s in the traced turn) |
| **W7** | **Hidden, uncosted model calls after each turn:** judge (2 scorers), narrative summary (on by default when the gateway is configured), first-turn reflection | `judge-batch.ts:85-90`; `session-knowledge-llm.ts:22-31`; `marcus/reflect.ts:162+`; no spend recording in those modules | Real cost per turn is higher than reported, with no budget |
| **W8** | **Tool errors are counted as successes.** Tools return `{error}` text instead of throwing, so the trajectory marks them successful. The scoring and turn metrics see 0 errors | `foundry-chat.ts:611-617`; `route.ts:597-613`; traces: 14 failed calls vs `tool_errors = 0` | Bandit, quality score and dashboards are wrong |
| **W9** | **Cost is mis-priced or missing.** Gateway ids fall back to Sonnet prices; errored turns aren't costed; `toolCalls` is logged as `loops − 1` | `lifecycle/log-agent-cost.ts:28-59`; `route.ts:632, 697, 727-736` | No trustworthy cost baseline |
| **W10** | **The latest question is probably sent twice.** The client appends `userMsg` to state, reads state back (already containing it), then appends it again; the server merges the two | `useInspectorChat.ts:285, 297-306`; `route.ts:213-224` | Small token waste; confirm with one captured request |
| **W11** | **Chart repair calls Bedrock directly with the gateway model id.** It most likely always fails and falls back to the rule-based recommender | `tools.ts:208, 262-269`; `chart-pipeline.ts:128-139, 204` | Dead code path; extra latency on chart fallback |
| **W12** | **No verification before synthesis.** Numbers in the answer aren't checked against query results; retrieval quality notes (for example "lexical only") depend on the model passing them on | `judge-batch.ts` (after the fact only); `dispatch.ts:146-156` | Ungrounded numbers are possible, and caught only afterwards, if at all |
| **W13** | **Possible large results in context.** `execute_tool` returns the full result to the model (up to 1,000 rows by default) with no size cap; only the UI copy is capped | `tools.ts:444-454`; `databricks/execute.ts:25-28` | Not the main driver in these traces (discovery was), but there's no protection |
| **W14** | **Global `describe_schema` limit of 2 per process**, shared by all users | `dispatch.ts:9-26` | Queueing under concurrent use |

**Not supported by the evidence** (don't act on these yet):
- **Repeated identical queries:** 0 found.
- **Multi-agent need:** the work is sequential.
- **Missing parallelism:** tool time is about 15% of latency, and independent calls already run in parallel when the model issues them together.

## 3A. Why `describe_schema` is called so often

**Answer:** the prompt tells the model to discover step by step, each step costs a model round trip, and nothing carries what was learned into the next step or the next turn.

### Measured (dev, 27 Inspector turns that used schema tools, last 30 days)

| Measure | Value |
|---|---|
| Schema calls per turn (median) | **6** (maximum 23) |
| Schema calls before the first SQL (median) | **5** |
| Searches / describes / profiles | 111 / 81 / 2 |
| Different search wordings | **111 of 111**: the model rewords the search about 4 times per turn |
| Described tables actually used in that turn's SQL | **43 of 81 (53%)**; 7 were in turns that never ran SQL |
| Tables described again in a later turn of the same session | **22 of 81 (27%)** |
| Identical describe repeated within one turn | 0 |
| Searches that ran with no query embedding (keyword-only results) | **15 of 111 (14%)** |
| `search` with k ≥ 8 (the prompt's example uses 8) | 77 of 111 |
| Describes with `detail: full` (every column) | 29 of 81 (36%) |
| Turns with schema calls and no SQL at all | 5 |

### Root causes

| # | Cause | Evidence | What it produces |
|---|---|---|---|
| R1 | **The prompt mandates a multi-step discovery** (search, then describe each relevant table, then profile before SQL) and says `describe_schema` "is free… Use it liberally" | `prompts.ts:36-46, 60` | Many small calls, each one a 2–8 s model round trip. "Free" is true for the warehouse, not for latency or tokens |
| R2 | **Search returns no columns**: only path, kind, row estimate, a 150-character reason and scores | `context/describe.ts:625-637` | One `describe` per candidate (the N+1 pattern), and a third of those are `full` |
| R3 | **The one-call `research` action isn't offered.** It returns up to 5 candidates with columns (≤20), relationships (≤15) and semantic cards | `dispatch.ts:117-161` vs `prompts.ts:177` | Discovery that could be 1 call takes 5–8 |
| R4 | **Session knowledge carries table paths, not columns** | `session-knowledge-store.ts:101-175` (paths and last SQL only) | 27% of describes repeat a table already described earlier in the session |
| R5 | **Weak search results lead to rewording**: only 28% of tables are vector-searchable, and scores are flat (top-1 semantic median 0.42, rank 5 0.35). The 15 searches without an embedding were one incident (26 Oct, 05:49–06:08), not a steady rate | §3B; dev `tool_invocation_log.output` | About 4 different search wordings per turn |
| R6 | **The default model loses its reasoning between tool rounds** (Grok on Chat Completions), so it re-plans in small batches of 1–3 calls per loop instead of issuing everything at once | `foundry-chat.ts:133-135`; traced turn: 1–3 schema calls per loop over 8 loops | More loops for the same lookups (inference, consistent with the trace) |
| R7 | **On SQL failure the prompt says to fall back to `describe_schema`** rather than read the error | `prompts.ts:64` | Re-discovery after a column-name error |

### Fix, step by step (what changes in the current code)

The steps are ordered by size and risk. Measure after each step on the phase 0 golden set using the metrics at the end of this section.

**Step D1. Rewrite the discovery rules in the prompt** (S, `src/lib/inspector/prompts.ts:18-64`)
- Replace "describe_schema is free. Use it liberally" with a stated cost: "each schema call is a model round trip; aim for at most 2 schema calls before the first SQL".
- New order:
  1. use SESSION KNOWLEDGE or OPERATING MEMORY if they cover the question;
  2. otherwise **one** `research` call;
  3. `describe` only for a table you'll query whose needed columns weren't returned, with **all such describes in one response**;
  4. `profile` only when a filter value is unknown.
- Use `detail: 'full'` only when compact lacks a needed column.
- On SQL error: read the error message and fix the column. Describe only the table named in the error.
- Change the search example from `k:8` to `k:5`.
- **Effect:** fewer, batched calls. No behaviour change elsewhere.

**Step D2. Offer `research`** (S, `prompts.ts:169-188`)
- Add `'research'` to the `action` enum.
- Description: "one call: top candidates with columns, relationships and semantic notes; use first for unfamiliar questions".
- The handler already exists (`dispatch.ts:150`, after the uncommitted `visibility` change), so there's no server change.
- **Effect:** discovery becomes 1 call in most turns. Roll back by removing it from the enum.

**Step D3. Carry columns across turns** (M, `session-knowledge-store.ts`, `session-knowledge-core.ts`, `persistSessionKnowledgeAfterTurn`)
- For each table used in successful SQL, save a compact column card: the column names and types used in the SQL plus key columns, at most ~25 per table and a total cap.
- Show these cards in SESSION KNOWLEDGE ("confirmed columns; do not describe again").
- **Effect:** follow-up turns skip re-describing (targets the 27%).

**Step D4. Retrieve before loop 1** (M, `src/app/api/inspector/chat/route.ts` before the loop, about line 325). This is the deterministic version of D2.
- For data questions not covered by session knowledge, call the existing `research` dispatcher server-side with the user's question.
- Add the compact result as a context message just before the latest user message, labelled "CATALOG CANDIDATES (retrieved for this question; verify before use)". It goes after the static prefix so it doesn't break caching.
- Skip it for greetings, meta questions and turns already covered.
- **Cost:** one catalog lookup (`describe_schema` p50 0.2 s, `research` does a few in sequence) and **no model call**.
- **Compare with D2 on the golden set** and keep the better one, or both.

**Step D5. Fix catalog search quality** (§3B steps E1–E7)
- Re-embed and fill coverage gaps first, then improve ranking.
- **Effect:** better first candidates, so less rewording.

**Step D6. Richer search hits** (S–M, `describe.ts:625-637, 669+`), **only if D2–D4 aren't enough**
- Add up to 8 key column names per hit, within a token budget, so a good hit can go straight to SQL.

**Step D7. Hygiene** (S)
- Cap `detail: 'full'` output (for example 60 columns, with a note).
- Replace the process-wide `describe_schema` limit of 2 (`dispatch.ts:9-26`) with pool sizing.
- Remove the contradictory `SHOW CATALOGS` hint (`describe.ts:266`).

### Recommended `describe_schema` action set for Inspector

`describe_schema` stays one tool. The server already handles 7 actions (`dispatch.ts:226-229`), but Inspector's tool definition allows only 5 (`prompts.ts:177`): `research` and `usage` are handled but hidden.

**Measured use (dev, Inspector, last 30 days, queried 5 Nov 2026; read-only):**

| Action | Calls | Turns | Failed | `detail: 'full'` | Avg output (chars) |
|---|---:|---:|---:|---:|---:|
| `search` | 123 | 26 | 2 | n/a | 2,879 |
| `describe` | 105 | 27 | 5 | 49 (47%) | 5,715 |
| `profile` | 9 | 5 | 0 | n/a | 4,667 |
| `list` | 3 | 3 | 0 | n/a | 476 |
| `relations` | 2 | 2 | 0 | n/a | 79 |
| `research`, `usage` | not callable | | | | |

These counts cover a later 30-day window than the "Measured" table above (111 searches, 81 describes, 36% full), so the two don't match exactly.

What the counts show:
- **search and describe make up 95% of calls.** Discovery means search followed by describe.
- **Almost half of describes ask for every column.** That makes describe the largest output at about 5.7k characters each.
- **The prompt's "profile before SQL" rule is mostly ignored** (9 calls in 5 turns).
- **`relations` and `list` are barely used.**

| Action | Recommendation | Reason |
|---|---|---|
| `research` | **Expose it and make it the default first call** (D1–D2), or run it before loop 1 (D4) | One call replaces search → describe → relations |
| `describe` | **Accept `paths: string[]` and `columns: string[]`.** Keep `compact` as default and cap `full` (D7). | 47% `full` and two separate describes per turn are the main context cost |
| `profile` | **Add a `columns` filter.** Drop the "always profile" rule (D1). | Rarely used. When it is used, it should be cheap. |
| `search` | **Keep, and add up to 8 key columns per hit** (D6) | Quick follow-up lookups. A good hit can go straight to SQL. |
| `usage` | **Expose it**, ideally as a short "how this table is usually queried" block inside `describe`: common filters, key columns, tables it's usually joined with | Already harvested (T3). Helps the first SQL be right. |
| `relations` | **Fold it in.** `research` already includes relations and `describe` lists related tables; keep it callable for join questions. | 2 calls in 30 days |
| `list` | **Remove from Inspector's enum** | 3 calls in 30 days. Search does the job, and on a large catalog the output is unbounded. |

Value lookups ("vessel name → id") need the warehouse, so they stay with `execute_tool`. `profile` top values cover common cases.

**Code changes, in order:**
1. Enum and prompt: add `research`, remove `list` (`prompts.ts:177`, 18-64). **S.**
2. `usage` in `describe` output (`describe.ts`), or add it to the enum. **S.**
3. `paths`/`columns` on describe and profile (`dispatch.ts`, `describe.ts`). **M.**
4. Key columns on search hits (`SearchResultItem`, `describe.ts:625-637`). **S–M.**

Existing actions keep working, so other callers (the Agent Lab builder in `src/lib/construction/prompts.ts:132` and the workbench pre-call in `src/app/api/agent-lab/workbench/chat/route.ts:121`) aren't affected.

### Metrics and targets (golden set)

| Metric | Now (dev) | Target after D1–D4 |
|---|---|---|
| Schema calls per turn (p50) | 6 | ≤ 2 |
| Schema calls before the first SQL (p50) | 5 | ≤ 1–2 |
| Described tables used in SQL | 53% | > 80% |
| Re-described in a later turn | 27% | < 5% |
| Loops per complex turn | 11 (traced) | 4–5 |
| Answer correctness | baseline | no regression |

The targets are estimates to be confirmed.

## 3B. Embedding and catalog search quality

**Answer:** the embedding model (Titan v2, 1,024 dimensions) separates tables well. The problems are **coverage** (only 28% of active tables can be found by vector search) and **ranking** (the right table is first in fewer than a third of turns).

### How it works

- **Embedded text per table** (`context/embed.ts:39-67`): `"<path> (<kind>): <LLM summary>. Grain: <grain>. Key columns: <cols>."`
  - The summary comes from the T2 semantic card.
  - Only tables with a card get an embedding.
- **Search** (`context/describe.ts:669-845`):
  1. pgvector cosine search over Titan vectors only (other models are excluded as not comparable);
  2. plus keyword overlap and exact-name `ILIKE`;
  3. score = 0.7 × semantic + 0.15 × keyword + 0.15 × exact name (`search-ranking.ts:39-41`);
  4. vector hits under 0.15 similarity are dropped;
  5. +0.05 boost for tables in the same entity group.
- **Columns:** 31,063 column vectors exist (923 tables), but catalog search **doesn't use them**.

### Measured (dev, 4 Nov 2026; read-only)

**Coverage**

| Measure | Value |
|---|---|
| Active tables | 3,232 |
| Searchable by vector (Titan) | **921 (28%)** |
| Embedded with a different model (`openai/text-embedding-3-large`, 22 Oct, one source, 5-minute run), so **invisible** to search | 463 |
| Have a semantic card but no embedding: **only need an embedding job** | 756 |
| No semantic card: **need T2 first** | about 1,100 |

**Coverage by catalog**

| Catalog | Active | Titan | Other model | Card, no embedding | No card |
|---|---|---|---|---|---|
| open_analytics_zone | 1,232 | **8** | **458** | 137 | 629 |
| curated_db | 955 | 818 | 2 | 98 | 37 |
| reporting_layer | 586 | **7** | 2 | **330** | 247 |
| landing_zone_dev | 134 | 1 | 0 | 131 | 2 |
| sap_prod | 75 | 74 | 0 | 0 | 1 |
| landing_zone | 66 | 0 | 0 | 0 | 66 |

**Quality where vectors exist**

| Measure | Value | Reading |
|---|---|---|
| Similarity of random table pairs | 0.18 average | Good separation: vectors aren't collapsed |
| Nearest-neighbour similarity | 0.79 median; no near-duplicates in a 150-table sample | Similar tables exist (versions, dev copies), but they're distinguishable |
| Top-1 semantic score per search | median **0.42**; rank 5: 0.35 | **Flat ranking**: the top five sit close together, so the model has to inspect several tables |
| Embedded text length | median 447 chars | Adequate |
| Embedded text with `Key columns: (unknown)` | 361 of 1,384 (26%) | Weaker signal for column-oriented questions |
| Embeddings older than the latest semantic card | 228 of 1,295 (18%) | Stale text is being searched |

**Retrieval effectiveness**

This is a proxy: did the search return the table the turn later queried successfully? The sample is small.

| Measure | Value |
|---|---|
| First search of a turn: queried table at rank 1 | **5 of 17 turns (29%)** |
| First search of a turn: queried table in top 5 | 10 of 17 (59%) |
| First search of a turn: queried table not returned | 6 of 17 (35%) |
| Queried tables missed by the first search, but searchable | 8 of 28: a **ranking** problem |
| Queried tables missed by the first search, not searchable | 5 of 28: a **coverage** problem |
| Queried tables overall: Titan-searchable / other model / no embedding | 16 / 3 / 2 of 21 |

Caveats: a table can reach the SQL through memory or session knowledge rather than search, and table names are matched by substring. Read these as directional, not exact.

### Fixes, ordered by value per effort

| # | Step | Where | Expected | Size |
|---|---|---|---|---|
| E1 | **Re-embed the 463 OpenAI vectors with Titan** and **embed the 756 tables that have cards but no vectors**. That's about 1,200 short texts, a few cents of Titan. Run the existing embed job per source | `context/embed.ts` `runEmbedJob`; Estate jobs | Searchable tables from 28% to about 66% | S |
| E2 | **Prevent recurrence:** remove or rename the second `CURRENT_EMBEDDING_MODEL` in `src/lib/azure/embed-client.ts:188` (it points at OpenAI); make the catalog embed path fail rather than fall back to another model; add an alert when vectors from another model exist | `azure/embed-client.ts`, `context/embed.ts` | No silent model mix | S |
| E3 | **Re-embed when a semantic card changes** (228 stale): queue an embed after each T2 write for that object | `context/embed.ts`, T2 harvest | Search matches current descriptions | S |
| E4 | **Use the full question, not the model's 2–3-word query.** Pre-retrieval (§3A D4) embeds the user's question; the search tool keeps short queries for follow-ups | `route.ts` (D4) | Better first-search recall | (part of D4) |
| E5 | **Add column evidence:** search the 31k column vectors too and roll hits up to their table (best column similarity as an extra signal); include matched column names in the result | `context/describe.ts` `searchObjects`, `search-ranking.ts` | Questions that name a field ("certificate expiry date") find the right table | M |
| E6 | **Better ranking:** replace token overlap with Postgres full-text rank over path, summary and column names; combine signals by reciprocal rank fusion; down-rank `*_dev`, `landing_zone*` and `samples` unless asked; add a usage prior from T3 query history; optionally a reranker on the top 20 (check Bedrock rerank availability in ap-south-1 first) | `search-ranking.ts`, `describe.ts` | Rank-1 hit rate up from 29% | M |
| E7 | **T2 semantic cards for important uncovered tables** (open_analytics_zone 629, reporting_layer 247), prioritised by query history | Estate T2 jobs | Coverage toward 90% of tables people actually use | M (LLM cost) |
| E8 | **Retrieval benchmark:** a labelled set (question → correct tables) from golden-set questions and logged turns; report hit@1, hit@5 and MRR on every change | new `scripts/inspector/retrieval-eval.ts` | Search changes are measured, not guessed | S–M |

**Order:** E1, E2 and E3 first (days, almost no cost), then E8 to fix a baseline, then E4, E5 and E6 measured against it, then E7 where usage justifies it.

## 4. Option comparison

| | A. Improve the current loop | B. Add a light adaptive planner | C. LangGraph.js / Deep Agents JS |
|---|---|---|---|
| What it is | Fix discovery, endings, Stop, measurement, prompt layout and tool results inside `foundry-chat.ts`, `route.ts`, `tools.ts` and `prompts.ts` | A + an `update_plan` tool used only for complex questions, bounded replanning, a budget meter, light verification checks | Re-host the loop as a graph (nodes, checkpointer, interrupts) or a Deep Agents harness (built-in to-do list, sub-agents, file-system context) |
| Addresses the measured bottleneck (discovery round trips) | **Yes** (one-call research) | Yes (same, plus a plan) | Only if we also add one-call research; the framework doesn't remove round trips |
| Simple-question latency | Better (fewer discovery loops) | Same as A if the plan is skipped for simple questions | Risk of overhead per node or turn |
| Migration cost | Low. No contract changes; SSE events kept | Low–medium. New optional SSE event (`plan_updated`) | High. Three loop copies, SSE contract, tool context, memory injection, metrics, abort, cost all re-wired |
| New dependencies or infrastructure | None | None | New framework; a checkpointer store if persistence is used |
| Reversibility | Each change behind a flag or enum | The plan tool can be removed from the tool list | Hard to reverse |
| Evidence it pays off | Direct: traces show discovery loops and missing endings | Indirect: published results favour a living plan on long tasks; no ALOFT measurement yet | None specific to our bottleneck |
| **Verdict** | **Do first** | **Pilot after A, keep only if the golden set improves** | **Not now.** Revisit if we need durable interrupts or multi-agent work later |

## 4A. Recommended execution technique: a retrieve–act–plan–verify hybrid

**Decision:** keep the current loop and add no framework. Borrow single ideas from ReWOO, LLMCompiler and Magentic where they hit our measured bottleneck.

### Why not adopt one pattern whole

| Technique | How it works | Model calls for the traced 11-call turn | Why not as-is for Inspector |
|---|---|---|---|
| ReAct (today) | Reason, act with one tool step, repeat | 11 | One model call per lookup, which is our bottleneck |
| ReWOO | One planner call writes every step with placeholders; tools run without the model; one final call answers | ~2–3 | SQL can't be written before seeing the columns; a wrong plan can't adapt |
| LLMCompiler | The planner streams a dependency graph of tool calls; they run in parallel; a joiner decides to finish or replan | ~3–5 | Tool time is ~15% of latency, so parallel gains are small; a graph executor is overkill for "find table → query → answer" |
| Plan-and-execute | A plan first, then steps, then replan on failure | ~6–8 | Adds a planner call to simple questions |
| Reflexion / self-critique | The model reviews its own answer | +1–2 | Self-review without an outside signal doesn't reliably help |
| Tree search | Explore reasoning branches | many | Expensive; a poor fit for data questions |

Published benefits come from the notes behind `reports/Agent loop research.md` (ReWOO about 5× fewer tokens; LLMCompiler up to 3.7× faster, best case). They were measured on public benchmarks, not on ALOFT.

### The hybrid

```
Question
  ├─ 1 RETRIEVE  (deterministic, no model)  ReWOO idea + text-to-SQL "schema linking"
  │     research(question) + session knowledge (with columns) → compact candidate tables
  ├─ 2 ACT       (existing ReAct loop, kept)  adaptivity stays
  │     SQL in loop 1 from pre-loaded schema; independent calls in one response
  │     (LLMCompiler's parallelism without a planner); prefer one set-based query
  │     (GROUP BY) over many similar ones
  ├─ 3 PLAN      (only for 3+ part questions)  living to-do list + Magentic-style
  │     progress check: 2 loops without progress → revise plan or wrap up
  ├─ 4 VERIFY    (deterministic)  numbers trace to results; empty or truncated results
  │     and keyword-only retrieval are mentioned; totals reconcile; one revision if a check fails
  └─ 5 ANSWER    with the queries used; wrap-up when the budget is reached
```

| Stage | Borrowed from | Code it touches |
|---|---|---|
| Retrieve | ReWOO (tools without the model), schema linking (DIN-SQL, CHESS, CHASE-SQL; from prior knowledge, not re-checked) | §3A steps D2–D4: `prompts.ts`, `route.ts`, `dispatch.ts` (existing `research`) |
| Act | ReAct (kept) | `foundry-chat.ts` unchanged apart from the phase 1 fixes |
| Batch / set-based | LLMCompiler parallelism; the warehouse does the fan-out | Prompt rules in `prompts.ts` |
| Plan | Living to-do list (Claude Code, Manus), Magentic-One progress ledger (prior knowledge) | Phase 2 step 9 |
| Verify | Execution-guided correction from text-to-SQL work | Phase 4 step 12 |

### Expected effect on the traced turns (estimates, to confirm)

| Turn | Today | Hybrid |
|---|---|---|
| Simple lookup | 3 calls, 14 s, 30k tokens, no SQL | ~2 calls (SQL with pre-loaded schema, then answer), ~6–8 s |
| Complex investigation | 11 calls, 76 s, 351k tokens | ~4–5 calls, ~30–40 s, under half the tokens |
| Direct answer (no tools) | 2.1 s | unchanged: retrieval skipped by a cheap rule, not an extra model call |

### Later, for accuracy rather than speed

**Multi-candidate SQL** (the CHASE-SQL idea): 2–3 SQL versions in one model call, run in parallel, then pick the agreed result or flag the disagreement. Pilot it only if the golden set still shows wrong-SQL errors after the hybrid is in place, because it adds warehouse load.

## 5. Recommended incremental plan

Each step is separately testable and reversible. Sizes: S ≤ 1 day, M = 2–5 days. Steps are listed in order. Steps 1–3 are the smallest meaningful improvement.

### Phase 0: baseline (do first)

| # | Step | Files | Expected | Test | Rollback | Size |
|---|---|---|---|---|---|---|
| 0.1 | **Golden set:** 30–50 real questions (simple lookups, multi-table analyses, follow-ups, chart and export requests), each with expected tables, a checkable SQL result and key numbers. Plus a script that runs them and records loops, tools, tokens, latency, outcome and answer checks | new `scripts/inspector/golden/*`; reuse the read-only stats queries used for this review | A repeatable baseline | Runs twice with stable numbers | n/a | M |
| 0.2 | **Count tool errors correctly:** treat a tool result containing `error` as an error in the trajectory | `foundry-chat.ts:611-627`, `agent-loop.ts:260-300`, `route.ts:597-613` | `tool_errors` matches `tool_invocation_log` | Unit: an error JSON gives status `error`; trace check | Revert | S |
| 0.3 | **Cost truth:** price gateway ids (or read the gateway's cost header); cost errored and aborted turns; log real tool-call counts; record spend for the judge, narrative and reflection calls under their own surface | `log-agent-cost.ts`, `route.ts:563-736`, the judge, `session-knowledge-llm.ts`, `marcus/reflect.ts` | Real cost per turn, including background calls | Unit on pricing; every turn has a cost row | Revert | S–M |

### Phase 1: simplify (smallest meaningful improvements)

| # | Step | Files | Expected | Test | Rollback | Size |
|---|---|---|---|---|---|---|
| 1 | **One-call discovery:** §3A steps D1 (prompt rules) and D2 (offer `research`) now, then D3 (columns in session knowledge) and D4 (retrieve before loop 1) | `prompts.ts:18-64, 169-188`; then `session-knowledge-*.ts`, `route.ts` | Schema calls per turn fall from 6 to ≤2; loops before the first SQL fall from about 5–8 to 1–2 | Golden set: §3A metrics; answer checks don't regress | Revert the prompt; remove from enum | **S** (D1–D2), M (D3–D4) |
| 2 | **Wrap-up at the cap:** on the last allowed loop, call with no tools (or `tool_choice: 'none'`) and a "answer from what you have, say what's missing" instruction | `foundry-chat.ts:430-470, 661-668`; `route.ts:672-683` | No empty answers at the cap | Forced cap of 3 in a test still gives an answer | Revert | S |
| 3 | **Read `finish_reason`:** continue once on `length`; tell the model when its tool arguments weren't valid JSON | `foundry-chat.ts:469-506, 601` | No silently cut answers | Unit with mocked `length` finish | Revert | S |
| 4 | **Real Stop:** link the request abort to the OpenAI call's `AbortController`; skip the tool batch if aborted; label `aborted` correctly; skip bandit, judge and memory for aborted turns | `foundry-chat.ts:453-463, 597`; `route.ts:332-335, 615-740` | Stop ends the model call and no SQL runs afterwards | Route test: abort during stream → no tool executed, outcome `aborted` | Revert | S |
| 5 | **Cross-turn prompt reuse:** keep the static base, rules and tools as the system prompt; move insights, session knowledge and memory into a context message after it; cap insights (for example the last 10, 4k chars); stable per-session cache key | `route.ts:244-325`; `prompts.ts:458-483`; `foundry-chat.ts` request options | Loop 1 cache reads > 0 from the second turn; lower first-token time | Trace check on two consecutive turns; golden set unchanged | Revert | S–M |
| 6 | **Fix the duplicate question:** send the transcript without re-appending `userMsg` | `useInspectorChat.ts:297-306` | One copy of the question | Hook test asserts one user message | Revert | S |
| 7 | **Cap the SQL result the model sees:** columns, row count, the first 50 rows as compact CSV, a `truncated` note and a `result_id`; the full result stays server-side for the UI, charts and export | `tools.ts:440-454`; `emit_chart` and export use the stored result | No large results in context | Unit: a 1,000-row result produces ≤ N tokens; chart and export still work | Revert | S–M |
| 8 | **Hygiene:** raise or scope the `describe_schema` limit (pool size or per request); remove the chart-repair Bedrock call or route it through the gateway; fix contradictory tool hints (`SHOW CATALOGS`, unlisted actions) | `dispatch.ts:9-26, 194-197`; `chart-pipeline.ts:118-215`; `describe.ts:266` | Fewer odd failures | Existing tests | Revert | S |

### Phase 2: investigative planning (only if the golden set shows a need after Phase 1)

| # | Step | Files | Expected | Test | Rollback | Size |
|---|---|---|---|---|---|---|
| 9 | `update_plan` tool, offered always but used only when the question has 3+ parts; at most 6 steps; at most 2 replans with a reason; plan shown as a compact list (optional SSE event, ignored by old clients) | `prompts.ts`, `foundry-chat.ts`, `route.ts`, Inspector UI | Complex questions cover every requested part; simple ones unchanged | Golden set: completeness on multi-part questions rises; simple-question latency within 5% | Remove tool | M |
| 10 | Per-turn budget (tokens, time, tool calls) replacing the bare loop count; at the limit, wrap up (step 2) | `foundry-chat.ts`, `route.ts`, `spend/budgets.ts` | No runaway turns | Forced small budget gives a partial answer | Revert | M |

### Phase 3: parallel execution (only if valuable)

| # | Step | Expected | Size |
|---|---|---|---|
| 11 | Prompt rule: issue independent lookups and queries in the same response (they already run in parallel). Pair it with step 8's concurrency fix | Modest gains only: tool time is about 15% of latency. A dependency-aware executor (LLMCompiler-style) isn't justified by these traces | S |

### Phase 4: evidence and verification

| # | Step | Files | Expected | Size |
|---|---|---|---|---|
| 12 | **Deterministic checks before the final answer:** numbers in the answer must appear in, or be computed from, a query result in this turn; a result with 0 rows, a truncated result or a lexical-only retrieval must be mentioned; totals reconcile where a breakdown and a total both exist. A failed check triggers one revision, and is never self-critique alone | new `src/lib/inspector/verify-answer.ts`; `route.ts` before `done` | Fewer ungrounded numbers | M |
| 13 | **Provenance:** each answer lists the queries it used (SQL id, row count, run time), shown in the UI | `route.ts`, UI | Users can trace numbers | S–M |

### Phase 5: specialists

Not recommended now. The traces show one sequential chain. If discovery is still slow after step 1, a deterministic schema-research **tool** comes before any agent.

### Expected effect of Phase 0–1

These are estimates, to be confirmed on the golden set:
- complex turns drop from about 11 model calls to about 5–6, roughly halving latency and input tokens;
- no empty answers at the cap;
- Stop that actually stops;
- the first honest cost figure per turn.

## 6. Open questions for owners

1. **Who may use Inspector chat (W1)?** Should chat require `inspector:use`, like the direct SQL route? That changes access for any signed-in user who lacks it today.
2. **Default model.** Grok 4.7 through the gateway (in use since 30 Oct) loses reasoning between tool rounds on Chat Completions (`foundry-chat.ts:133-135`). Keep it, send gateway Grok through a Responses-style path, or change the default?
3. **Golden set source.** May we build it from real user questions in dev or prod sessions (privacy), or should it be written by hand with the data team?
4. **Gateway access.** Can we see the LLM Lite (LiteLLM) configuration and per-request cost output, to confirm caching, retries and reasoning pass-through?
5. **Production baseline.** May we run the same read-only aggregate queries on production logs? This review used dev only.

## Appendix: how the measurements were taken

These were read-only `SELECT` aggregates (counts and percentiles, no message content) on dev `agent_turn_log`, `agent_loop_log` and `tool_invocation_log`, filtered to `surface = 'inspector'` over the last 30 days, run on 2026-11-04. Query text: `C:\Users\SENTHI~1.S\AppData\Local\Temp\claude\56e238e746574b26\0eb560cc-92a6-41ea-b4e6-0f4fd126dd6d\scratchpad\inspector-stats*.sql.js` (to be moved into the step 0.1 script).
