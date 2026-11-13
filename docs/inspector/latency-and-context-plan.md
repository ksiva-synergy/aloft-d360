# Inspector: why simple questions are slow, and the plan to fix it without losing accuracy

| | |
|---|---|
| **Status** | Proposal. No code changed yet. |
| **Date** | 12 Nov 2026 |
| **Scope** | Ask Data / Inspector chat: `src/app/api/inspector/chat/route.ts`, `src/lib/inspector/*`, `src/lib/inspector/providers/foundry-chat.ts` |
| **Builds on** | [architecture-review.md](architecture-review.md) (4 Nov 2026). That review's Phase 1 hasn't been built yet; this document re-measures, corrects some details and adds the design for context handling and answer checks. |

---

## 0. Summary

A simple question to Inspector usually takes **35–95 seconds**, and the slowest recent one took **292 seconds**, 8 seconds short of the 300-second request limit.

The model and the warehouse work. The time goes on **how the agent works**:

1. **It takes too many steps.** The median question takes 4–5 model round trips and the slowest took 12. Each step costs 3–30 seconds of model time, plus warehouse time.
2. **Each step re-sends everything so far.** Model APIs keep no memory, so every step carries the instructions, tool definitions, question and every earlier tool result. In the slowest question that grew from 29k to 161k characters, and the turn sent 394k input tokens in total.
3. **Some of the steps are the model checking itself** (row counts, status breakdowns, date ranges), or querying the same table again for one more breakdown.
4. **Two outside factors add to this:** the Grok-4.7 model often waits 20–30 seconds before replying on a single step, and some warehouse queries take 20+ seconds.

**The fix keeps the current agent loop** (it adapts well to unfamiliar data) and changes what goes around it:

- Find the right table **before** the loop, in code.
- Keep full results **on the server** and send the model a short view with an id it can use to fetch more. Nothing is lost, only not carried.
- **Check the answer in code** instead of letting the model run its own check queries.
- **Order the prompt** so the fixed part can be cached across questions.
- Replace the step count with a **time budget** that always produces an answer.

**Accuracy is protected by design and by a gate.** Nothing the model needs becomes unreachable, totals always come from SQL rather than from a sample, and every change ships only if it scores at least as well as today on a fixed set of real questions with known answers.

Estimated effect, to be confirmed on that set: simple questions **2 model calls and about 8–15 s** (from 35–95 s), complex questions roughly **half the steps and half the input tokens**.

---

## 1. How a question runs today

```
Browser ──POST /api/inspector/chat──▶ route.ts
                                       │ build system prompt:
                                       │   base rules + semantic context
                                       │   + insights + session knowledge
                                       │   + domain focus (+ memory)          route.ts:233-246
                                       ▼
                         ┌──── agent loop (foundry-chat.ts / agent-loop.ts) ────┐
                         │  step N: send [system + tools + chat + ALL earlier   │
                         │          tool calls and results] to the model        │
                         │  model replies with tool calls  ──▶ run tools        │
                         │     (describe_schema, execute_tool, emit_chart …)    │
                         │  append calls + full results to the history          │
                         │  repeat until the model replies with text only       │
                         └──────────────────────────────────────────────────────┘
                                       │ up to 15 steps (max-loops.ts), 300 s limit (route.ts:64)
                                       ▼
                                 final answer streamed
```

**Why the history is re-sent on every step.** The model provider stores nothing between calls. Each step is a new, independent request, so the app must send everything the model should know. This is how tool calling works with every provider (OpenAI, Anthropic, xAI), so it can't be switched off. What we control:

- **how many steps** a question takes;
- **how large** each tool result is in the history;
- **how long** stale results stay;
- **whether the unchanging start of the request is cached.**

**Between questions only the chat text is sent.** Earlier questions' tool results don't carry over (`route.ts:194-212`), so the build-up happens within one question.

**Prompt caching is on within a question.** In the slowest question 345k of 394k input tokens (88%) were cache reads. Cached tokens are cheaper and faster to process, but the model still reads them every step, and the cache only covers the unchanged start of the request.

---

## 2. What we measured

### 2.1 Method

- Read-only `SELECT` queries on `agent_turn_log`, `agent_loop_log` and `tool_invocation_log`, in the database this workspace's `.env` points to. No message text was read.
- Window: last 7 days to 12 Nov 2026 10:00 UTC. The 25 most recent turns: 22 Inspector, 3 Agent Lab `agent_use`.
- Scripts are in Appendix A.

### 2.2 Inspector turns (22)

| Measure | Value |
|---|---|
| Total time | 11 s to 292 s; **median 55 s** |
| Model steps per question | 2 to 12; **median 4–5** |
| Where the time went (sum over all 22) | **model 65%**, tools 33%, other 2% |
| Input tokens, slowest question | 394k in one question (88% from cache) |
| History size at the last step | 36k to 164k characters |
| History size at step 1 | 28k to 35k characters (instructions + tools + chat) |

### 2.3 The slowest question (12 Nov 09:53, overdue crew contracts, Grok-4.7)

| Measure | Value |
|---|---|
| Total | **292 s** (limit 300 s) |
| Steps | 12; model 201 s, tools 91 s |
| Tool calls | 2 table descriptions, 1 table search, **18 SQL queries** |
| Of the 18 SQL queries | **6 checks** (counts, status distribution, date range, profile status); 1 failed after 23 s on a network error, followed by a reworked query; the rest were separate breakdowns (by rank, vessel, fleet…) that each scanned the same table with the same filters again |
| History | 29k chars at step 1 → 161k chars at step 12 |
| Slow model steps | 8 of 12 steps took 12–30 s of model time; step 6 took 30 s for 875 output tokens |

### 2.4 Model speed

| Model | Questions | Total time (median) | Model time per step |
|---|---:|---:|---|
| Grok-4.7 | 18 | 65 s | usually 3–9 s; **14–27 s** in four questions, including the two most recent |
| Gpt-6-Luna | 4 | 21 s | 3.5–5.7 s |

The Luna questions also took fewer steps (2–4), so this comparison is a hint, not proof. Grok's slow steps happen with small inputs too: an Agent Lab step with 3.8k input tokens waited 22 s before its first token. That points to model-side reasoning or gateway queueing rather than context size.

### 2.5 Tool times (7 days)

| Tool / action | Calls | Median | 90th pct | Max |
|---|---:|---:|---:|---:|
| `execute_tool` (warehouse SQL) | 347 | 1.8 s | **13.2 s** | 33.6 s |
| `describe_schema` search | 207 | 2.0 s | 2.6 s | 18.2 s |
| `describe_schema` describe | 278 | 0.4 s | 0.9 s | 21.0 s |
| `describe_schema` profile | 42 | 0.5 s | 1.4 s | 2.9 s |
| `describe_schema` research | 12 | 0.3 s | 0.3 s | 0.3 s |

The few `research` calls came from other callers. Inspector's tool definition doesn't offer that action (see P2).

Stored output size (the tool log keeps a redacted, size-capped copy, so these are lower bounds):

| Tool / action | Median | 90th pct |
|---|---:|---:|
| `describe_schema` research | 9.1k chars | 9.3k |
| `describe_schema` describe | 6.4k chars | 7.1k |
| `describe_schema` profile | 3.5k chars | 5.7k |
| `describe_schema` search | 3.3k chars | 4.4k |

### 2.6 Prompt cache at step 1

Of the 7 Inspector questions examined step by step, **6 read 0 tokens from the cache at step 1**. The seventh read 5.2k. Within a question, cache reads rise to 80–95% of input from step 2 onward.

### 2.7 Corrections to figures given earlier in chat

- The two queries at 09:44 were **not identical**. They share the same base and differ later on. Both took 21 s, which is warehouse time.
- In the 292-second question, **6 of 18** queries were checks, not "about half".
- The query that failed on a network error was followed by a **reworked** query, not a straight retry.
- Step 1 cache reads are zero in **most**, not all, questions.

### 2.8 Limits of the measurements

- The tool log stores redacted, truncated inputs and outputs, so true SQL result sizes in the history can't be measured from it. History growth per step (`agent_loop_log.context_chars`) is measured directly.
- 22 questions over a few days, mostly from a small number of people.
- Connecting to the app database timed out in 3 of 6 script runs (pool timeout). The turn timings show app-database time is not on the critical path ("other" ≈ 0.1 s per question), so this wasn't investigated further.

---

## 3. Problems and fixes

Each problem has: what happens today, the evidence, why it costs time, the fix, and why the fix doesn't cost accuracy. File references are as of 12 Nov 2026.

### P1. The model checks its own work with extra queries

- **Today:** Before answering, the agent runs check queries such as `COUNT(*)`, `COUNT(DISTINCT …)`, status distributions and `MIN/MAX(date)`. It also runs one query per breakdown instead of one grouped query.
- **Evidence:** 6 of 18 queries in the 292-second question were checks, and most of the rest re-scanned the same table with the same filters (§2.3).
- **Why it costs time:** each check is a full model round trip (the model re-reads the whole history) plus warehouse time. That's 5–30 s each.
- **Fix:**
  1. Prompt rule: don't run check queries; prefer one grouped query (`GROUP BY`, `GROUPING SETS`, conditional `SUM(CASE …)`) over several similar ones (§5.6).
  2. The checks move into code after the answer is drafted (P7).
  3. Breakdowns of a result already in hand can be computed exactly by `read_result` without a new query, provided the stored result is complete (§5.3).
- **Accuracy:** It improves. Code checks every answer against the actual results; the model only checks when it happens to.
- **Files:** `src/lib/inspector/prompts.ts:17-63`; P7 and §5.3 files.

### P2. Finding the right table takes several steps

- **Today:** The agent searches, then describes a table, then describes another, one step each. The prompt says "describe_schema is free… Use it liberally for discovery" (`prompts.ts:62`). The one-call `research` action returns the best candidate tables with their columns and relationships, and the server already handles it (`src/lib/context/dispatch.ts:155`). Inspector's tool definition doesn't offer it (`prompts.ts:179` lists only `list, describe, profile, search, relations`).
- **Evidence:** In the last 7 days there were 207 searches and 278 describes against 347 SQL queries. About half the describes ask for every column (architecture review §3A).
- **Why it costs time:** the lookups are cheap (0.3–2 s), but each one is a model round trip of 3–10 s.
- **Fix, in two stages:**
  1. **Prompt and tool definition (small):** offer `research` and make it the default first lookup. Allow at most 2 lookups before the first SQL, all independent lookups in one response, and `detail: 'full'` only when the short card lacks a needed column.
  2. **Look up before the loop (medium):** for data questions not covered by session knowledge, the route calls `research` itself with the question and adds the short candidate cards as a context message. Step 1 can then write SQL straight away. It costs no model call. Greetings, meta questions and covered follow-ups skip it.
- **Accuracy:** the model receives the same information as from search plus describe, in one piece. If the cards don't cover what it needs, it can still call `describe_schema`.
- **Files:** `prompts.ts:17-63, 171-190`; `route.ts` before the loop (around line 330); `src/lib/context/dispatch.ts` (existing `research`).

### P3. Every SQL result goes to the model in full and stays in the history

- **Today:** `execute_tool` returns the full warehouse result as JSON to the model (`tools.ts:478-479`). Today's commit `2fb0d78c` raised the row limit from 1,000 to 5,000 (`result-display.ts:147`). The result stays in the history and is re-sent on every later step.
- **Evidence:** the model normally writes `LIMIT 100` and most queries are small totals, so this hasn't hurt yet. But nothing stops a large result: a query without a small `LIMIT` returns up to 5,000 rows to the model.
- **Why it costs time:** large results slow every later step, raise cost, and make the model's job harder. The screen already gets rows through the separate `query_result` event, so the model doesn't need all of them to show the table.
- **Fix:** a **result store** plus a **short model view** (§5.1, §5.2):
  - Every result is kept on the server with an id (`r1`, `r2`, …).
  - Small results go to the model in full: up to 50 rows and 8,000 characters. That covers totals, top-N lists and most answers.
  - Large results go as columns, the **exact** row count, the first 30 rows, per-column statistics computed on the full stored rows, the id, and a `complete` flag saying whether the stored rows are the whole warehouse result.
  - A new `read_result` tool (§5.3) returns more rows, a filtered or sorted slice, or exact aggregates, without running SQL again.
  - `emit_chart` and `export_query_result` take the id. Both already read from the per-question result list (`tools.ts:213, 322`), so this is a small change.
- **Accuracy:** nothing is lost, only not carried. Totals and counts still come from SQL or exact server-side aggregation. Charts and exports use exactly the data the answer used.
- **Files:** `tools.ts:440-480`, `result-display.ts`, `route.ts:357-370` (`sessionQueryResults`), tool definitions in `prompts.ts`.

### P4. Table descriptions and old results stay in the history for the whole question

- **Today:** results from step 1 are still re-sent at step 12. A full table description is 6–9k characters (§2.5).
- **Evidence:** history grew from 29k to 161k characters across 12 steps in the slowest question (§2.3).
- **Why it costs time:** once the agent has picked its table and columns, the full descriptions only slow each step.
- **Fix:**
  1. Short table cards by default: the relevant columns, types, keys and join hints. The full description is stored under an id and fetched with `read_result`.
  2. **Shorten older results:** when history passes about 60k characters, results older than the last two steps are replaced by a one-line note with their id. This is done in **one batch**, then not again until history grows by another 40k (§5.4).
- **Accuracy:** anything shortened is still one `read_result` away. The latest two steps are never shortened.
- **Cache trade-off:** changing anything early in the history breaks the cache from that point, so the next step costs full price once. Doing it in rare batches keeps the saving well above that cost; doing it every step would not.
- **Files:** `foundry-chat.ts` (message history around lines 669 and 729-731), `agent-loop.ts` (Bedrock path), `measureContext` in `agent-loop.ts`.

### P5. The same table is queried again for each new view

- **Today:** to show the same records by rank, then by vessel, then by fleet, the agent writes a new query each time, all on the same table with the same filters (§2.3, steps 9–11).
- **Fix:**
  1. Prompt rule: one grouped query covering the breakdowns needed (P1).
  2. When a complete detail result is already stored, `read_result` with `group_by` computes the breakdown exactly on the server, with no warehouse call and no new model-written SQL.
  3. Safeguard: an identical SQL statement run again in the same question returns the stored result. It's cheap to add, though no exact duplicate was found in this sample.
- **Accuracy:** server-side aggregation is exact, but it's only allowed when the stored result is complete (`complete: true`). Otherwise the tool refuses and the model writes an aggregate SQL query.
- **Files:** `tools.ts` (`execute_tool` and the new `read_result`).

### P6. Nothing can be cached across questions

- **Today:** the system prompt is the base rules plus per-question context: insights, session knowledge and domain focus, joined into one string (`route.ts:246`), and with memory injection on, more after it. Domain focus depends on the chat messages, and insights and session knowledge change as the session goes on, so **the start of the request differs on every question**. The direct-xAI path also sets a new random `prompt_cache_key` per question (`foundry-chat.ts:239`).
- **Evidence:** 6 of 7 questions read 0 tokens from the cache at step 1 (§2.6).
- **Why it costs time:** the fixed instructions and tool definitions (about 28–35k characters) are paid for in full at the start of every question.
- **Fix:** put the fixed parts first, in an order that never changes (§5.5):
  1. system prompt = base rules and semantic context only (stable per organisation and connection);
  2. tool definitions (stable);
  3. a **context message** with insights, session knowledge, domain focus and memory;
  4. the chat;
  5. the table cards from P2;
  6. the question.

  Use a stable cache key per session on the direct-xAI path.
- **Accuracy:** the model receives exactly the same content, in a different order.
- **Files:** `route.ts:233-325`, `prompts.ts` (`buildSystemPrompt`), `foundry-chat.ts:239, 282`.

### P7. Nothing checks the answer in code

- **Today:** the only checking is the model's own extra queries (P1). Nothing confirms that the numbers in the reply came from a result in this question.
- **Fix:** an **answer check** after the model's final draft, before it's shown (§5.7):
  - every number in the answer must match a stored result value, or a total, difference or percentage computed from stored values;
  - a breakdown must add up to its total where both are shown;
  - a result with 0 rows or a cut-off result must be mentioned.

  If a check fails, the model gets **one** revision step that names the exact problem. Start in **observe mode** (log only) to measure false alarms before turning it on.
- **Accuracy:** this is the main accuracy gain in the plan. It replaces the model's optional self-checks with a check on every answer.
- **Files:** new `src/lib/inspector/verify-answer.ts`; `route.ts` before the final `done` event.

### P8. Long questions can run out of time with no answer

- **Today:** the only limit is 15 steps (`max-loops.ts`). The request is stopped at 300 s (`route.ts:64`). Neither has a proper wrap-up: on the last step tools are still offered when the history contains tool calls (`agent-loop.ts`, `mustIncludeToolConfig`), so the question can end with no answer.
- **Evidence:** the 292-second question finished 8 s short of the limit.
- **Fix:** a **turn budget** of time (for example 240 s), input tokens and steps. When any is reached, the model gets one final call **without tools**, told to answer from what it has and say what's missing (§5.8).
- **Accuracy:** a partial answer that says what's missing beats a cut-off reply or none at all.
- **Files:** `max-loops.ts`, `foundry-chat.ts`, `agent-loop.ts`, `route.ts`.

### P9. Slow model and slow warehouse (settings, not code)

- **Model:** Grok-4.7 is usually 3–9 s per step but averaged 14–27 s per step in four questions, including the two most recent, with 20–30 s waits before the first token on single steps (§2.4).
  - **Fix:** choose the default Inspector model (Settings → `inspector_chat`) by measured accuracy **and** speed on the test set (§6). Consider a lower reasoning setting for Grok if the gateway supports it.
- **Warehouse:** 1 in 10 queries takes over 13 s and some take 20–34 s (§2.5), which looks like start-up or queueing.
  - **Fix:** review the Databricks SQL warehouse's auto-stop, minimum clusters and size. Make network errors fail fast with a shorter timeout and one retry, instead of a 23-second hang.
- **Accuracy:** the model is switched only if it scores at least as well on the test set.

---

## 4. Target design

```
Question
 │
 ├─ 1. ROUTE (code)            greeting/meta → answer directly
 │                             follow-up covered by session knowledge → skip step 2
 │
 ├─ 2. RETRIEVE (code)         research(question) → 3–5 short table cards
 │                             (key columns, join keys, known filter values, usual filters)
 │
 ├─ 3. ACT (existing loop)     step 1 can write SQL from the cards
 │                             independent calls together; one grouped query
 │                             turn budget: time, tokens, steps → final step without tools
 │        │
 │        └─ CONTEXT MANAGER  (every tool result passes through it)
 │             RESULT STORE   full rows and full table descriptions, by id
 │             MODEL VIEW     small → in full; large → summary + id
 │             read_result    rows / filter / sort / exact aggregates, by id
 │             same SQL again → stored result
 │             history > ~60k chars → older results become one-line notes (one batch)
 │
 ├─ 4. VERIFY (code)           numbers trace to stored results; totals reconcile;
 │                             empty / cut-off results mentioned → at most one revision
 │
 └─ 5. ANSWER                  with sources (queries, row counts)
                               charts and CSV export by result id
```

**Why not a planner, multiple agents or a framework?** The time goes on the number of model round trips and on history size. A planner adds a round trip to every question, and the architecture review (§4, §4A) compared LangGraph and Deep Agents and found that neither removes these two costs. This design removes round trips in code and keeps the loop's ability to adapt.

---

## 5. Design details

### 5.1 Result store

| Aspect | Decision |
|---|---|
| **What is stored** | Every `execute_tool` result (columns, rows, exact row count, SQL, `complete` flag, access note) and every `describe_schema` result (full text) |
| **Id** | `r1`, `r2`, … per question; returned in the model view |
| **Where (v1)** | In memory for the length of one question, extending the existing `sessionQueryResults` list (`route.ts:357`). No new storage. |
| **Where (v2, later)** | Kept per session for follow-up questions ("now split that by vessel"), for example 24 hours, with ids listed in session knowledge. Only if v1 shows follow-ups re-querying often. |
| **Size** | Up to `CHAT_QUERY_RESULT_MAX_ROWS` (5,000) rows per result, as today |
| **`complete`** | `true` when the warehouse returned every row (`!truncated` and `row_count == rows.length`). Exact aggregates in `read_result` require it. |
| **Access** | Results are stored **after** column masking by `runWarehouseQuery`, so protected values stay `•••`. Lookups are scoped to the session and checked the same way as the chat request (`guardInspectorChat`). |

### 5.2 Model view of a tool result

**SQL result, small** (≤ 50 rows and ≤ 8,000 characters): unchanged content, plus `result_id` and `complete`.

**SQL result, large:**

```json
{
  "result_id": "r3",
  "complete": true,
  "row_count": 1236,
  "columns": ["seafarer_name", "rank", "vessel", "days_overdue"],
  "rows_shown": 30,
  "rows": [["…", "…", "…", 41], "… 29 more"],
  "column_stats": {
    "rank":         { "distinct": 18, "top": [["AB", 212], ["OS", 160], ["Oiler", 97]] },
    "vessel":       { "distinct": 143 },
    "days_overdue": { "min": 1, "max": 212, "sum": 40211, "nulls": 0 }
  },
  "display_note": "…existing note from largeResultDisplayNote…",
  "note": "First 30 of 1,236 rows. Use read_result with result_id r3 for more rows, filters or exact counts by group. Do not estimate totals from these 30 rows."
}
```

Rules:
- Rows go as arrays, with column names listed once.
- Statistics are computed on **all** stored rows, never on the 30 shown.
- If `complete` is `false`, the note says the stored rows are a capped subset and totals must come from an aggregate SQL query.
- Access notes (`access_note`) are always passed through unchanged.

**Table description:** a short card by default, with table path, a one-line purpose, the 15–25 most relevant columns (types plus semantic notes), keys and related tables, and `result_id` for the full description.

### 5.3 New tool: `read_result`

```json
{
  "name": "read_result",
  "description": "Read more of a stored result without running SQL again: more rows, a filtered or sorted slice, or exact counts and totals by group. Aggregates are only allowed when the result is complete.",
  "parameters": {
    "result_id": "string (required)",
    "columns":   "string[] (optional)",
    "where":     "[{ column, op: '='|'!='|'>'|'>='|'<'|'<='|'in'|'contains'|'is_null'|'not_null', value }] (optional)",
    "order_by":  "[{ column, dir: 'asc'|'desc' }] (optional)",
    "offset":    "integer ≥ 0 (default 0)",
    "limit":     "integer 1–200 (default 50)",
    "group_by":  "string[] (optional)",
    "aggregates":"[{ fn: 'count'|'count_distinct'|'sum'|'avg'|'min'|'max', column? }] (optional)"
  }
}
```

- Runs in code on the stored rows. No warehouse call and no model-written SQL.
- `group_by` or `aggregates` on a result with `complete: false` returns `RESULT_INCOMPLETE` with the advice "run an aggregate SQL query instead". This rule keeps it exact.
- Masked (`•••`) values are never aggregated. `sum`/`avg` on a masked column return `ACCESS_DENIED` for that column, matching the existing protected-data rules.
- Output follows the same model view rules (§5.2).

### 5.4 Shortening older results

| Rule | Value |
|---|---|
| Trigger | History > 60,000 characters (`measureContext`), checked before each step |
| What is shortened | Tool results older than the last two steps |
| Replaced with | `{"stored": true, "result_id": "r3", "summary": "1,236 rows; columns …; overdue crew by rank"}`. For table descriptions: path plus the columns used in SQL so far. |
| Never shortened | The last two steps; error messages from the last step; access notes (kept as one line) |
| How often | Once, then not again until history grows by another 40,000 characters |
| Cache | One cache rewrite per batch; all later steps read the shorter history from cache |

Expected to be needed only for long investigations once P1–P3 are in. Build it last and only if measurements still show large histories.

### 5.5 Prompt order for caching

| Position | Content | Changes when |
|---|---|---|
| 1 | Base rules + semantic context (`buildSystemPrompt`) | Rules or semantic layer change (rare) |
| 2 | Tool definitions | Code release |
| 3 | Context message: insights, session knowledge, domain focus, operating memory | Each question (but after the fixed part) |
| 4 | Earlier chat (text only) | Each question |
| 5 | Table cards from step 2 | Each question |
| 6 | The question | Each question |

For Claude through the gateway, `gatewayCacheParams` (`foundry-chat.ts`) already places cache markers. Keep one marker after position 2, so it's shared across questions, and the moving marker on the last message. OpenAI-style models (Grok, GPT) cache a stable prefix automatically. The direct-xAI Responses path should use a per-session `prompt_cache_key` instead of `randomUUID()`.

### 5.6 Prompt rules (draft)

These replace "describe_schema is free… Use it liberally for discovery." (`prompts.ts:62`) and add a section to the workflow:

```
## STEP BUDGET
- Every tool call is a round trip the person waits for. Answer a simple question in
  2–3 steps; a multi-part question in at most 6.
- If CATALOG CANDIDATES, SESSION KNOWLEDGE or DOMAIN FOCUS name the table, write SQL now.
  Otherwise make ONE describe_schema research call. At most 2 schema calls before the
  first SQL. Use detail:'full' only when the short card lacks a column you need.
- Put independent calls in the same response; they run in parallel.
- Do not run queries to check your own result (row counts, status breakdowns, date
  ranges). The server checks your answer. Run one only when a result is empty or
  clearly contradicts the question.
- Prefer one grouped query (GROUP BY, GROUPING SETS, SUM(CASE …)) over several similar
  queries on the same table.
- To see more of a result you already have, or to break it down, use read_result with
  its result_id. Do not run the same query again.
- Never estimate a total from shown rows; use row_count, column_stats, read_result
  aggregates or an aggregate SQL query.
```

### 5.7 Answer check

| Check | How | On failure |
|---|---|---|
| Numbers trace to results | Extract numbers from the draft (counts, amounts, percentages; ignore years, dates, list numbering and numbers that appear in the question). Each must equal a stored value, a `row_count`, a `column_stats` value, a `read_result` aggregate, or a sum, difference or percentage of two of these, at the shown precision. | Revision: "These numbers aren't in any result: … Use a result or remove them." |
| Totals reconcile | When a table and a stated total are both present, the column sum must equal the total, or the answer must say why (e.g. "top 10 of 143") | Revision naming the mismatch |
| Empty and cut-off results | If the answer relies on a result with 0 rows or `complete: false`, the answer must say so | Revision asking for one plain sentence |
| Headcount consistency | Already a prompt rule (`answer-rules.ts`); checked in code against `row_count` | Revision |

- **At most one revision.** If the revised draft still fails, send it with the failure logged, rather than looping.
- **Roll out in two stages.** Observe mode first: log failures to `agent_turn_log` with no revision, to measure false alarms on the test set and real traffic. Enforce once false alarms are under about 2% of answers.

### 5.8 Turn budget and wrap-up

| Limit | Default | When reached |
|---|---|---|
| Time | 240 s from request start (60 s headroom under `maxDuration = 300`) | Final call without tools |
| Steps | 15 (`INSPECTOR_MAX_LOOPS`) | Final call without tools |
| Input tokens | for example 400k per question | Final call without tools |

The final call has no tool definitions and a short instruction: "Answer from the results you have. Say in one line what you couldn't finish." The outcome is recorded as `budget_wrap_up` so these turns can be tracked.

---

## 6. Accuracy safeguards and the test set

**The rule: a change ships only if accuracy is the same or better.**

| Part | Detail |
|---|---|
| **Test set** | 30–50 real questions: simple lookups ("how many crew are overdue"), lists, breakdowns, multi-table questions, follow-ups, chart and export requests, and protected-data cases. Each has the expected table(s), a reference SQL query and its checked key numbers. |
| **Runner** | A script that sends each question to `/api/inspector/chat` with a service token and records: answer correct (key numbers match), steps, SQL calls, schema calls, input tokens, cache reads, time, outcome, answer-check result. |
| **Baseline** | Run twice on today's code before any change, to see run-to-run variation |
| **Gate** | Correct answers ≥ baseline (within run-to-run variation); no new protected-data leaks; then compare speed and tokens |
| **Where** | `scripts/inspector/golden/` (planned as step 0.1 in the architecture review) |

Built-in safeguards in the design:
- Shortened data is always fetchable by id (§5.1–5.4).
- Totals never come from samples (§5.2, §5.3 `complete` rule).
- Charts and exports use the exact stored result (P3).
- Masked values stay masked in the store and in `read_result` (§5.1, §5.3).
- The answer check runs on every answer (§5.7).
- The loop stays adaptive: the model can still call any tool when the cards or views aren't enough.

---

## 7. Rollout plan

Sizes: S ≤ 1 day, M = 2–5 days. Each step is measured on the test set before the next.

| # | Change | Problems | Files | Size | Test | Rollback |
|---|---|---|---|---|---|---|
| 0 | Test set, runner and baseline | all | `scripts/inspector/golden/*` | M | Two baseline runs agree | n/a |
| 1 | Prompt rules (§5.6); offer `research`; short cards by default | P1, P2 | `prompts.ts` | **S** | Test set: correct ≥ baseline; schema calls ≤ 2 before first SQL | Revert prompt |
| 2 | Turn budget and wrap-up without tools (§5.8) | P8 | `foundry-chat.ts`, `agent-loop.ts`, `route.ts`, `max-loops.ts` | S | Forced 3-step budget still gives an answer | Revert |
| 3 | Result store, model view, `read_result`, same-SQL reuse; charts and export by id | P3, P5 | `tools.ts`, `result-display.ts`, `route.ts`, `prompts.ts` | M | Unit: a 1,000-row result → view ≤ 10k chars; aggregates exact; `complete: false` refuses; masked columns refused. Test set unchanged or better. | Feature flag `INSPECTOR_RESULT_VIEW=off` |
| 4 | Prompt order for caching (§5.5); per-session cache key | P6 | `route.ts`, `prompts.ts`, `foundry-chat.ts` | S–M | Step 1 cache reads > 0 from the second question of a session | Revert |
| 5 | Look up before the loop (`research` in the route) | P2 | `route.ts`, `dispatch.ts` | M | Steps before first SQL ≤ 1 on simple questions; test set unchanged or better | Flag |
| 6 | Answer check, observe mode, then enforce | P7, P1 | new `verify-answer.ts`, `route.ts` | M | False alarms < 2% on test set; caught errors listed | Flag |
| 7 | Shorten older results (only if histories still > 60k) | P4 | `foundry-chat.ts`, `agent-loop.ts` | S | Long questions: history stays < 80k; test set unchanged | Flag |
| — | Model choice and warehouse settings | P9 | Settings, Databricks | — | Test set on 2–3 models: accuracy then speed | Settings |

Steps 1 and 2 are small, low-risk, and expected to give most of the speed gain. Step 3 removes the size risk and enables step 6.

---

## 8. Metrics and targets

All from `agent_turn_log` / `agent_loop_log` / `tool_invocation_log` and the test set. Targets are estimates, to be confirmed.

| Metric | Today (§2) | Target |
|---|---|---|
| Correct answers on test set | baseline (to measure) | ≥ baseline |
| Median time, simple question | ~35–55 s | 8–15 s |
| Median model steps per question | 4–5 | 2 (simple), ≤ 6 (complex) |
| Schema calls before first SQL | 0–7 in this sample | ≤ 1 with step 5, ≤ 2 without |
| Check queries per question | up to 6 | ~0 (answer check instead) |
| History at last step | 36k–164k chars | < 60k for most questions |
| Step-1 cache reads | 0 in 6 of 7 | > 0 from the second question of a session |
| Questions ending without an answer | not tracked | 0 (wrap-up) |
| Answer-check failures after revision | not tracked | tracked; falling |

---

## 9. Risks and open questions

| Risk / question | Mitigation / owner |
|---|---|
| The model ignores the step rules and still probes | Step 6 (answer check) removes the reason to probe; the turn budget caps the cost. Measure on the test set. |
| The answer check flags correct numbers (false alarms) | Observe mode first; ignore list for years, dates and numbers from the question; at most one revision |
| `read_result` on a capped result gives wrong totals | Refused unless `complete: true` (§5.3) |
| Shortening breaks the cache too often | One batch per +40k characters (§5.4); built last and only if needed |
| Pre-loop lookup picks the wrong tables | Cards are labelled "candidates, verify before use"; the model can still search. Compare step 5 against step 1 alone on the test set. |
| Session-level result store (v2) holds data longer | Masked data only, session-scoped, short expiry; decide with the data owner before building v2 |
| Which model should be the default? | Product owner, after the test-set comparison (P9) |
| Warehouse start-up delays | Platform owner: Databricks warehouse auto-stop, minimum clusters and size |

---

## 10. Relation to the architecture review

| Architecture review item | This document |
|---|---|
| §3A D1–D2 (prompt rules, offer `research`) | Step 1, re-confirmed: still not built (`prompts.ts:62, 179`) |
| §3A D4 (look up before the loop) | Step 5 |
| Phase 1 step 2 (wrap-up at the cap) | Step 2, extended to a time and token budget |
| Phase 1 step 5 (cross-turn prompt reuse) | Step 4, re-confirmed by step-1 cache data |
| Phase 1 step 7 (cap the SQL result the model sees) | Step 3, extended: result store, `read_result` with exact aggregates, `complete` rule |
| Phase 4 step 12 (deterministic checks) | Step 6, with observe-then-enforce and check rules |
| **New here** | Treating the model's check queries as a cause of latency (P1); `read_result` aggregates to avoid re-querying (P5); shortening policy (§5.4); 300 s limit risk (P8); model speed comparison (§2.4) |

---

## Appendix A: measurement scripts (read-only)

The scripts were run from the repo root with `node --env-file=.env <script>`. They load `@prisma/client` from this repo and run `SELECT` only.

**Recent turns and per-step timings**

```sql
SELECT turn_id, surface, model, started_at, duration_ms, first_token_ms, llm_ms, tool_ms,
       loops, tool_calls, tool_errors, input_tokens, output_tokens, cache_read_tokens,
       peak_context_chars, outcome
FROM agent_turn_log
WHERE started_at > now() - interval '7 days'
ORDER BY started_at DESC LIMIT 25;

SELECT turn_id, loop, llm_ms, first_token_ms, tool_ms, input_tokens, output_tokens,
       cache_read_tokens, context_chars, tool_calls, stop_reason
FROM agent_loop_log WHERE turn_id = ANY($1::text[]) ORDER BY turn_id, loop;
```

**Tool time and output size by tool and action**

```sql
SELECT tool_name, COALESCE(input->>'action', input->'args'->>'action', '') AS action,
       count(*)::int AS n,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS p50,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY duration_ms)::int AS p90,
       max(duration_ms)::int AS max,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY length(output::text))::int AS out_p50
FROM tool_invocation_log WHERE created_at > now() - interval '7 days'
GROUP BY 1, 2 ORDER BY p50 DESC;
```

**Tool sequence for one question** (session id plus the turn's time window)

```sql
SELECT loop, tool_name, status, duration_ms, input
FROM tool_invocation_log
WHERE session_id = $1 AND created_at BETWEEN $2 AND $3
ORDER BY created_at;
```
