# Current ALOFT agent execution loop — code audit against agent-engineering practice

Scope: code read on branch `feature/ui-redesign`, 2026-11-04. Every citation is `path:line` in the current working tree. "Verified" = read directly in code. "Inference" = reasoning from code plus known provider/SDK behaviour, not exercised at runtime. Provider API behaviour (Anthropic, OpenAI, xAI, AWS SDK) is stated from general knowledge, not from code, and is marked as such.

## Q0. Which loop actually runs in production? (prerequisite for every other answer)

### Takeaway
The two main interactive surfaces (Inspector chat and saved-agent chat / Automate "Try") never reach the Bedrock `runAgentLoop`. They always go to `runFoundryAgentLoop` → OpenAI Chat Completions against the LLM Lite gateway. So the settings most people associate with "the agent loop" (temperature 1/0.3, 1024 thinking budget, Bedrock cachePoint, last-loop tool removal) do not apply to them. Even the design doc and the earlier harness-gaps report describe the Bedrock path as if it were the production path.

### Cited Findings
- Inspector: the effective model key is forced to an LLM Lite key: "Only LLM Lite models are served; any other/legacy key falls back to the default" — `src/app/api/inspector/chat/route.ts:170-171`. `MODELS_MAP` is empty — `route.ts:69-71`.
- `resolveModel` always returns `llmLiteInspectorRuntimeConfig(...)` — `route.ts:83-90`, and that sets `bedrockId: ''` and `foundryDeployment: gatewayModelId` — `src/lib/llmlite/inspector-models.ts:40-47`. So `isFoundryModel` is always true — `route.ts:202`.
- `boostModel` is built from the LLM Lite key with `apiType: 'foundry', resource: 'llmlite'` — `route.ts:417-420`, `src/lib/llmlite/inspector-models.ts:27-38`. Gateway ids look like `aws_bedrock/xAI-Grok-4.7` (`src/lib/llmlite/default-model.ts:2`), so they never match a `BOOST_MODELS.modelId` (`src/lib/boost/models.ts:16-68`) at `route.ts:413-415`.
- Dispatch: `isFoundryModel && boostModel ? dispatchAgentLoop(...) : runAgentLoop(...)` — `route.ts:555-557`, and `dispatchAgentLoop` sends `apiType === 'foundry'` to `runFoundryAgentLoop` — `src/lib/inspector/providers/factory.ts:10-12`. With `resource: 'llmlite'`, `runFoundryAgentLoop` uses the Chat Completions branch, not the xAI Responses branch — `src/lib/inspector/providers/foundry-chat.ts:409-411, 456-463`.
- Saved agents: `resolveWorkbenchModel` always returns a `boostModel` from `boostModelFromLlmLiteKey` — `src/lib/construction/workbench-model.ts:40-50`. `runCatalogAgent` then calls `boostModel ? dispatchAgentLoop(...) : runAgentLoop(...)` — `src/lib/agents/run-catalog-agent.ts:326`, so Bedrock `runAgentLoop` is unreachable there too.
- Bedrock `runAgentLoop` is still reached directly by the semantic blueprint routes (`src/app/api/inspector/semantic/[modelId]/blueprint/route.ts:148`, `.../refine-item/route.ts:147`), by flows-copilot when no boost model resolves (`src/lib/flows-copilot/propose.ts:238`) and by workbench chat/test-run fallbacks (`src/app/api/agent-lab/workbench/chat/route.ts:253-254`, `.../test-run/route.ts:155-156`).
- The design doc still says "`runAgentLoop` already supports `cacheSystemPrompt`. Use it…" — `docs/business-ai-studio/04-harness-skills-reasoning.md:84`. The harness-gaps report says "`maxTokens: 4096` and `temperature: 0.3` are hardcoded" for agents, citing `agent-loop.ts:174-175` — `reports/Agent builder harness gaps.md:42`. On the live agent path no temperature is sent at all (see Q6).

### Inferences
- There are three separate loop implementations with copy-pasted control flow (Bedrock ReAct `agent-loop.ts:120-347`, Chat Completions `foundry-chat.ts:406-684`, xAI Responses `foundry-chat.ts:189-402`). Fixes land in one and not the others (examples below: abort checks, per-tool exception handling, last-loop handling, cache flags). The production path is the least capable of the three.

### Gaps
- The LLM Lite gateway (LiteLLM-style proxy, inferred from `/v1` base URL at `foundry-chat.ts:35-42`) configuration was not visible in the repo. So it is unknown whether the gateway adds caching, retries, or reasoning parameters itself.

## Q1. Context growth: history, trimming, compaction, long chats

### Takeaway
Within a turn, the conversation only grows: every assistant message and every full tool result is appended and re-sent on every loop. Nothing trims, summarises or offloads it. Context size is measured per loop but never acted on. Across turns, the Inspector re-sends the whole client-held transcript with no cap. Saved agents cap history at 30 messages / 60k chars. Both drop prior tool calls and results; the Inspector partly compensates with a bounded SESSION KNOWLEDGE block.

### Cited Findings
- Within-turn growth (Bedrock): `messages = [...messages, { role: 'assistant', ... }, { role: 'user', content: userContent }]` after every tool batch — `src/lib/inspector/agent-loop.ts:312`. Tool result text is inlined verbatim: `content: [{ text: toolResult }]` — `agent-loop.ts:308-310`.
- Within-turn growth (production Chat Completions path): `messages.push(assistantMsg)` and `messages.push({ role: 'tool', ..., content: r.content })` — `foundry-chat.ts:595, 656-658`. xAI path: `inputItems = inputItems.concat(completed.output)` and `.concat(toolResults)` — `foundry-chat.ts:309, 377`.
- Context is measured but only logged: `measureContext` computes `contextChars` (system + JSON of messages) — `agent-loop.ts:57-65`. It is reported in `LoopMetrics` "shows context growth per loop" — `agent-loop.ts:50-52`, used at `agent-loop.ts:185, 249` and `foundry-chat.ts:219, 446`. No code reads it to trim, summarise or stop.
- Inspector cross-turn history: the client sends the whole local transcript on every turn: `messages: [...allMessages.filter(m => m.id !== assistantMsgId), userMsg]` — `src/hooks/useInspectorChat.ts:306`. The server only filters empties and merges consecutive same-role messages — `src/app/api/inspector/chat/route.ts:206-224`. There is no count cap, no char cap and no summarisation (compare `MAX_HISTORY = 30`, `MAX_MESSAGE = 8000` in the agents route, `src/app/api/agent-lab/agents/chat/route.ts:25-26`).
- Only text survives across turns: history is built as `content: [{ text: m.content }]` — `route.ts:208-211`. The Chat Completions converter also drops every non-text block: `if ('text' in block) return block.text; return ''` — `foundry-chat.ts:90-99`. Prior SQL and results reach the model only through SESSION KNOWLEDGE in the system prompt.
- SESSION KNOWLEDGE is a bounded cross-turn memory: last 12 query SQLs scanned (`src/lib/inspector/session-knowledge-store.ts:108-113`), ≤48 schema paths, ≤20 heuristics (`:166-167`), and the last SQL truncated to 1200 chars (`:159`). This is the only compaction-like mechanism in the codebase.
- PRIOR ANALYSIS INSIGHTS are uncapped: every `studio_insights` row for the session is concatenated into the system prompt — `src/lib/inspector/prompts.ts:458-483` (no `take`, no char cap). This grows with every analysed query in a session.
- Saved agents: `historyForModel` keeps the last 30 messages and drops oldest until ≤60,000 chars — `src/lib/agents/agent-chats.ts:30-31, 66-83`. Service callers may send ≤30 messages of ≤8000 chars — `src/app/api/agent-lab/agents/chat/route.ts:25-26, 31-51`. This is plain truncation, not summarisation.
- Saved-agent chat history is polluted with interim narration. The route accumulates every streamed delta from every loop (`reply += delta`, `agents/chat/route.ts:166-169`) and saves `reply.trim() ? reply : finalText` (`:201-203`). `runCatalogAgent` never wires `onTextReplace` (the loop params at `run-catalog-agent.ts:261-322` have no `onTextReplace`). So the saved assistant message, and the history replayed next turn via `historyForModel`, contains all the pre-tool "I'll look up…" text from every loop, not just the final answer.

### Inferences
- With 15 loops (`src/lib/inspector/max-loops.ts:2`), each possibly carrying a 1000-row result (Q2), a single Inspector turn can send the same large result 10+ times. Input tokens therefore grow roughly quadratically with loop count. No guard exists against hitting the model's context window. An overflow would surface as a generic provider error → `outcome: 'errored'`.
- A long Inspector session eventually fails or becomes expensive because the client transcript and the insights block grow without limit. No compaction is ever triggered.
- Possible duplicate user message (needs runtime confirmation). `doSend` appends `userMsg` to state (`useInspectorChat.ts:285`), then reads state back through a functional updater (`:297-299`), which in React will include the queued `userMsg`. It then appends `userMsg` again (`:306`). The server merges consecutive user messages by joining with `\n` (`route.ts:213-224`), so the latest question would reach the model twice.

### Gaps
- No runtime traces were inspected (agent_loop_log `context_chars` values), so actual per-turn context sizes are not quantified here.

## Q2. Tool results: format, size, truncation, error messages, schema output size

### Takeaway
`execute_tool` returns the raw Databricks result to the model: up to 1000 rows by default (10,000 via env) as row objects with column names repeated in every row, with no char cap. The UI copy is capped at 1000 rows, but the model copy is not. Results are inlined, never stored by reference. `describe_schema` outputs are mostly bounded, but `detail:'full'` and `research` can be large. Error strings are mostly actionable but inconsistent, and the model never sees the `retryable` flag.

### Cited Findings
- Model receives the full result: `return JSON.stringify(sqlResult);` — `src/lib/inspector/tools.ts:454`. Only the UI event is capped: `const cappedRows = sqlResult.rows.slice(0, 1000)` — `tools.ts:444-452`.
- Row cap at the warehouse: `MAX_ROWS = Math.min(parseInt(process.env.DATABRICKS_MAX_ROWS ?? '1000'), 10_000)` — `src/lib/databricks/execute.ts:25-28`, sent as `row_limit` — `execute.ts:247, 384`. Inline body cap 4 MB — `execute.ts:36`.
- Row format is verbose. Each row becomes an object keyed by column name (`Object.fromEntries(columns.map(...))`), plus `columns`, `statement_id`, `truncated`, `truncated_at` — `execute.ts:336-352`.
- Prompt and tool description disagree on size. The system prompt says "Always include a LIMIT clause. Default to LIMIT 100" (`prompts.ts:63`). The `execute_tool` description says "do not raise LIMIT above a few thousand" (`prompts.ts:137`), which is above the 1000-row default cap, so larger LIMITs are silently cut (`truncated` flag only).
- The Chat Completions path shrinks rows only for the UI card (`uiToolOutput` keeps `row_count/columns/truncated`, `foundry-chat.ts:168-179, 625`). The model message still gets `content: r.content` (full) — `foundry-chat.ts:650, 657`.
- Trajectory logging truncates output to 2000 chars (`agent-loop.ts:285`, `foundry-chat.ts:362, 644`). This is logging only and does not reduce model context.
- `describe_schema` sizes: `list` pages 50 by default, max 200 (`src/lib/context/describe.ts:255`). `search` k is clamped 1–20 (`describe.ts:670`). `describe` with `detail:'full'` "returns all columns" (`prompts.ts:182`) with no cap seen in dispatch (`src/lib/context/dispatch.ts:74-87`). `research` returns up to 5 candidates × 20 columns × 15 relationships plus semantic cards and a retrieval note (`dispatch.ts:117-158`). All are returned as `JSON.stringify(result)` with no char cap.
- Static prompt/tool payload (measured char counts): Inspector base prompt ≈5.1 KB (`prompts.ts:16-85`), answer rules ≈3.1 KB (`src/lib/inspector/answer-rules.ts`), tool specs ≈5.1 KB (`prompts.ts:133-225`) plus the chart DSL schema 2.9 KB (`src/lib/studio/chart-dsl.schema.json`), and a semantic section of up to 8000 chars (`prompts.ts:380-381`). Insights, session knowledge and memory blocks come on top (`route.ts:244-248, 297-298`).
- Error messages returned to the model:
  - Actionable: missing statement explains the expected shape (`tools.ts:409-412`); export errors include a `note` on how to recover (`tools.ts:342-346`); describe errors say "Use action:'list'…" (`dispatch.ts:82-85`).
  - Less actionable: the generic catch returns the raw Databricks message only (`tools.ts:476-478`). `RESULT_TOO_LARGE` gives the "add a LIMIT clause" hint only to the UI event; the model gets `{ error: 'RESULT_TOO_LARGE', message: err.message }` (`tools.ts:471-474`). Infra errors (token fetch failed, connection inactive) carry `retryable:false` only in the UI event (`tools.ts:421-433`), so the model is never told not to retry.
  - The `retryable` flag goes only to the UI: `onToolCallEvent({ type: 'tool_call_error', ..., retryable })` — `agent-loop.ts:291-293`. The model-facing toolResult never sets the Converse `status: 'error'` field — `agent-loop.ts:308-310`. Chat Completions hard-codes `retryable: true` for every error — `foundry-chat.ts:628, 352`.
  - Duplicate error events: `executeInspectorTool` emits its own `tool_call_error` via `emit` (e.g. `tools.ts:392, 411, 477`), and the loop emits another through `onToolCallEvent` (`agent-loop.ts:291-293`). The UI gets two per failure.
- Malformed tool arguments are swallowed: `try { toolInput = JSON.parse(block.input); } catch {}` leaves `{}` (`agent-loop.ts:263`; same at `foundry-chat.ts:601, 330`). The model then sees a downstream error (e.g. "statement not found in args… Received args type: object", `tools.ts:410`) rather than "your arguments were not valid JSON".
- Contradictory guidance inside a tool result: when the catalog is empty, `listObjects` tells the model to run `SHOW CATALOGS` (`describe.ts:266-269`), which the harvested-mode system prompt forbids (`prompts.ts:46, 62`). The error for an unknown action lists `research`/`usage` (`dispatch.ts:194-197`), which are not in the tool's enum (`prompts.ts:177`).

### Inferences
- A 1000-row × 15-column result serialised as row objects is easily 100–300 KB, i.e. tens of thousands of tokens, re-sent on every later loop. Agent-engineering practice is to return a compact preview (schema, row count, first N rows, aggregates) and keep the full result by reference (a handle the model or UI can page or export). ALOFT already holds the full rows server-side (`sessionQueryResults`, `route.ts:363-374`; `studio_query_results`, `tools.ts:310-315`), so a by-reference design is close at hand.
- SQL result rows are untrusted text inlined with no delimiting, which is the same spotlighting gap noted in the harness-gaps report (`reports/Agent builder harness gaps.md:59`).

### Gaps
- `describeObject` / `profileObject` output size for wide tables was not measured.

## Q3. Error handling and retries; what the user sees on errored / truncated

### Takeaway
There is no explicit retry, backoff or fallback around model calls in any loop; only SDK-default retries (inference) apply. Mid-stream failures are not retried. On the Bedrock path, one thrown tool exception aborts the whole turn. Errored turns discard partial answers, and on the Inspector they are never written to the spend ledger. Provider stop reasons (max_tokens, incomplete) are never read, so cut-off answers are reported as "completed".

### Cited Findings
- No retry code: each loop does a single `await client.send(command)` (`agent-loop.ts:187`) / `client.chat.completions.create(...)` (`foundry-chat.ts:456-463`) / `client.responses.create(...)` (`foundry-chat.ts:228-242`), and any throw lands in the single outer `catch` → `outcome: 'errored'` (`agent-loop.ts:336-346`; `foundry-chat.ts:669-683, 387-401`).
- Timeouts: Chat Completions uses a 45 s stall timer that refreshes on every chunk (`foundry-chat.ts:114, 453-454, 471`). xAI uses 180 s (`foundry-chat.ts:117, 225-226`). Bedrock sets no timeout (`agent-loop.ts:110-118, 187`). The non-streaming `withTimeout` rejects but does not cancel the request (`foundry-chat.ts:119-130`).
- Timeout messages are hard-coded advice: "This is an Azure deployment issue. Please switch to a different model (e.g. Claude Sonnet, Grok 4.3)" (`foundry-chat.ts:671-674`). This appears even when the call went to the LLM Lite gateway, not Azure.
- Tool exceptions:
  - Bedrock path: `executeTool` is awaited inside `Promise.all` with no try/catch (`agent-loop.ts:260-267`), so one rejecting tool fails the entire turn.
  - `describe_schema` has no try/catch (`tools.ts:482-485`) and `withAgentOpsToolLog` rethrows (`src/lib/agent-ops/log-tool-invocation.ts:101-115`), so a Prisma error in describe kills a Bedrock-path turn.
  - The Chat Completions and xAI paths catch per tool and return `{error}` (`foundry-chat.ts:611-617, 337-343`). This is inconsistent behaviour across loops.
- Stop reasons are ignored: nothing reads Bedrock `messageStop.stopReason` or OpenAI `finish_reason`. `stopReason` in metrics is ALOFT's own label (`agent-loop.ts:54, 237-252`; grep shows no `messageStop`/`finish_reason` usage). xAI `response.incomplete` is treated as completed (`foundry-chat.ts:267-268`). With `maxTokens: 4096` (Q6), a long markdown answer cut at the limit is returned as `outcome: 'completed'`. A tool call cut mid-arguments parses to `{}` (Q2) and runs anyway.
- User-visible behaviour, errored (Inspector):
  - The user sees `clientStreamError(...)` text and `done{outcome:'errored'}` (`route.ts:727-731`).
  - `persistInspectorSpend` is called only in the completed (`:632`) and truncated (`:697`) branches, not in errored (`:727-736`) or the outer catch (`:784-790`). So tokens consumed before an error never reach `agent_cost_log` or `platform_spend_event`. `turnMetrics.flush` still writes loop logs (`:738-744`).
  - `finalText` is null on error, so any partial narration exists only in the client.
- User-visible behaviour, errored (saved agents): the route emits an `error` event (`agents/chat/route.ts:186-188`), still saves the streamed `reply` (`:199-208`), and records spend with status `failed` (`run-catalog-agent.ts:347-372`). This differs from the Inspector.
- User-visible behaviour, truncated (Inspector): a canned markdown footer "Tool-call limit reached. I used all 15 available query slots…" plus fixed suggestions (`route.ts:672-683`). `finalText` is null (`agent-loop.ts:329-335`, `foundry-chat.ts:662-668`), so the user gets only interim narration and the footer, not a synthesised answer.
- `clientStreamError` is used to sanitise the message (`route.ts:729`). The user is told `recoverable: true` for every loop error regardless of cause.

### Inferences
- SDK defaults (AWS SDK v3 standard retry ~3 attempts; OpenAI Node SDK `maxRetries` 2 on 408/409/429/5xx/connection errors) probably give some implicit retry on the initial request. This is not configured or visible in ALOFT code, and does not cover failures after streaming starts. Best practice is explicit classification (throttle → backoff with jitter; context overflow → compact and retry; 5xx → retry or fall back to another model; 4xx validation → do not retry) and a "partial answer from what we have" fallback.
- Because errored Inspector turns are not costed, spend dashboards under-report precisely the expensive failure cases (long turns that overflow or time out).

### Gaps
- `clientStreamError` mapping (`src/lib/inspector/client-stream-error.ts`) was not read in detail.

## Q4. Parallel tool calls

### Takeaway
All three loops execute the tool calls from one model response concurrently with `Promise.all`. There is no per-batch concurrency cap and no ordering or dependency handling. A process-wide semaphore of 2 throttles `describe_schema` across all users.

### Cited Findings
- Bedrock: `await Promise.all(toolUseBlocks.map(async (block) => { ... executeTool(...) }))` — `agent-loop.ts:260-300`. Chat Completions: `foundry-chat.ts:598-652`. xAI: `foundry-chat.ts:325-375`. Wall time is recorded as the batch time: "parallel calls overlap" — `agent-loop.ts:41-42`.
- Global throttle: `DESCRIBE_SCHEMA_CONCURRENCY = 2` with a module-level counter and queue — `src/lib/context/dispatch.ts:9-26`. The comment says it exists to stop agent turns firing several describe calls at once from filling the Prisma pool.
- Ordering hazard: `emit_chart` charts the last entry of `context.queryResults` (`tools.ts:189-197`). That array is filled by `query_result` events as `execute_tool` finishes (`route.ts:363-374`). If the model issues `execute_tool` and `emit_chart` in the same response, they race.

### Inferences
- The describe semaphore is per Node process and shared by all concurrent sessions, so under load one user's 5 parallel describes queue behind other users' calls (head-of-line blocking that adds to TTFT). The real fix is pool sizing or per-request limits, not a global gate of 2.
- Parallel execution is in line with practice. What is missing is per-turn tool-call budgets (count/time) and idempotency or dedupe of identical calls. The harness-gaps report lists "repeated identical SQL" as an eval constraint (`reports/Agent builder harness gaps.md:75`), but the loop does not detect it.

### Gaps
- Not measured: how often models actually emit multi-tool batches in production (`agent_loop_log.tool_calls`).

## Q5. Prompt caching

### Takeaway
The production surfaces set no explicit cache breakpoints at all. `cacheSystemPrompt` (Bedrock only) is opted into only by the semantic blueprint and flows-copilot paths. Inspector and saved agents never pass it, and the production Chat Completions loop ignores it anyway. The Inspector system prompt is rebuilt every turn with per-session dynamic blocks, so even a system-level cache point would miss across turns. Tools and conversation history are never cached.

### Cited Findings
- Bedrock cache point (opt-in, system only): `[{ text: systemPrompt }, { cachePoint: { type: 'default' } }]` when `cacheSystemPrompt` — `agent-loop.ts:83-91, 143-146`. No cache point on tools or messages.
- Who opts in: only `src/app/api/inspector/semantic/[modelId]/blueprint/route.ts:167` and `src/lib/flows-copilot/propose.ts:235` (grep for `cacheSystemPrompt`). The Inspector loop params have none (`route.ts:433-553`), and neither does the saved-agent loop (`run-catalog-agent.ts:261-322`).
- Chat Completions / xAI loops do not read `cacheSystemPrompt` at all; it is not destructured (`foundry-chat.ts:413-416, 192-195`). They rely on provider-automatic caching and only record `cached_tokens` (`foundry-chat.ts:504, 534, 281`) with `cacheWriteTokens: 0` (`:562-563`).
- xAI direct uses `prompt_cache_key = randomUUID()` per run — `foundry-chat.ts:199, 241`.
- Dynamic content in the Inspector system prompt, rebuilt every request:
  - semantic context loaded from DB (`route.ts:234-244`);
  - all session insights (`route.ts:245`, uncapped per Q1);
  - SESSION KNOWLEDGE, which changes after every turn (`route.ts:246-248`, persisted at `:756-769`);
  - Operating Memory P0/P1a blocks (`route.ts:293-298`), selected by the first user message (`:263`);
  - a task-scoped recall block injected as a synthetic first assistant message (`route.ts:320-325`).
  The order is stable base → insights → session knowledge → memory, so dynamic text sits after the static prefix.
- Saved agents: the system prompt is the runtime brief + knowledge prompt + optional inspection/answer instructions (`run-catalog-agent.ts:241-248`). It is stable per agent and caller, but uncached.
- The intent doc wants caching measured from `agent_loop_log` cache-read tokens — `docs/business-ai-studio/04-harness-skills-reasoning.md:84`. The metrics plumbing exists (`agent-loop.ts:46-49, 227-228`).

### Inferences
- For Claude models behind the gateway (e.g. `aws_bedrock/Claude-Sonnet-5`, `src/lib/llmlite/labels.ts:3`), Anthropic caching requires explicit `cache_control` breakpoints, so they get no prompt caching at all. That would be confirmed by `cache_read_tokens = 0` in `agent_loop_log` for those models. Grok/OpenAI-family models may get automatic prefix caching on the stable prefix (base prompt + tools), since dynamic blocks come last.
- Within a single turn, each loop re-sends the system prompt + tools + growing history. This is the case where caching pays most (loop N's prefix = loop N-1's full request), and it is entirely uncached for Claude on the production path. Best practice is a breakpoint after tools+system and a moving breakpoint on the last message each loop.
- A fresh `prompt_cache_key` per run means xAI cannot route turn N+1 to the cache entries of turn N (xAI/OpenAI semantics, not verified in code). A per-session key would be the usual choice.

### Gaps
- No cache-hit data was queried. The actual hit rate per model is unknown.

## Q6. Thinking / reasoning config, temperature, maxTokens

### Takeaway
The Bedrock settings (thinking budget 1024 with temperature 1, otherwise temperature 0.3, maxTokens 4096) apply only to the minor surfaces. The production Chat Completions path sends no temperature and no reasoning parameters, only a 4096 output cap. Thinking blocks are never preserved across tool calls on the Bedrock path. On the default production model (Grok 4.7 via LLM Lite Chat Completions), the reasoning state is dropped between tool rounds, which is the exact failure the code's own comment says the xAI Responses path was built to fix.

### Cited Findings
- Bedrock: `maxTokens: 4096, temperature: supportsThinking ? 1 : 0.3` and `thinking: { type: 'enabled', budget_tokens: 1024 }` when `supportsThinking && modelId.includes('anthropic')` — `agent-loop.ts:173-181`.
- Thinking blocks are discarded: reasoning deltas only go to the UI (`onThinkingChunk(reasoning.text)`, `agent-loop.ts:208-211`). The assistant message replayed next loop contains only text + toolUse (`agent-loop.ts:303-307`). No reasoning signature is captured.
- `supportsThinking` is effectively off on production surfaces. LLM Lite config sets it only for ids containing `o3` (`src/lib/llmlite/inspector-models.ts:22, 45`). Saved agents hard-code `supportsThinking: false` (`run-catalog-agent.ts:306`). The Chat Completions loop never reads `supportsThinking` (`foundry-chat.ts:413-416`).
- Chat Completions request: only `model, messages, tools, max_tokens|max_completion_tokens: 4096, stream` (`foundry-chat.ts:456-463, 84-86`). No temperature, no reasoning effort, no `tool_choice`.
- xAI direct: `temperature: 0.7, top_p: 0.95, reasoning.effort` (default `low`), `max_output_tokens: 4096`, `include: ['reasoning.encrypted_content']`, and the output items are passed back "exactly as received" — `foundry-chat.ts:139-143, 228-242, 308-309`.
- The code's own diagnosis: "Chat Completions has no field for encrypted reasoning. Each tool round then starts from scratch, which is the 'ranking query never ran' repeat." — `foundry-chat.ts:133-135`. The fix applies only to `resource === 'xai'` (`foundry-chat.ts:409-411`). The default interactive model is `aws_bedrock/xAI-Grok-4.7` via LLM Lite (`src/lib/llmlite/default-model.ts:2`; `src/lib/inspector/default-model.ts:4-8`), which goes through Chat Completions.
- Builder-declared model parameters are ignored for saved agents (temperature/max tokens): `reports/Agent builder harness gaps.md:42`.

### Inferences
- Anthropic API behaviour (not verified in code): with extended thinking and tool use, the prior assistant turn's thinking block (with signature) must be passed back unmodified, or the request is rejected or reasoning continuity is lost. So Claude + thinking + tools on the Bedrock path would probably fail on loop 2. It stays latent only because no current caller enables thinking for an Anthropic model.
- A 1024-token thinking budget is the API minimum. That is too small for multi-step SQL planning, and with maxTokens 4096 it also eats into answer space.
- 4096 output tokens is tight for the house style (markdown tables, section headings, 2–3 follow-ups; `prompts.ts:79-85`). Combined with ignored stop reasons (Q3), long answers can be silently cut off.
- No temperature means provider default, which differs across gateway models. Agent behaviour is therefore not reproducible across model switches.

### Gaps
- Whether LLM Lite adds reasoning parameters or temperature server-side is unknown (gateway config not in repo).

## Q7. Loop termination: maxLoops semantics, last-loop tool removal, truncated outcome

### Takeaway
`maxLoops` counts model calls (not tool calls or cost). The "last-loop tool removal" in the Bedrock loop is effectively dead code: by the last loop, history always contains tool blocks, which forces toolConfig back in. The Chat Completions path never removes tools. Neither path injects a "wrap up now" instruction. Hitting the cap returns `finalText: null`, so the user gets no answer, just a canned footer.

### Cited Findings
- Caps: Inspector default 15, clamp 1–32, env `INSPECTOR_MAX_LOOPS` — `src/lib/inspector/max-loops.ts:2-16`. Saved agents `AGENT_MAX_LOOPS = 10` (+1 for `submit_answer`, +1 for inspection) — `run-catalog-agent.ts:37, 304`.
- Last-loop logic (Bedrock): `mustIncludeToolConfig = supportsTools && (!isLastLoop || hasToolBlocks)` — `agent-loop.ts:162-166`. `hasToolBlocks` is true whenever any earlier loop used a tool. A turn only reaches the last loop when every earlier loop was a tool loop, so tools are removed only when `maxLoops === 1` or no tools were used. No final-answer nudge is added.
- Chat Completions / xAI: `tools: openAITools` on every call including the last — `foundry-chat.ts:459, 231`. If the model calls tools on the last loop, they execute (`foundry-chat.ts:598-652`) and the loop exits with `outcome: 'truncated'`. Those tool results are never shown to the model.
- Truncated return: `finalText` stays null (it is only assigned in the no-tool branch) — `agent-loop.ts:316-335`; `foundry-chat.ts:570-582, 661-668`.
- Inspector renders the limit footer and suggestions — `route.ts:672-683`. Saved agents return `text: ''` (`run-catalog-agent.ts:333`) unless `submit_answer` arrived, in which case `truncated` is upgraded to `completed` (`run-catalog-agent.ts:341-342`).
- `submit_answer` ends the loop by setting the abort flag: `abort.value = true; // the answer is in; skip the follow-up call` — `run-catalog-agent.ts:278-281`.
- No other termination criteria: no token, USD or wall-clock cap inside the loop. The only outer bound is the route `maxDuration = 300` (`route.ts:59`; `agents/chat/route.ts:22`; `flows/agent-try/route.ts:11`).

### Inferences
- Practice is a final "budget exhausted, answer with what you have" call with tools disabled (on Bedrock that means converting prior toolUse/toolResult to text, or using `toolChoice: none` where supported). ALOFT instead spends the last loop on another tool call and throws the work away.
- Loop count is a poor budget proxy. One loop with a 1000-row result costs more than ten describe calls. The intent docs already say "Budgets replace loop caps" (`docs/business-ai-studio/11-cowork-style-work.md:83`) and propose unifying under `RunLimits` (`04-harness-skills-reasoning.md`, §2 "Bounded loop" row, line ~25).

### Gaps
- None material.

## Q8. Abort / stop

### Takeaway
Abort is a shared boolean flag polled between steps, not a cancellation signal. The production Chat Completions loop does not check it during streaming and still runs the tools of the current response after Stop. No path cancels the in-flight HTTP request on user Stop. Outcomes after abort are mislabelled (completed, truncated, or a fake timeout error), which pollutes scoring, bandit and spend data.

### Cited Findings
- Mechanism: `request.signal` abort sets `closed.value = true` and closes the controller — `route.ts:332-335`. `closed` is passed as `abortSignal` — `route.ts:460`. The loop checks it in the `while` condition — `agent-loop.ts:158`; `foundry-chat.ts:435, 210`.
- Bedrock path: breaks out of the stream (`agent-loop.ts:198`), skips tools when aborted (`:258`), then falls into the clean-break branch and returns `outcome: 'completed'` with partial text (`:316-325`).
- Chat Completions (production): no abort check inside `for await (const chunk of stream)` (`foundry-chat.ts:469-506`), so the model keeps generating to completion. No abort check before `Promise.all` either (`:597-652`), so tool calls from the aborted response still run (including live warehouse SQL). The loop then exits via `while` → `outcome: 'truncated'` (`:662-668`). Its `AbortController` is tied only to the stall timer, not to the user's Stop (`:453-463`).
- xAI path: abort breaks the stream (`foundry-chat.ts:247`), `completed` stays null and the loop throws "ended before completion" (`:275-277`). The catch turns that into "request timed out after 180s… Grok 4.7 can spend that time reasoning" (`:389-392`). A user Stop is reported as a timeout error.
- Inspector outcome mapping: `outcome: closed.value && result.outcome !== 'completed' ? 'aborted' : result.outcome` (`route.ts:740`). An aborted turn that the loop labelled `completed` is logged as completed, and the completed branch then runs scoring, bandit reporting, CTSGV observations, memory attribution `success` and spend (`route.ts:615-671`).
- What is lost on abort:
  - Inspector: `finalText` and loop results are not persisted server-side except session knowledge from `toolCalls` (`route.ts:756-769`). The transcript survives only via client autosave (`useInspectorChat.ts:256-267`).
  - Saved agents: the route saves the streamed `reply` "also when stopped" (`agents/chat/route.ts:57-59, 198-208`).
- Coupling risk (latent): the saved-agent chat route passes its SSE `closed` flag as the run's `abort` (`agents/chat/route.ts:165`), and `submit_answer` sets `abort.value = true` (`run-catalog-agent.ts:280`). If answer fields were ever enabled in chat, accepting an answer would also mute the SSE stream: `emit` returns early when `closed` (`agents/chat/route.ts:139-141`), and the final `done` would be dropped. Today only `agent-try` passes `answer`, without the SSE flag (`flows/agent-try/route.ts:36-44`).

### Inferences
- Because the production loop neither checks abort mid-stream nor cancels the request, Stop does not save tokens or warehouse cost for the current step. Stop is honoured only at the next loop boundary.

### Gaps
- Whether Next.js on Elastic Beanstalk propagates `request.signal` abort promptly on client disconnect was not verified.

## Q9. Cost and latency measurement; budget enforcement

### Takeaway
Per-loop metrics are thorough (LLM ms, TTFT, tool ms, tokens incl. cache split, context size), but they are only recorded. Budget is checked once before the turn against a $0.05 estimate and never during the run. Cost attribution is wrong for most LLM Lite models: gateway ids are not in the price table and fall back to Sonnet pricing. The Inspector and agent paths compute cost differently, and errored Inspector turns are not costed.

### Cited Findings
- Per-loop metrics: the `LoopMetrics` fields (`agent-loop.ts:34-55`) are emitted via `onLoopMetrics` after each loop (`agent-loop.ts:237-252, 301, 317`; `foundry-chat.ts:552-567, 292-306`) and stored by `TurnMetricsRecorder.addLoop`/`flush` into `agent_turn_log` / `agent_loop_log` (`src/lib/agent-ops/record-turn-metrics.ts:29-31, 34-60`). Per-tool rows go to `tool_invocation_log` via `withAgentOpsToolLog` (`log-tool-invocation.ts:25-75, 77-116`).
- Metrics silently dropped: `flush` returns early when `sessionId` is empty (`record-turn-metrics.ts:41`). The Inspector passes `''` for non-UUID sessions (`route.ts:387`). Success-sampling env can skip tool logs (`log-tool-invocation.ts:13-18, 40-55`).
- Saved agents log every tool with `loop: 0` (`run-catalog-agent.ts:285, 291`), so per-loop tool attribution is lost. The Inspector uses the live `currentAgentLoop` (`route.ts:443, 462`).
- Budget enforcement, pre-flight only:
  - `assertInteractiveBudget` checks `spentUsd + (opts.estimatedUsd ?? 0.05) > policy.amountUsd` (`src/lib/spend/budgets.ts:201-220`).
  - It is called once at turn start (`route.ts:177-184`; `run-catalog-agent.ts:217-228`) without an estimate.
  - The loop receives no budget, so nothing stops a 15-loop turn mid-run.
- Spend recorded after the run: `logAgentCost` + `recordInteractiveLlmSpend` (`route.ts:563-594`; `run-catalog-agent.ts:345-372`).
- Inspector spend accounting bugs:
  - Spend is not recorded for errored turns (Q3).
  - `toolCalls` is passed as `result.loops - 1` (`route.ts:632, 697`), which counts loops, not tool calls (parallel calls are undercounted).
  - `runId: body.sessionId` is per session, not per turn (`route.ts:569`).
- Cost formula divergence:
  - The Inspector uses recorder totals with the cache split (`route.ts:560-561, 572-573, 585-587`).
  - Saved agents use `result.usage` with no cache split (`run-catalog-agent.ts:345, 353-354, 363-365`). On the Chat Completions path `prompt_tokens` includes cached tokens (`foundry-chat.ts:502-504`), so agents bill cached tokens at full input price.
  - On the Bedrock path, `result.usage.inputTokens` excludes cache reads/writes (`agent-loop.ts:225-228, 234`) while LoopMetrics include them (`:244-245`). So the two totals disagree.
- Price table vs gateway ids: `pricingKey` only strips `us.anthropic.` and date/version suffixes and maps `nova-(pro|lite|micro)` (`src/lib/lifecycle/log-agent-cost.ts:28-32`). Unknown keys fall back to `claude-sonnet-4` ($3/$15) (`log-agent-cost.ts:59`). LLM Lite ids such as `aws_bedrock/Gpt-6-Luna`, `aws_bedrock/Claude-Haiku-4.5`, `aws_bedrock/Nova2-lite-v1` (`src/lib/llmlite/labels.ts:2-7`) match nothing:
  - Luna is priced at Sonnet rates instead of $0.125/$0.50 (`log-agent-cost.ts:11-13`), about 24× too high.
  - Haiku is priced as Sonnet.
  - Grok 4.7 lands on $3/$15 by coincidence, but its cache-read rate becomes the OpenAI 0.5 instead of the Grok 0.25 (`log-agent-cost.ts:39-44`).
- Latency: TTFT per loop (`agent-loop.ts:186, 199, 242`) and per turn (`turnMetrics.markFirstToken`, `route.ts:466`) are measured. There is no latency SLO or timeout per turn other than route `maxDuration`.

### Inferences
- Per-run cost cannot be enforced or even accurately reported today. The fix needs (a) gateway-id-aware pricing, ideally from the gateway's own cost header or response; (b) a running cost meter inside the loop, checked before each model call and tool batch; (c) costing errored and aborted turns. The design intent (`04-harness-skills-reasoning.md` "Bounded loop … dollars, all enforced in code"; `11-cowork-style-work.md:83, 135`) already calls for this.

### Gaps
- Whether LLM Lite returns a per-request cost (LiteLLM can expose `x-litellm-response-cost`) was not checked. The loop does not read response headers.

## Q10. Model selection / routing

### Takeaway
One model per turn, chosen by request key, role and feature default before anything about the task is known. Every loop, and the in-tool chart pipelines, use that same model. There is no routing by task, step, cost or difficulty, no fallback model on failure, and the agent's own declared model is ignored.

### Cited Findings
- Inspector: `requestedModelKey` comes from the body, role access, or the `inspector_chat` feature default (`route.ts:158-171`). The same `loopParams.modelId` is used for every loop (`route.ts:434`).
- Saved agents: `resolveWorkbenchModel(input.model, input.role, 'commissioned_agents')` is resolved before the agent row is loaded (`run-catalog-agent.ts:189-193`; `workbench-model.ts:24-50`). The agent's stored model config is ignored (`reports/Agent builder harness gaps.md:42`).
- In-tool LLM calls reuse the turn model: `emit_chart` / `emit_semantic_chart` pass `context.model` to the chart pipelines (`tools.ts:150-160, 204-209, 262-269`), with a hard-coded Bedrock fallback `'us.anthropic.claude-sonnet-4-6'` (`tools.ts:154, 208`).
- No fallback on error: timeout text tells the user to "switch to a different model … and retry" (`foundry-chat.ts:673`) instead of the harness failing over.
- Design intent: "`PlatformAgent.routing_mode` is never read … No routing by cost or task" (`04-harness-skills-reasoning.md:10`); "default to the cheapest model that passes the eval set… Escalate on low confidence" (`:87`).

### Inferences
- Discovery loops (describe_schema search/describe) and final synthesis have very different needs. A cheaper model for tool-selection loops and a stronger one for SQL writing and synthesis, or at least escalation on repeated tool errors, is common practice. The bandit observations already collected (`route.ts:633-656`) could inform this but are not used at selection time.

### Gaps
- `chatModelKeyForRole` role-access rules were not audited.

## Q11. Inspector path vs saved-agent path — duplicated and divergent behaviour

### Takeaway
Both paths share the provider loop and `executeInspectorTool`, but each route rebuilds its own harness: history handling, caps, prompts, cost accounting, text-replace handling, scoring and abort semantics. They diverge in ways that change correctness and cost reporting.

### Cited Findings (difference → evidence)
- Loop cap: 15 (env ≤32) vs 10(+2) — `max-loops.ts:2-16` vs `run-catalog-agent.ts:37, 304`.
- History: client-sent, uncapped, text-only vs server-stored, 30 msgs/60k chars — `useInspectorChat.ts:306`, `route.ts:206-224` vs `agent-chats.ts:30-31, 66-83`.
- Final-text handling: the Inspector emits `text_replace` to replace interim narration (`route.ts:550-552`). Agents never wire `onTextReplace`, so the saved reply = concatenated narration (`run-catalog-agent.ts:261-322`; `agents/chat/route.ts:166-169, 201`).
- Thinking: model-config driven vs hard `false` — `route.ts:459` vs `run-catalog-agent.ts:306`.
- Tools: 4 Inspector tools (+2 semantic) (`prompts.ts:133-225, 355-374`) vs `describe_schema`, `execute_tool`, `search_knowledge`, `record_inspection`, `submit_answer` (`run-catalog-agent.ts:36, 265-272`).
- `record_inspection` costs an extra model round trip per agent turn ("Call once, before the final reply") — `run-catalog-agent.ts:107-125, 274-277`.
- Cost: cache-split recorder totals and no cost on error, vs raw `result.usage` and cost on error — `route.ts:560-594, 727-736` vs `run-catalog-agent.ts:345-372`.
- Tool-log loop index: live loop vs always 0 — `route.ts:443` vs `run-catalog-agent.ts:285, 291`.
- Post-run learning: bandit, CTSGV judge, trajectory reflection, memory attribution and session knowledge run only on the Inspector — `route.ts:633-671, 756-783`. Agents have none.
- Error UX: the Inspector emits `recoverable:true` + `done` (`route.ts:729-730`). Agents emit `error` only if `errorDetail` (`agents/chat/route.ts:186-188`).
- Streaming events: the Inspector forwards loop_start, loop_usage, thinking and suggestions (`route.ts:461-471, 546-548`). Agents forward only text and tool events (`agents/chat/route.ts:166-179`).
- Duplicate model-resolution code: the Inspector has its own `resolveModel`/`inferProvider`/BOOST lookup (`route.ts:75-106, 412-429`) alongside `resolveWorkbenchModel` (`workbench-model.ts:24-51`).
- The harness-gaps report already documents that the workbench test-run is a third divergent harness (8 loops, different feature default, no KB tool) — `reports/Agent builder harness gaps.md:65, 139`.

### Inferences
- There is no single `runAgentTurn` harness object holding the history policy, limits, cost meter, outcome mapping and persistence. Every surface re-implements these, which is why defects such as uncosted errors, the narration-in-history bug and abort mislabelling exist on one surface and not another.

### Gaps
- Workbench chat (`src/app/api/agent-lab/workbench/chat/route.ts`) and the boost runner (`src/lib/boost/runner.ts:152`) were not audited in depth.

## Q12. Obvious bugs and risky code (consolidated defect list, roughly by impact)

### Takeaway
The highest-impact problems are unbounded inlined tool results and context, no caching on the production path, reasoning loss on the default model, mispriced or uncosted spend, abort that neither cancels nor labels correctly, and silent truncation from ignored stop reasons.

### Cited Findings
1. **Full SQL results (up to 1000 rows by default, 10k max) inlined into model context and re-sent every loop**, no char cap or reference handle — `tools.ts:444-454`, `execute.ts:25-28, 336-352`, `agent-loop.ts:308-312`, `foundry-chat.ts:650-658`.
2. **No context management**: growth is measured but never trimmed or compacted. Inspector history is uncapped and the insights block uncapped — `agent-loop.ts:57-65`, `route.ts:206-224`, `prompts.ts:458-483`.
3. **Production loop has no prompt caching control**: `cacheSystemPrompt` is Bedrock-only and unused by the Inspector and agents. The system prompt is dynamic per turn — `agent-loop.ts:143-146`, `foundry-chat.ts:413-416`, `route.ts:244-248, 297-298`.
4. **Default model (Grok 4.7 via LLM Lite Chat Completions) loses reasoning between tool rounds**, the failure documented in-code — `foundry-chat.ts:133-135, 409-411`, `default-model.ts:2`.
5. **Stop reasons ignored**: max_tokens-truncated answers and cut-off tool args are reported as completed. xAI `incomplete` is treated as completed — `agent-loop.ts:196-231`, `foundry-chat.ts:267-268, 469-506`; arg parse swallow `agent-loop.ts:263`.
6. **Last-loop tool removal is ineffective**, no wrap-up turn, truncated → no answer — `agent-loop.ts:162-166, 328-335`, `foundry-chat.ts:459, 661-668`, `route.ts:672-683`.
7. **Abort**: the production loop keeps streaming and still runs tools after Stop. Bedrock labels abort `completed`, xAI labels it a timeout. Aborted "completed" turns feed bandit, judge and memory-success attribution — `foundry-chat.ts:469-506, 597-652`, `agent-loop.ts:198, 316-325`, `foundry-chat.ts:275-277, 389-392`, `route.ts:615-671, 740`.
8. **Spend**:
   - errored Inspector turns are never costed (`route.ts:727-736, 784-790`);
   - gateway ids fall back to Sonnet pricing (`log-agent-cost.ts:28-32, 59`);
   - agents ignore the cache split (`run-catalog-agent.ts:345`);
   - `toolCalls = loops - 1` (`route.ts:632, 697`);
   - the budget is pre-flight only at $0.05 (`budgets.ts:213`).
9. **Bedrock loop: one throwing tool fails the whole turn** (no per-tool try/catch); `describe_schema` can throw — `agent-loop.ts:260-267`, `tools.ts:482-485`, `log-tool-invocation.ts:101-115`.
10. **Saved-agent chat saves concatenated interim narration as the assistant reply** and replays it as history — `agents/chat/route.ts:166-169, 201-203`, `run-catalog-agent.ts:261-322`.
11. **Global `describe_schema` concurrency of 2 per process** shared by all sessions — `dispatch.ts:9-26`.
12. **Thinking blocks not preserved across tool calls** on the Bedrock path (latent break for Claude + thinking + tools) — `agent-loop.ts:208-211, 303-307`.
13. **Tool-result guidance contradicts the system prompt** (SHOW CATALOGS) and advertises actions missing from the schema — `describe.ts:266-269` vs `prompts.ts:46, 62`; `dispatch.ts:194-197` vs `prompts.ts:177`.
14. **`emit_chart` races with same-batch `execute_tool`** (reads the last result) — `tools.ts:189-197`, `route.ts:363-374`, `agent-loop.ts:260`.
15. **Misleading error text**: "Azure deployment issue… switch to Claude Sonnet, Grok 4.3" shown for LLM Lite timeouts — `foundry-chat.ts:671-674`. The model never learns `retryable` — `agent-loop.ts:291-293, 308-310`.
16. **Latent abort/SSE coupling** in agent chat if answer fields are enabled — `agents/chat/route.ts:139-141, 165`, `run-catalog-agent.ts:280`.
17. **Bedrock client forces static env keys** (`accessKeyId: process.env.AWS_ACCESS_KEY_ID!`), ignoring the instance-profile mode the route checks for — `agent-loop.ts:110-118` vs `route.ts:108-110`.
18. **Turn metrics dropped for non-UUID sessions** — `record-turn-metrics.ts:41`, `route.ts:387`.
19. **Per-chunk markup stripping cannot handle tags split across chunks** (leaks `<query_result>` fragments to the UI until `text_replace`) — `agent-loop.ts:103-108, 204-205`.
20. **Probable duplicated latest user message** in the Inspector request (needs runtime confirmation) — `useInspectorChat.ts:285, 297-299, 306`, `route.ts:213-224`.

### Inferences
- Items 1–4 dominate cost and latency. Items 5–7 dominate answer quality and trust. Item 8 makes the cost problem invisible. A single shared harness (history policy + result offloading + caching breakpoints + stop-reason handling + wrap-up turn + running cost meter + unified outcome mapping) would address most of the list at once. This matches the intent in `04-harness-skills-reasoning.md` §2 and `11-cowork-style-work.md:61-66, 83`.

### Gaps
- None of these were reproduced at runtime. Items 4, 12 and 20, and the caching inference in Q5, depend on provider and framework behaviour and should be confirmed with a trace (agent_loop_log cache-read tokens, a Claude+thinking Bedrock call, and a captured Inspector request body).
