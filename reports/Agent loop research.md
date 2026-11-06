# Rebuild ALOFT's agent loop as one harness

ALOFT's planning pattern is mostly fine. Its loop plumbing is what's wrong. Inspector chat, saved-agent chat and the Automate "Ask an agent" Try run all run the weakest of three copy-pasted loops: an OpenAI Chat Completions loop against the LLM Lite gateway. Its default model is Grok 4.7, which by the code's own comment loses its reasoning between tool rounds. On that path:

- Full SQL results of up to 1,000 rows go into the model context and are re-sent on each of up to 15 loops.
- Nothing trims or compacts context.
- No prompt-cache breakpoints are set.
- Provider stop reasons are ignored.
- Stop neither cancels the in-flight request nor prevents the pending tools from running.
- Hitting the loop cap returns no answer at all.
- Cost is either mispriced, because gateway model ids fall back to Sonnet rates, or not recorded at all on errored turns.

The evidence does not call for a new planning paradigm. Keep a ReAct-style tool loop with native thinking. Add a living to-do list (`update_plan`) for multi-step work. Base self-correction on execution signals such as SQL errors and reconciliation totals, not "are you sure?" passes. Use sub-agents only for read-only fan-out. The larger gains come from context engineering:

- compact tool results that carry a result handle;
- a stable, cacheable prompt prefix;
- clearing old tool results first, then compaction;
- budgets in dollars, tokens and time instead of loop counts.

Together these should cut per-turn input cost by well over half and improve accuracy, because answer quality falls as context grows. The cost figure is an inference from published cache pricing and has not been measured on ALOFT. All of it belongs in one shared `runAgentTurn` harness. That harness would later move out of the HTTP request into the Postgres-leased worker that ADR-003 already chose, which gives steer, stop, approvals and crash-resume, and the first real executor for "Ask an agent". A golden-set eval gate (execution match, pass^k) should guard every loop change. The plan runs in five phases:

1. About two weeks to measure and fix leaks.
2. One harness.
3. Budgets, plan and compaction behind evals.
4. Durable runs.
5. Routing and sub-agents.

## Every surface runs the weakest of three loop copies

The first finding changes the meaning of most earlier discussion. People associate a set of settings with "the agent loop": temperature 1 or 0.3, a 1,024-token thinking budget, a Bedrock `cachePoint`, and last-loop tool removal. Those settings live in the Bedrock `runAgentLoop` (`src/lib/inspector/agent-loop.ts`), and none of the main surfaces reach it.

**Inspector.** The route forces every model key to an LLM Lite key ("Only LLM Lite models are served", `src/app/api/inspector/chat/route.ts:170-171`). `resolveModel` always returns an LLM Lite config with `bedrockId: ''` (`src/lib/llmlite/inspector-models.ts:40-47`), and dispatch then sends `apiType: 'foundry'` to `runFoundryAgentLoop` (`route.ts:555-557`, `src/lib/inspector/providers/factory.ts:10-12`). With `resource: 'llmlite'` that function takes its Chat Completions branch (`foundry-chat.ts:409-411, 456-463`).

**Saved agents.** `resolveWorkbenchModel` always returns a boost model (`src/lib/construction/workbench-model.ts:40-50`), so `runCatalogAgent` also dispatches to the same loop (`src/lib/agents/run-catalog-agent.ts:326`).

**Automate.** The "Ask an agent" step has no live executor. `executeRun` in `src/lib/flows/runner.ts` is called only by the simulator, whose agent executor returns a `[Simulated]` answer (`src/lib/flows/simulate.ts:99-110`). The only real agent run from Automate is "Try it", which calls `runCatalogAgent` through `src/app/api/agent-lab/flows/agent-try/route.ts`.

The Bedrock loop is still used by minor paths: semantic blueprint routes, flows-copilot fallback and workbench test-run fallback.

This corrects two documents. The design doc still recommends "`runAgentLoop` already supports `cacheSystemPrompt`. Use it" (`docs/business-ai-studio/04-harness-skills-reasoning.md:84`). The earlier harness-gaps report said saved agents hardcode `temperature: 0.3` and cite `agent-loop.ts`. On the live agent path no temperature is sent at all. The Chat Completions request carries only `model`, `messages`, `tools`, a 4,096-token output cap and `stream` (`foundry-chat.ts:456-463`). Behaviour therefore follows each gateway model's provider default and changes silently when someone switches models.

**The production loop has lost its reasoning between tool calls.** The code diagnoses this itself: "Chat Completions has no field for encrypted reasoning. Each tool round then starts from scratch, which is the 'ranking query never ran' repeat" (`foundry-chat.ts:133-135`). The fix, an xAI Responses path that sends reasoning items back unchanged, applies only when `resource === 'xai'`. The default interactive model is `aws_bedrock/xAI-Grok-4.7` through LLM Lite (`src/lib/llmlite/default-model.ts:2`), which takes the Chat Completions path. So the default model loses state on exactly the multi-step questions where reasoning matters most.

The Bedrock path carries a matching latent fault. It sends `thinking: {type: 'enabled', budget_tokens: 1024}` for Anthropic models (`agent-loop.ts:173-181`) and drops thinking blocks from replayed assistant turns (`agent-loop.ts:208-211, 303-307`). Anthropic now treats manual `budget_tokens` as legacy: "Claude 4.7 and later models do not support it and reject requests that use it, returning a 400 error". The replacement is `thinking: {type: "adaptive"}` with an `effort` setting ([Claude docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)). The gateway lists Claude Sonnet 5 (`src/lib/llmlite/labels.ts:3`), so enabling thinking for it on the Bedrock path would fail outright.

Three loop implementations duplicate the same control flow:

- the Bedrock ReAct loop, `agent-loop.ts:120-347`;
- the Chat Completions loop, `foundry-chat.ts:406-684`;
- the xAI Responses loop, `foundry-chat.ts:189-402`.

Fixes land in one copy and not the others. Two routes then rebuild their own harness around the loop, each with its own history policy, caps, cost formula, outcome mapping and persistence. The table shows how far the Inspector and saved-agent paths have drifted. Each divergence changes either correctness or cost reporting.

| Behaviour | Inspector | Saved agents / Try it | Evidence |
|---|---|---|---|
| Loop cap | 15 (env up to 32) | 10, +1 for `submit_answer`, +1 for inspection | `max-loops.ts:2-16`; `run-catalog-agent.ts:37, 304` |
| Cross-turn history | Whole client transcript, uncapped | Last 30 messages, at most 60k chars | `useInspectorChat.ts:306`; `agent-chats.ts:30-31, 66-83` |
| Saved reply | Interim narration replaced via `text_replace` | Every loop's pre-tool narration concatenated, then replayed as history next turn | `route.ts:550-552`; `agents/chat/route.ts:166-169, 201-203` |
| Cost on error | Not recorded | Recorded as `failed` | `route.ts:727-736`; `run-catalog-agent.ts:347-372` |
| Cache-aware cost | Yes (recorder totals) | No: cached tokens billed at full input price | `route.ts:560-587`; `run-catalog-agent.ts:345` |
| Post-run learning | Bandit, judge, memory attribution, session knowledge | None | `route.ts:633-671, 756-783` |
| Tool-log loop index | Live loop number | Always 0 | `route.ts:443`; `run-catalog-agent.ts:285, 291` |

## Four families of defects explain most of the cost and quality loss

The code audit found twenty defects. They fall into four families: unmanaged context, absent caching, a loop that ends badly, and cost that is invisible. None of them was reproduced at runtime. Each comes from reading the current `feature/ui-redesign` tree, and the provider-dependent ones should be confirmed with one trace.

### Context grows roughly quadratically and nothing acts on it

Within a turn, every assistant message and every full tool result is appended and re-sent on the next loop (`foundry-chat.ts:595, 656-658`; `agent-loop.ts:308-312`). The worst item is `execute_tool`, which returns `JSON.stringify(sqlResult)` to the model (`src/lib/inspector/tools.ts:454`). That is up to 1,000 rows by default, and up to 10,000 via `DATABRICKS_MAX_ROWS` (`src/lib/databricks/execute.ts:25-28`). Each row is an object that repeats every column name (`execute.ts:336-352`). Only the UI copy is capped (`tools.ts:444-452`).

A 1,000-row by 15-column result in that format is plausibly 100–300 KB. That is tens of thousands of tokens, re-sent on every later loop, so input tokens grow roughly with the square of the loop count. `measureContext` computes context size on every loop and writes it to `agent_loop_log` (`agent-loop.ts:57-65`), but no code reads it to trim, summarise or stop.

Across turns the picture is similar:

- The Inspector re-sends the whole client transcript with no count or character cap (`useInspectorChat.ts:306`; `route.ts:206-224`).
- It concatenates every `studio_insights` row for the session into the system prompt without a limit (`src/lib/inspector/prompts.ts:458-483`).
- A probable bug sends the latest user message twice: it is appended to state, read back, appended again, and then merged server-side (`useInspectorChat.ts:285, 297-306`). This needs runtime confirmation.
- The only compaction-like mechanism in the codebase is the bounded SESSION KNOWLEDGE block: the last 12 SQLs, at most 48 schema paths and at most 20 heuristics (`src/lib/inspector/session-knowledge-store.ts:108-167`).

This matters for accuracy as well as cost. Anthropic describes "context rot", a gradual decline in recall as tokens grow that appears in all models ([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)). Chroma tested 18 models. On LongMemEval, focused prompts of about 300 tokens beat full prompts of about 113k tokens for every model, and a single distractor reduced accuracy ([Chroma](https://www.trychroma.com/research/context-rot)). A Databricks study cited by Breunig saw correctness start falling around 32k tokens for Llama 3.1 405B ([dbreunig.com](https://www.dbreunig.com/2025/06/22/how-contexts-fail-and-how-to-fix-them.html)). Relevant information in the middle of a long input is used worst ([Liu et al.](https://arxiv.org/abs/2307.03172)). A loop that piles row dumps into the middle of its context is paying more for worse answers.

### Caching is absent exactly where it pays most

Neither production surface sets cache breakpoints. `cacheSystemPrompt` exists only in the Bedrock loop. The Inspector and saved agents never pass it, and the Chat Completions loop does not read it (`foundry-chat.ts:413-416`). On Bedrock, "Requests without cache controls aren't cached" for Anthropic models ([AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)). Claude models behind the gateway therefore almost certainly get no caching at all. `agent_loop_log` cache-read tokens of zero for those models would confirm it.

Two further problems compound this:

- **The Inspector system prompt changes every turn.** It is rebuilt with session insights, SESSION KNOWLEDGE and memory blocks (`route.ts:244-248, 293-298`), so even a system-level breakpoint would miss across turns.
- **The xAI direct path defeats cross-turn reuse.** It sets a fresh `prompt_cache_key = randomUUID()` per run (`foundry-chat.ts:199, 241`). Under xAI and OpenAI routing semantics this likely prevents turn N+1 from reusing turn N's cache. That is inferred from provider behaviour, not verified in code.

The economics are large because agent loops are dominated by input tokens. Manus reports an input-to-output ratio of about 100:1 and calls KV-cache hit rate "the single most important metric for a production-stage AI agent". Cached Sonnet input costs $0.30 per million tokens against $3 uncached ([Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)). First-party cache multipliers are:

- 1.25x the base input price for a 5-minute write;
- 0.1x for a read;
- 0.05x for a read on Opus 5.5 and Sonnet 5.5 ([Claude docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).

Take a 30k-token prefix that grows by 2k per loop. A cached loop costs about 3k + 2.5k ≈ 5.5k token-equivalents instead of 30k, roughly 80% less input cost per loop, and a lower time to first token. This is arithmetic from published multipliers, not an ALOFT measurement.

### The loop ends badly: silent truncation, dead wrap-up logic, fake stops

**Stop reasons are ignored.** No path reads Bedrock `stopReason` or OpenAI `finish_reason`, and the xAI `incomplete` status is treated as completed (`foundry-chat.ts:267-268`). With a 4,096-token output cap, a long markdown answer that hits the limit is reported as `completed`. A tool call cut off mid-arguments fails `JSON.parse` silently, becomes `{}`, and runs anyway (`agent-loop.ts:263`; `foundry-chat.ts:601, 330`). The model then sees a confusing downstream error instead of "your arguments were not valid JSON".

**The last-loop safeguard is effectively dead code.** The Bedrock loop's last-loop tool removal (`agent-loop.ts:162-166`) fires only when `maxLoops === 1` or no tool was ever used, because any earlier tool block forces the tool config back in. The Chat Completions loop sends tools on every call, including the last. If the model calls tools on loop 15, they execute, their results are never shown to the model, and the turn ends `truncated` with `finalText: null` (`foundry-chat.ts:459, 598-668`). The Inspector user then gets interim narration plus a canned "Tool-call limit reached" footer (`route.ts:672-683`), not an answer synthesised from 14 loops of work.

**Stop is a boolean, not a cancellation.** The production loop does not check the abort flag inside its stream loop, so the model keeps generating. It does not check before the tool batch either, so tool calls from the aborted response still run, including live warehouse SQL (`foundry-chat.ts:469-506, 597-652`). Its `AbortController` is wired only to the 45-second stall timer.

**Outcomes after abort are mislabelled in every loop:**

- The Bedrock loop labels an aborted turn `completed` (`agent-loop.ts:316-325`).
- The xAI loop reports a user Stop as a 180-second timeout (`foundry-chat.ts:389-392`).
- The Inspector maps only non-`completed` outcomes to `aborted` (`route.ts:740`). Aborted turns labelled `completed` therefore feed the bandit, the judge and memory-success attribution (`route.ts:615-671`).

**Tool exceptions are handled differently per loop.** On the Bedrock path, one rejecting tool fails the whole turn, because `executeTool` sits in `Promise.all` without a try/catch (`agent-loop.ts:260-267`) and `describe_schema` can throw (`tools.ts:482-485`). The other two loops catch errors per tool.

**There is no retry, backoff or fallback around model calls.** Only SDK defaults apply, and they do not cover failures after streaming starts. Timeouts surface a hard-coded "This is an Azure deployment issue. Please switch to a different model (e.g. Claude Sonnet, Grok 4.3)" even when the call went to LLM Lite (`foundry-chat.ts:671-674`).

### Cost is mispriced, partly unrecorded and enforced only before the turn

**Gateway model ids are mispriced.** `pricingKey` strips only `us.anthropic.` prefixes and version suffixes. Unknown keys fall back to `claude-sonnet-4` at $3 and $15 per million tokens (`src/lib/lifecycle/log-agent-cost.ts:28-32, 59`). LLM Lite ids such as `aws_bedrock/Gpt-6-Luna` and `aws_bedrock/Claude-Haiku-4.5` match nothing. Luna is billed about 24 times too high, and Haiku is billed as Sonnet.

**Other accounting errors:**

- Errored Inspector turns are never written to the spend ledger (`route.ts:727-736, 784-790`), so the most expensive failures, long turns that overflow or time out, are invisible.
- Saved agents ignore the cache split.
- `toolCalls` is recorded as `loops - 1` (`route.ts:632, 697`).
- Turn metrics are silently dropped for non-UUID sessions (`src/lib/agent-ops/record-turn-metrics.ts:41`).

**The budget is checked once.** `assertInteractiveBudget` runs at turn start against a $0.05 default estimate (`src/lib/spend/budgets.ts:201-220`). The loop itself receives no budget, so nothing stops a 15-loop turn partway through.

The design intent already says "Budgets replace loop caps" (`docs/business-ai-studio/11-cowork-style-work.md:83`). The code has not caught up.

## A single agent with a living plan beats both pure ReAct and plan-and-execute

With the plumbing understood, the architectural question is which planning pattern ALOFT's loop should implement. The target task is something like "compare Q3 opex by vessel with last year, find the biggest increases, explain them, produce an Excel and a Word summary". The evidence points to a hybrid, and to restraint about multi-agent designs.

### ReAct remains the right inner loop, but it drifts on long horizons

ReAct interleaves reasoning, action and observation. It beat imitation and reinforcement-learning baselines by 34 points on ALFWorld and 10 on WebShop, and grounding reasoning in tools reduced hallucination ([Yao et al.](https://arxiv.org/abs/2210.03629)). Anthropic describes production agents as "typically just LLMs using tools based on environmental feedback in a loop" ([Anthropic](https://www.anthropic.com/engineering/building-effective-agents)). A modern function-calling loop with interleaved thinking is ReAct with the "Thought" moved into native reasoning tokens.

ReAct's weaknesses are cost and drift:

- One model call per tool step, re-sending the full history each time, is what ReWOO calls redundant prompting. Decoupling planning from observations gave ReWOO **5x token efficiency** and +4% on HotpotQA ([Xu et al.](https://arxiv.org/abs/2305.18323)).
- LLMCompiler plans a DAG of calls and runs it in parallel, reporting up to **3.7x lower latency, 6.7x lower cost and about 9% higher accuracy** than ReAct ([Kim et al.](https://arxiv.org/abs/2312.04511)).
- Manus says a typical task needs about 50 tool calls, which leaves the model "vulnerable to drifting off-topic or forgetting earlier goals" ([Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)).

Those papers compare against 2022–23 ReAct on weaker models. With native parallel tool calling in today's APIs, the gap against a frontier model in a native tool loop is probably smaller. No 2025–26 replication was found.

Pure plan-and-execute fails in the opposite way. The opex request has a predictable skeleton:

1. Resolve definitions.
2. Query this year's Q3.
3. Query last year's Q3.
4. Rank the deltas.
5. Explain the top items.
6. Build the Excel file.
7. Build the Word file.

But step 5 depends on what step 4 finds, so a fully static plan breaks. Tree and graph search, such as Tree of Thoughts raising Game of 24 from 4% to 74% at many times the calls ([Yao et al.](https://arxiv.org/abs/2305.10601)), suits puzzle-like tasks with cheap evaluators. Analytics has neither: every search node costs warehouse queries, and there is no cheap judge of "a good analysis".

### The living to-do list is the convergent 2025–26 design

Leading agents converged on a hybrid: a tool loop in which the model keeps an explicit, mutable task list, updates it after each step, and re-reads it. Manus rewrites a `todo.md` because "by constantly rewriting the todo list, Manus is reciting its objectives into the end of the context," which counters lost-in-the-middle and goal drift ([Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)). Anthropic lists "structured note-taking" next to compaction and sub-agents as a core long-horizon technique ([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)). One of its three agent principles is to show the agent's planning steps explicitly ([Anthropic](https://www.anthropic.com/engineering/building-effective-agents)). Claude Code (TodoWrite) and the Codex CLI (`update_plan`) expose this as a tool.

The evidence for this pattern is engineering rationale, not ablation. No vendor has published accuracy with and without a to-do tool. It is still the lowest-risk design for ALOFT, for four reasons:

- It keeps the deliverable list in the most-attended position, which addresses the "forgot the Word summary" failure.
- It gives the UI a plan panel, which the cowork design already specifies.
- It costs one small tool.
- It cannot make the plan rigid, because the model rewrites it.

For governance, the plan should carry data lineage: which query result backs which claim.

### Self-correction works only with an external signal

Reflexion reached 91% pass@1 on HumanEval by storing reflections, but that gain relied on executing unit tests, an external signal ([Shinn et al.](https://arxiv.org/abs/2303.11366)). Without external feedback, models rarely find their own reasoning errors and sometimes change correct answers to wrong ones ([Huang et al.](https://arxiv.org/abs/2310.01798)). The MAST taxonomy of 1,600+ multi-agent traces found these modes ([MAST](https://arxiv.org/html/2503.13657v3)):

| Failure mode | Share of traces |
|---|---|
| No or incomplete verification | 8.2% |
| Incorrect verification | 9.1% |
| Step repetition | 15.7% |
| Unaware of termination conditions | 12.4% |

A task-objective verification step improved success by 15.6% (same source).

For ALOFT, the verifiers should be execution-grounded:

- SQL compile and dry-run errors fed back into the loop;
- row-count and NULL sanity checks;
- reconciliation against control totals;
- schema validation of a typed final answer;
- a check that every number in the prose traces to a query result.

Open-ended "critique and revise" passes on the narrative add cost without evidence of benefit.

### Sub-agents only for read-only fan-out

The multi-agent evidence is consistent once you look at task shape:

- **Where it wins.** Anthropic's research system, with an Opus 4 lead and Sonnet 4 workers, beat single-agent Opus 4 by **90.2%**. It used about **15x** the tokens of chat, and token usage alone explained 80% of performance variance on BrowseComp ([Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)).
- **Where it fails.** The Google and MIT scaling study tested 180 configurations. Centralized multi-agent was **+80.9% on parallelizable Finance-Agent tasks**, but **every multi-agent variant degraded strictly sequential PlanCraft by 39–70%**. Error amplification was 17.2x for independent agents and 4.4x for a centralized orchestrator ([Google Research](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/)).
- **Why it fails.** Cognition warns that "actions carry implicit decisions, and conflicting decisions carry bad results" and defaults to a single-threaded agent ([Cognition](https://cognition.com/blog/dont-build-multi-agents)).

ALOFT's core analytics chain is sequential and shares definitions: fiscal calendar, vessel hierarchy, currency, metric logic. That favours one agent. Sub-agents are justified for read-only fan-out, such as researching explanations for each of the top N vessels or searching several knowledge bases. Each sub-agent should return a compact, typed finding of about 1,000–2,000 tokens, under a centralized orchestrator, with outputs forwarded verbatim. Anthropic also found that without explicit effort-scaling rules, early versions spawned 50 sub-agents for simple queries. Their rules: 1 agent and 3–10 calls for fact-finding, 2–4 sub-agents for comparisons ([Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)).

### Routing, workflows and typed answers around the loop

Anthropic separates workflows (predefined code paths) from agents, and recommends the simplest structure that works ([Anthropic](https://www.anthropic.com/engineering/building-effective-agents)). For ALOFT, the loop should sit inside some workflow scaffolding:

- **Routing in front.** A routing step sends simple lookups to a cheap, low-effort path.
- **Fixed sub-steps with gates.** Validate SQL against the semantic layer. Render documents deterministically from a typed result object.

Strict format constraints can degrade reasoning ([Tam et al.](https://arxiv.org/abs/2408.02442)). So the model should reason in thinking or in tool steps and emit the typed final object last. `submit_answer` already provides the hook for this.

On thinking, the guidance has converged. Use adaptive thinking with a fixed effort level per route, chosen per task and held constant within a conversation, because changing thinking settings invalidates cached message prefixes ([Claude docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)). Anthropic now recommends extended thinking over a separate "think" tool "in most cases" ([Anthropic](https://www.anthropic.com/engineering/claude-think-tool)).

## Context engineering is the cheapest large win

Once the loop pattern is settled, most of the cost and quality gain comes from what goes into the context on each call. The practitioner consensus (Anthropic, Manus, Cognition) has four parts:

- treat context as a scarce attention budget;
- keep the prefix stable and append-only;
- keep bulky observations outside the prompt behind a restorable reference;
- recite the plan near the end of the context.

### Tool results should be previews with handles, not dumps

Anthropic's tool-design guidance ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)):

- Return high-signal fields.
- Offer a concise or detailed response format. In one example this cut a Slack response from 206 to 72 tokens.
- Paginate and truncate with sensible defaults. Claude Code caps tool responses at 25,000 tokens.
- Write errors that state the fix.

Manus recommends restorable compression: drop the body, keep the URL or path ([Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)).

For `execute_tool`, the default model-facing result should be:

- column names and types, once;
- the first 20–50 rows as compact CSV or TSV;
- the total row count and a truncated flag;
- a `result_id` handle and a hint ("aggregate, add WHERE, or call `fetch_result(result_id, offset)`");
- a hard per-tool cap of a few thousand tokens.

ALOFT already keeps the full rows server-side in `sessionQueryResults` (`route.ts:363-374`) and `studio_query_results` (`tools.ts:310-315`), so the handle needs no new storage. The same `result_id` fixes the `emit_chart` race. That tool currently charts the last entry of `context.queryResults` and races any `execute_tool` in the same batch (`tools.ts:189-197`). It should take an explicit `result_id` instead.

Error results need the same discipline:

- Return "arguments were not valid JSON" instead of `{}`.
- Pass the `retryable` flag to the model, not only to the UI (`agent-loop.ts:291-293`).
- Give the model the "add a LIMIT" hint for `RESULT_TOO_LARGE`, which today goes only to the UI (`tools.ts:471-474`).
- Remove guidance that contradicts the system prompt. An empty catalog today tells the model to run `SHOW CATALOGS`, which the harvested-mode prompt forbids (`describe.ts:266-269` vs `prompts.ts:46, 62`).
- Keep failed actions in context. "Erasing failure removes evidence" ([Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)).

A different approach, Anthropic's programmatic tool calling, has the model write code that orchestrates tools so intermediate data never enters context. It cut tokens on complex research tasks by 37% ([Anthropic](https://www.anthropic.com/engineering/advanced-tool-use)). It needs a sandbox, which the cowork design defers (decision C2). The handle-based preview gets most of the benefit for SQL without one.

### Clear old tool results first, compact second

Use the cheapest technique first:

1. **Clear old tool results.** Anthropic's `clear_tool_uses_20250919` context edit removes the oldest tool results server-side and leaves placeholders. It is configured with a `trigger` (default 100k input tokens), a `keep` count (default the last 3 tool pairs), `clear_at_least` (so each clear saves enough to repay the cache rewrite), and `exclude_tools`. It is in beta on Bedrock ([Claude docs](https://platform.claude.com/docs/en/build-with-claude/context-editing)).
2. **Compact with an LLM summary.** Anthropic now recommends its server-side compaction (`compact_20260112`) over client-side SDK compaction (same source).
3. **Trim or summarise across turns.** The OpenAI Agents SDK cookbook contrasts trimming the last N turns (deterministic, weak long-range recall) with summarising older turns (better recall, at the risk of "context poisoning"). Its summaries keep identifiers, steps tried, errors quoted exactly, current status and next step, and mark unverified items ([OpenAI cookbook](https://developers.openai.com/cookbook/examples/agents_sdk/session_memory)).

Whether LiteLLM passes `context_management` through to Bedrock is unverified. ALOFT should therefore implement the cheap form client-side in its own harness. Keep the last 3 SQL or document results verbatim, replace older ones with a one-line stub (SQL hash, row count, `result_id`), and trigger at 30–60k tokens rather than 100k, given the 32k degradation onset in the Databricks data. Add LLM summarisation for Inspector sessions that cross a turn or token threshold. The summary should keep table and column names, the final working SQL, numeric results, errors and user constraints verbatim, and could run on a cheap model.

Three bounded fixes belong in the same work:

- Cap PRIOR ANALYSIS INSIGHTS.
- Cap the Inspector transcript, using the 30-message, 60k-character policy saved agents already use.
- Stop saving concatenated narration as the agent's reply by wiring `onTextReplace` in `runCatalogAgent`.

Each clear or compaction invalidates the cache from that point on, so they should run in large batches, not every loop.

### Lay out the prompt for the cache

Bedrock processes cache checkpoints in the order tools → system → messages. "Changing content in an earlier section invalidates the cache for later sections." A checkpoint looks back only about 20 content blocks, and a checkpoint below the model's minimum (512 tokens for Claude 5.x) silently does nothing ([AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)). Changing tool definitions invalidates everything. Changing `tool_choice`, thinking settings or effort invalidates messages ([Claude docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).

ALOFT's layout should be:

1. **Tools.** A static, deterministically serialised tool list with a breakpoint at its end.
2. **System.** The static base prompt, answer rules and chart DSL, with a breakpoint at its end.
3. **Per-session blocks moved to a message.** The semantic context, insights, SESSION KNOWLEDGE and memory move out of the system prompt into a context message after it, where their per-turn changes do not invalidate the static prefix.
4. **A rolling breakpoint.** Either a breakpoint on the last message, or Bedrock's top-level automatic `cache_control`, so each loop reads the previous loop's full request from cache.

Tools should be masked, not removed. Manus warns that adding or removing tools mid-task breaks the cache and confuses the model ([Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)). The current last-loop removal idea is therefore wrong even where it works.

For Grok and OpenAI-family models, set a per-session `prompt_cache_key` instead of a per-run UUID.

All of this depends on the gateway emitting cache points. A LiteLLM issue documents that its injection points originally covered only messages, so tool definitions were reprocessed on every request. The request for tool-level points was closed in March 2026 with no merged PR visible ([LiteLLM #21969](https://github.com/BerriAI/litellm/issues/21969)). The acceptance test is empirical: log the outgoing payload and require `cache_read_input_tokens > 0` from loop 2 onward.

### Route per task, never per loop

Routing is well evidenced for single-turn queries:

- RouteLLM kept 95% of GPT-4 quality while cutting cost by over 85% on MT-Bench ([LMSYS](https://lmsys.org/blog/2024-07-01-routellm/)).
- FrugalGPT reported up to 98% cost reduction as a ceiling ([Chen et al.](https://arxiv.org/pdf/2305.05176)).
- AWS says Bedrock Intelligent Prompt Routing can cut costs by up to 30% ([AWS](https://aws.amazon.com/bedrock/intelligent-prompt-routing)).

Gains inside multi-step tool loops are unproven. Caches are per model, so switching models mid-turn throws the cache away. Anthropic also found that upgrading the model beat doubling the token budget ([Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)).

ALOFT should keep one strong model per turn for planning, SQL over unfamiliar schemas and error recovery. Cheap models should handle bounded side jobs:

- intent classification for the router;
- compaction summaries;
- condensing long document passages;
- possibly chart-spec generation, which today reuses the turn model with a hard-coded Sonnet fallback (`tools.ts:150-160`).

The harness should fail over to a second model on classified provider errors (5xx, overload) instead of telling the user to switch. The bandit observations the Inspector already collects could inform routing later, but only after the eval set exists to prove a cheaper route holds quality.

On output caps, lowering `max_tokens` saves little, because output is a small share of cost and billing is for tokens generated. The real risk is truncation. The fix is to detect the `max_tokens` or `length` stop reason, continue once, and use a larger cap for the final synthesis step than for tool-selection steps.

## Runs must outlive the HTTP request

Today every ALOFT agent run lives inside one streaming HTTP request with `maxDuration = 300` (`route.ts:59`; `agents/chat/route.ts:22`; `flows/agent-try/route.ts:11`). Cancellation is a shared boolean polled between steps, and the transcript survives a refresh only through client autosave. That is incompatible with the cowork vision of background tasks, steering and approvals. It also means Automate cannot run a real agent step at all.

### The step boundary is per model call and per tool call

Every mature durable-execution option uses the same core idea: Temporal (whose TypeScript AI SDK plugin wraps each model call as an Activity), Restate, DBOS, Inngest and Vercel Workflow. Each model call and each tool call becomes a recorded step whose result is journaled. After a crash, orchestration resumes and returns the recorded results instead of calling the model again ([Temporal](https://docs.temporal.io/develop/typescript/integrations/ai-sdk); [Restate](https://www.restate.dev/blog/durable-ai-loops-fault-tolerance-across-frameworks-and-without-handcuffs); [DBOS](https://dbos.dev/dbos-transact)). Vercel's guidance states the trap plainly: wrapping the whole loop in one step records nothing until the loop finishes, so an interruption repeats everything ([Vercel KB](https://vercel.com/kb/guide/durable-ai-agents)).

ADR-003 already chose a Postgres-leased worker using the harvester's `FOR UPDATE SKIP LOCKED` and heartbeat pattern. Its switch-to-Temporal triggers are sound: above about 50 runs per second, durable timers inside steps, or repeated duplicate-execution incidents (`docs/business-ai-studio/adr/ADR-003-workflow-runtime.md`). The research supports this. A custom leased worker is enough when:

- there is one workflow type (the agent loop);
- approvals end the run, with status `awaiting_approval` and the lease released, rather than holding a worker;
- resume means "load state from Postgres and continue".

If the team would rather not hand-roll retries, durable sleeps and recovery, DBOS is the lowest-friction way to adopt an engine. It is an in-process TypeScript library whose only backend is Postgres ([DBOS](https://dbos.dev/dbos-transact)). Two known hazards for the home-built route:

- A Postgres MVCC race in Trigger.dev's waitpoints left runs blocked when a wait was created at the moment its token completed ([Trigger.dev](https://github.com/berioxqc/trigger.dev)).
- Replaying from a checkpoint re-runs any side effects between that checkpoint and the pause ([LangGraph](https://docs.langchain.com/oss/javascript/langgraph/interrupts)).

The minimal schema is five tables:

| Table | Holds |
|---|---|
| `agent_runs` | status, lease owner, lease expiry with a fencing token, pinned agent version, budget counters |
| `agent_tool_calls` | each call persisted as `started` before it executes, with an idempotency key derived from the step id |
| `run_events` | an append-only `(run_id, seq, type, payload)` log |
| `run_inbox` | steer, stop, pause and cancel requests |
| `approvals` | pending, approved, rejected and expired decisions, each with reviewer identity and an argument snapshot |

### Steer and stop are inbox messages, not closed connections

The AI SDK's resumable-stream docs make the key distinction. "Client-side aborts are treated as disconnects", and `stop()` "only closes the current HTTP connection". A real Stop calls a dedicated endpoint that persists the partial response, cancels the work, and clears the active stream ([AI SDK](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams)). The Claude Agent SDK's streaming mode supports queued user messages that "process sequentially, with ability to interrupt" ([Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)).

For ALOFT, the worker drains `run_inbox` before each model call:

- **Steer.** Appended as a user turn before the next step.
- **Stop.** Finish the current step, run one budgeted, tools-off "summarise progress" turn, and mark the run `stopped`.
- **Pause.** Checkpoint and release the lease.
- **Cancel.** A hard abort through an `AbortSignal` that reaches the HTTP request to the model. Any in-flight non-idempotent tool call is marked "outcome unknown" for a human.

The UI tails events with `GET /api/runs/:id/events?after=seq` over SSE, using `Last-Event-ID`. This gives reconnect, multiple tabs and an audit trail without Redis, and makes load-balancer idle timeouts harmless.

### Approvals and idempotency are first-class rows

The Claude Agent SDK documents the clearest permission model. Rules are evaluated in this order: hooks, deny rules (which win even in bypass mode), ask rules, mode, allow rules, then a callback ([Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/permissions)). The OpenAI Agents SDK serialises a paused `RunState` with pending approval items. It warns that `RunState.fromString()` "does not authenticate the snapshot", so the server must verify integrity, authorise the reviewer, prevent replay, and consume each pending request atomically ([OpenAI Agents JS](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)).

Durable engines guarantee that a step result is recorded exactly once. They do not guarantee that its side effect happens exactly once. ALOFT should classify every tool as read, idempotent write or non-idempotent write, and pass the step-derived idempotency key downstream ([Vercel KB](https://vercel.com/kb/guide/durable-ai-agents)). Today's tools are read-only SQL and knowledge search, so this is cheap to set up now and essential before the M365 write tools land.

### Budgets replace loop caps, with a repetition detector

Frameworks mostly expose step caps: the AI SDK's `isStepCount(20)` default, the Claude Agent SDK's `maxTurns`. Dollar budgets are left to custom stop conditions, and the AI SDK documents one that stops at $0.50 of estimated cost ([AI SDK](https://ai-sdk.dev/docs/agents/loop-control)).

ALOFT should keep a per-run ledger of cost, tokens, wall-clock time and tool calls, and check it before every model call and tool batch. Reaching the soft limit forces a wrap-up turn with tools off that synthesises from what was found. Reaching the hard limit stops the run and asks the person whether to continue, which matches the cowork design's "never fails silently". The ledger needs correct prices to work, which is another reason the pricing fix comes first.

A detector for repeated identical calls is the cheapest guard against MAST's most common failure, step repetition. It hashes the tool name plus normalised arguments, and replans or stops after N repeats. Retry policies need maximum attempts. Spend-cap 429s that carry no `retry-after` header should be treated as terminal ([Claude API](https://platform.claude.com/docs/en/api/errors)).

## Evaluation and tracing must gate every loop change

Every change above alters loop behaviour in ways that pass@1 can hide: compaction, budgets, the plan tool, routing, a new provider adapter. Anthropic's guidance is to grade the outcome, meaning the end state, before the path, and to report **pass^k**, the probability that all k trials pass. At 75% per-trial success, pass^3 is about 42% ([Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)). On tau-bench, gpt-4o-class agents solved under 50% of tasks, and pass^8 fell below 25% in retail ([Yao et al.](https://arxiv.org/abs/2406.12045)).

Hamel Husain recommends:

- error analysis of real traces first;
- binary pass/fail checks;
- code assertions wherever a rule can decide;
- one LLM judge per failure mode, validated by TPR and TNR against 100–200 human labels;
- a transition-failure matrix to locate hotspots such as generate-SQL → execute-SQL ([Hamel Husain](https://hamel.dev/blog/posts/evals-faq/)).

Public benchmarks only shortlist models. Spider 2.0-Lite tops out around 76% while single-shot BIRD reaches 83% ([Spider 2.0](https://spider2-sql.github.io/); [BIRD](https://bird-bench.github.io/)). Enterprise agentic SQL is far from solved, and scaffolding is the main lever.

For loop work, ALOFT needs a golden set of 30–50 Inspector and agent questions drawn from real traces. Each question records reference SQL and its expected result on a pinned snapshot, plus the expected tables, numeric tolerances and required citations. Include long multi-step tasks, because compaction regressions show up as MAST's "loss of conversation history" and "step repetition". Run each case k = 3 times through the production harness itself, never a parallel test path.

Block merges when regression pass^3 drops. Track efficiency on the same run:

- steps;
- input tokens and cache-read ratio;
- cost per **successful** task, which penalises cheap loops that fail;
- p95 latency and time to first token;
- budget-exhaustion rate;
- repetition events.

The `Platform*` eval tables and runner design from the agent-versioning work serve both purposes. The loop gate and the agent release gate should share one runner.

Tracing should follow the OpenTelemetry GenAI conventions: `invoke_agent`, `chat` and `execute_tool` spans with token, cache, model, finish-reason and `error.type` attributes. Message content capture should be opt-in, because it is "likely to contain sensitive information" ([OTel](https://github.com/open-telemetry/semantic-conventions/blob/v1.37.0/docs/gen-ai/gen-ai-agent-spans.md)). The conventions are still at Development stability, so ALOFT should keep its own `agent_turn_log` and `agent_loop_log` schema and map them onto it.

Three additions to the existing schema matter:

- finish reason, provider request id and retry count per loop;
- compaction events with token counts before and after;
- agent id and version.

Warehouse rows and KB text are untrusted tool output. Spotlighting, which marks provenance with delimiters, cut indirect-injection success from over 50% to under 2% on GPT-family models ([Hines et al.](https://arxiv.org/abs/2403.14720)). Before any write tool ships, the stronger architectural rule applies: once an agent has read untrusted input, it should be structurally unable to trigger consequential actions without a plan fixed beforehand or a human confirmation ([Beurer-Kellner et al.](https://arxiv.org/html/2506.08837v3)).

## Recommendations ranked by impact and effort

Impact weighs cost, answer quality and trust. Effort uses the cowork plan's sizes for one engineer who knows the repo: S is under 2 days, M is 2–5 days, L is 1–2 weeks. Sizes are estimates. The ranking puts high-impact, low-effort items first. The harness consolidation (row 7) ranks lower only because of its size; it is what makes rows 8 onward cheap.

| # | Recommendation | Fixes | Impact | Effort | Where |
|---|---|---|---|---|---|
| 1 | Return SQL previews (schema, 20–50 CSV rows, count, `result_id`) with a per-tool token cap; full rows stay server-side; `emit_chart` takes `result_id` | Context bloat, quadratic cost, chart race | Very high | S–M | `tools.ts:440-454`, `execute.ts`, `foundry-chat.ts:650-658` |
| 2 | Fix cost truth: gateway-id pricing table or the gateway's cost header, cost errored and aborted turns, cache split for agents, real tool-call counts, keep metrics for non-UUID sessions | Invisible and wrong spend; prerequisite for budgets | High | S | `log-agent-cost.ts:28-59`, `route.ts:632-736`, `run-catalog-agent.ts:345`, `record-turn-metrics.ts:41` |
| 3 | Read stop reasons; continue once on `max_tokens`; return a JSON-parse error to the model; final tools-off wrap-up turn that answers from gathered evidence | Silent truncation, no answer at the cap | High | S | all three loops; `route.ts:672-683` |
| 4 | Real Stop: user abort reaches the model request's `AbortController`; check abort before the tool batch; correct outcome labels; keep aborted turns out of bandit, judge and memory | Wasted tokens and SQL after Stop, polluted learning data | High | S | `foundry-chat.ts:453-506, 597`, `agent-loop.ts:316-325`, `route.ts:740` |
| 5 | Cache-first prompt layout: static tools and system first, per-session blocks in a later message, explicit breakpoints for Claude through the gateway, per-session `prompt_cache_key`; verify `cache_read > 0` from loop 2 | Uncached ~100:1 input mix | High | S–M | `route.ts:234-325`, `prompts.ts`, `foundry-chat.ts:199` |
| 6 | Preserve reasoning: send gateway Grok through a Responses-style path that returns reasoning items, or change the default model; adaptive thinking with fixed effort for Claude, thinking blocks preserved | Default model forgets its plan between tool rounds; latent 400 on Claude 4.7+ | High | M (depends on gateway) | `foundry-chat.ts:133-143, 409-411`, `agent-loop.ts:173-211`, `default-model.ts` |
| 7 | One `runAgentTurn` harness (history policy, tool-result store, cache plan, cost meter, outcome mapper, persistence) with provider adapters; Inspector, agent chat and Try it all call it | Three loops, two route harnesses, drifting fixes | Very high (enabler) | L | new `src/lib/agent-runtime/`; callers `route.ts`, `run-catalog-agent.ts` |
| 8 | Loop golden set (30–50 cases), k = 3 runner, execution-match scorers, efficiency metrics; merge gate on pass^3 | Unmeasured regressions from every item below | High | M | `Platform*` eval tables; shared runner with the versioning work |
| 9 | Running budget ledger (USD, tokens, time, tool calls) replacing loop caps; soft limit → wrap-up, hard limit → pause and ask; repeated-call detector | Runaway turns; MAST step repetition | High | M | `budgets.ts`, harness |
| 10 | Tool-result clearing (keep last 3, stub the rest, 30–60k trigger), Inspector history cap, insights cap, then LLM compaction for long sessions; fix narration-in-history | Context rot over long sessions | High | M | harness, `prompts.ts:458-483`, `useInspectorChat.ts:306`, `run-catalog-agent.ts` |
| 11 | `update_plan` tool with a plan panel; plan carries query lineage | Sub-goal drift, forgotten deliverables, transparency | Medium–high | M | harness, Inspector UI |
| 12 | Typed final answer plus execution-grounded verifiers (reconcile totals, numbers trace to results) | Unverified numbers in prose | Medium–high | M | `submit_answer`, answer rules |
| 13 | Durable runs on the ADR-003 worker: `agent_runs`, `run_events` SSE, `run_inbox` steer/stop, `approvals`, idempotent `agent_tool_calls`; first live "Ask an agent" executor pinned to an agent version | 300 s ceiling, no background or steer, no real Automate agent step | Very high for Automate | L | `src/lib/flows/runner.ts`, `src/lib/context/queue.ts` pattern, new run tables |
| 14 | Per-task routing: cheap model for classification, compaction and chart specs; strong model for the loop; failover on 5xx | Cost on easy turns, brittle provider failures | Medium | M | harness, `model-registry.ts` |
| 15 | `delegate` sub-agents for read-only fan-out under a central orchestrator, with effort-scaling rules and typed returns | Breadth tasks (multi-KB, per-vessel explanations) | Medium | M–L | harness; needs versioned agents |
| 16 | Hygiene: per-tool try/catch on Bedrock, replace the global `describe_schema` semaphore of 2 with pool sizing, remove contradictory tool guidance, honest timeout text, dedupe the user message, static-key Bedrock client | Smaller correctness and latency bugs | Low–medium | S | `agent-loop.ts:110-118, 260`, `dispatch.ts:9-26`, `describe.ts:266`, `foundry-chat.ts:671` |

## A five-phase plan from leak fixes to durable tasks

The sequence follows dependency. Measurement comes first, because every later claim of savings needs a baseline. The single harness comes before features, because otherwise each feature has to be built three times. Evals come before budgets, compaction and routing, because those change behaviour in ways only pass^k shows. Durable runs come after the harness, because the worker should run the same `runAgentTurn` that the interactive surfaces use. The cowork design's decision C1 already requires one worker and one run store for Automate runs and chat tasks.

| Phase | Weeks (one engineer, estimate) | Scope | Exit criteria (falsifiable) |
|---|---|---|---|
| **0. Measure and stop the leaks** | 1–2 | Items 2, 3, 4, 1 and 16. Capture an Inspector request body and a 7-day baseline from `agent_loop_log`: `context_chars`, cache-read tokens, loops, finish reasons, cost per turn by model | Every errored and aborted turn has a cost row; no aborted turn is labelled `completed`; no `execute_tool` result above the token cap enters context; a long answer is never reported `completed` with a `length` finish reason; baseline dashboard exists |
| **1. One harness, cache-first** | 2–3 | Item 7: `runAgentTurn` with Chat Completions, Responses and Converse adapters; both routes and Try it migrate; item 5 prompt restructure and breakpoints; item 6 reasoning preservation; unify loop caps, outcome mapping and post-run hooks | Inspector and saved agents produce identical outcome and cost semantics for the same question; on Claude via the gateway, `cache_read > 0` from loop 2 on ≥90% of multi-loop turns; the default model no longer repeats queries it already ran across tool rounds (trace check) |
| **2. Evals, budgets, plan, compaction** | 3–4 | Item 8 first, then items 9, 10, 11 and 12 behind the pass^3 gate | Regression pass^3 is no worse than the Phase 1 baseline; median input tokens per multi-loop turn fall ≥50% from the Phase 0 baseline; a 6-step task shows its plan and ticks each step; reaching the budget yields a synthesised partial answer, never an empty one |
| **3. Durable runs and live Automate agents** | 3–5 | Item 13 on the ADR-003 worker built as a general engine; SSE replay by `seq`; Stop, steer and cancel through `run_inbox`; approvals as rows; idempotency keys on tool calls; chat hands a task to the worker after ~60 s or on "Run in background"; live "Ask an agent" executor pinned to a version | ADR-003's acceptance tests pass; killing the worker mid-task resumes from the last completed step without repeating a tool call; a steer message changes the next step; Stop ends within one step and saves a summary; a published flow runs a real agent step |
| **4. Routing, sub-agents, online quality** | ongoing | Items 14 and 15; nightly sampled judges with TPR/TNR; OTel export; spotlighting of tool results; plan-then-execute or confirmation before any M365 write tool | Cheaper route holds regression pass^3 within the agreed margin at lower cost per successful task; three parallel read-only sub-tasks finish faster than their sum with no rise in error rate |

Phase 3 depends on two items from the agent-versioning work. A live "Ask an agent" step must pin an immutable agent version, and runs must refuse agents that are not in a runnable status. Without those, a durable background run could execute a draft whose prompt a builder changed mid-task.

## Conclusion

The research changes the framing of ALOFT's agent problem. The question looked like ReAct versus plan-and-execute versus multi-agent. The evidence says that choice is secondary. The dominant variables are what enters the context on each call, whether the prefix is cached, and whether the harness tells the truth about how a turn ended and what it cost. ALOFT gets all three wrong on its production path, and it does so in a loop the team's own documents treat as a minor fallback. That also explains why earlier fixes, such as Bedrock caching and last-loop tool removal, never reached users.

The practical implication is that the cheapest changes are also the ones that make the rest measurable. Compact tool results, correct pricing, real Stop and stop-reason handling take days, not weeks. They produce the first honest baseline of what an ALOFT turn costs and how often it truncates. From there, a single harness turns every later technique into one change instead of three: the living plan, compaction, budgets, durable steer and approve, routing. The eval gate is what keeps those techniques from silently trading consistency for savings.
