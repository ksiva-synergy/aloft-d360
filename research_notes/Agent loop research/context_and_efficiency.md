# Context engineering and token/cost/latency optimisation for tool-using LLM agent loops (2024-2026)

Scope note: the target system is an agent loop on AWS Bedrock (Converse API; Claude and other models via a LiteLLM gateway) that calls SQL and document tools, resends the full history on every iteration, and uses max_tokens = 4,096 per call. Research done 2026-11-04. Model names below (Claude 5.x, GPT-6, etc.) are taken verbatim from the current vendor docs fetched on that date.

## 1. Context engineering guidance (Anthropic, Manus, Cognition, LangChain/Breunig, Chroma, Lost in the Middle)

### Takeaway
All the major practitioner sources agree. Treat context as a scarce "attention budget". Keep the prefix stable and append-only so the KV cache (prompt cache) keeps hitting, store bulky observations outside the prompt and keep only a reference, and repeat the current plan near the end of the context. Independent research (Chroma, Lost in the Middle, Databricks, Microsoft/Salesforce) shows that quality drops as input grows, even on simple tasks. Long context therefore costs accuracy as well as money.

### Cited Findings
**Anthropic, "Effective context engineering for AI agents" (Sep 29, 2025)**
- Goal: find "the smallest possible set of high-signal tokens" that maximises the chance of the desired outcome. Context has diminishing returns. — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- "Context rot": recall accuracy falls as token count grows. It is a gradual decline, not a cliff, and it appears in all models. Anthropic attributes it to n² pairwise attention and to training data that skews towards shorter sequences. — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- System prompts should sit at the "right altitude", between brittle if-else rules and vague guidance. Organise them with XML/Markdown sections. Start minimal on the best model and add instructions only for observed failures. — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Tools should form a small, non-overlapping set and return token-efficient output: "if a human engineer can't clearly choose a tool, the agent won't do better." — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Just-in-time retrieval: keep lightweight references (file paths, stored queries, links) and load the data with tools at runtime. A hybrid of some preloading plus exploration suits domains such as legal and finance. Claude Code preloads CLAUDE.md and uses glob/grep just-in-time. — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Long-horizon techniques:
  - Compaction: summarise near the limit and restart; the lightest form is clearing old raw tool results.
  - Structured note-taking: NOTES.md or a todo file outside the context.
  - Sub-agents: return condensed summaries of "often 1,000-2,000 tokens".
  - Which to use: compaction for long back-and-forth, notes for milestone-driven work, multi-agent for parallel research. — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

**Manus, "Context Engineering for AI Agents: Lessons from Building Manus" (Yichao "Peak" Ji, Jul 18, 2025)**
- KV-cache hit rate is "the single most important metric for a production-stage AI agent" because it drives both latency and cost. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- The average input-to-output token ratio in Manus is about 100:1. With Claude Sonnet, cached input costs $0.30/MTok against $3/MTok uncached, a 10x difference. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- Keep the prompt prefix stable. A single-token change invalidates the cache from that point on. A common mistake is a second-precision timestamp at the start of the system prompt. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- Make the context append-only: do not modify earlier actions or observations. Use deterministic serialisation, because some JSON libraries do not guarantee stable key order. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- Mark cache breakpoints explicitly where the provider requires it, including at least the end of the system prompt, and account for cache expiry. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- Mask tools instead of removing them. Adding or removing tools mid-loop invalidates the cache, and references to tools that are no longer defined confuse the model. Manus uses a state machine plus logit masking or response prefill (auto / required / specified modes). Consistent prefixes such as `browser_` and `shell_` let it restrict whole tool groups. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- Use the file system as memory. Even with 128K+ windows, observations get too large, performance degrades and re-prefill is costly. Compression should be restorable: drop a page body but keep its URL, drop a document but keep its path. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- Recitation: a typical Manus task takes about 50 tool calls. Rewriting a todo.md each step pushes the plan to the end of the context and reduces drift and lost-in-the-middle effects. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- Keep failed actions and stack traces in context so the model updates its beliefs and avoids repeating mistakes. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- Avoid few-shot ruts. Repetitive contexts, such as reviewing 20 resumes in a row, cause the model to imitate itself. Introduce controlled variation in serialisation or phrasing. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)

**Cognition, "Don't Build Multi-Agents" (Walden Yan, Jun 12, 2025)**
- Two principles: (1) share context, meaning full agent traces rather than single messages; (2) actions carry implicit decisions, so parallel agents with conflicting assumptions produce clashing results. Recommended default: a single-threaded linear agent. For long tasks, add a compression LLM that condenses history into "key details, events, and decisions". A fine-tuned smaller model may help with this. — [Cognition](https://cognition.com/blog/dont-build-multi-agents)
- Flappy Bird example: parallel sub-agents produced a Mario-style background and a mismatched bird. — [Cognition](https://cognition.com/blog/dont-build-multi-agents)

**Drew Breunig, "How Contexts Fail" (Jun 22, 2025; the taxonomy LangChain's context-engineering posts adopted)**
- Context poisoning: a hallucination enters the context and is referenced repeatedly. In the Gemini 2.5 Pokémon agent, goals and summary were "poisoned". — [dbreunig.com](https://www.dbreunig.com/2025/06/22/how-contexts-fail-and-how-to-fix-them.html)
- Context distraction: past about 100k tokens, the Gemini agent repeated actions from its history instead of planning (anecdotal). A Databricks study saw correctness begin to fall around 32k tokens for Llama 3.1 405B, and earlier for smaller models. — [dbreunig.com](https://www.dbreunig.com/2025/06/22/how-contexts-fail-and-how-to-fix-them.html)
- Context confusion: on the Berkeley Function-Calling Leaderboard, every model did worse with more than one tool. A quantised Llama 3.1 8B failed with 46 tools but succeeded with 19, despite fitting in a 16k window. — [dbreunig.com](https://www.dbreunig.com/2025/06/22/how-contexts-fail-and-how-to-fix-them.html)
- Context clash: Microsoft/Salesforce "sharded" multi-turn prompts lowered performance by an average of 39%. o3 fell from 98.1 to 64.1. Once a model takes a wrong turn it "get[s] lost and do[es] not recover". — [dbreunig.com](https://www.dbreunig.com/2025/06/22/how-contexts-fail-and-how-to-fix-them.html)

**Chroma, "Context Rot" (Hong, Troynikov, Huber, Jul 14, 2025)**
- 18 LLMs tested, including GPT-4.1, Claude 4, Gemini 2.5 and Qwen3. Models "do not use their context uniformly". Performance becomes less reliable as input grows, even on simple tasks. — [Chroma](https://www.trychroma.com/research/context-rot)
- On LongMemEval (306 prompts), focused prompts of about 300 tokens scored significantly higher than full prompts of about 113k tokens for every model. — [Chroma](https://www.trychroma.com/research/context-rot)
- A single distractor reduces accuracy and four reduce it further. Low needle-question similarity degrades faster with length. Shuffled haystacks beat coherent ones across all 18 models, which the authors found counterintuitive. — [Chroma](https://www.trychroma.com/research/context-rot)

**Liu et al., "Lost in the Middle" (arXiv 2307.03172, TACL 2023)**
- Performance is highest when relevant information is at the beginning or end of the input and drops significantly when it is in the middle, including for explicitly long-context models. Tasks: multi-document QA and key-value retrieval. — [arXiv](https://arxiv.org/abs/2307.03172)

### Inferences
- The current design resends the full history uncached every loop. That is the worst case on two axes: cost (no cache discount on the roughly 100:1 input-dominated token mix) and quality (context rot and distraction as SQL row dumps pile up).
- For SQL and document agents, the "restorable compression" pattern fits directly. Keep the SQL text, row count, column schema and a result handle (for example a temp table or S3 key) in context, and drop the raw rows once the model has used them.
- Put the plan or todo recitation and the latest tool result at the end of the context, which the U-shaped attention evidence favours. Never put dynamic values such as timestamps, user IDs or run IDs at the top of the system prompt.

### Gaps
- I did not fetch LangChain's own blog posts ("Context Engineering for Agents", "The rise of context engineering"). The four failure modes above come from Breunig's post, which LangChain's posts are widely reported to adopt, but I did not verify that here.
- I found no controlled quantitative study isolating the effect of todo-list recitation. The evidence is practitioner reports from Manus and Anthropic.

## 2. Compaction and memory (Claude Code compact, Anthropic context editing / tool-result clearing / memory tool, OpenAI Agents SDK sessions)

### Takeaway
Use the cheapest technique first. Clearing old tool results server-side (Anthropic `clear_tool_uses_20250919`, available on Bedrock in beta) removes most of the bloat in a tool-heavy loop without a summarisation call. Use LLM summarisation (server-side compaction `compact_20260112`, or a client summariser) for long conversations, triggered near a token threshold of about 100k by default. Keep the last N tool interactions verbatim, plus decisions, identifiers, errors and the next step. Because every clear or compaction invalidates the cache, apply it in large batches.

### Cited Findings
- Anthropic context editing, beta header `context-management-2025-06-27`. Edits are applied server-side before the prompt reaches Claude, and the client keeps the full history. — [Claude docs: context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- Available in beta on the Claude API, Claude Platform on AWS, Amazon Bedrock, Amazon Bedrock (InvokeModel), Google Cloud and Microsoft Foundry. Supported on Opus 4.5+, Sonnet 4.5+, Haiku 4.5+ and the Fable/Mythos models. — [Claude docs: context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- `clear_tool_uses_20250919` clears the oldest tool results first and leaves placeholders. It is configured as follows. — [Claude docs: context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
  - `trigger`: defaults to 100,000 input tokens; can also be a count of tool uses.
  - `keep`: defaults to the last 3 tool use/result pairs.
  - `clear_at_least`: a minimum number of tokens to clear, so that clearing is worth the cache rewrite.
  - `exclude_tools`: tool names that are never cleared.
  - `clear_tool_inputs`: defaults to false.
- Example configuration: trigger at 30,000 input tokens, keep 3, clear_at_least 5,000. — [Claude docs: context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- `clear_thinking_20251015` manages thinking blocks from earlier turns. Opus 4.5+, Sonnet 4.6+ and Haiku 5.5+ keep all thinking turns by default; earlier models keep only the last turn. Keeping thinking preserves the cache, and clearing invalidates it at the clearing point. — [Claude docs: context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- Cache interaction: tool-result clearing invalidates cached prefixes when content is cleared, hence `clear_at_least`. — [Claude docs: context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- The response reports `context_management.applied_edits` (`cleared_tool_uses`, `cleared_input_tokens`). `count_tokens` returns token counts both before and after clearing. — [Claude docs: context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- Memory tool (`memory_20250818`) combined with clearing: as context nears the clearing threshold, Claude is warned to save important information to memory files before the tool results are cleared. — [Claude docs: context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- Anthropic now recommends server-side compaction (`compact_20260112` in `context_management`) over SDK client-side compaction. — [Claude docs: context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- The SDK client-side compaction it replaces is deprecated: it remains only in the TypeScript and Ruby `tool_runner` and was removed from the Python SDK in v1.0. It summed input, cache and output tokens, compacted when the total exceeded `context_token_threshold` (default 100,000), and could run on a cheaper summariser model. — [Claude docs: context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- Client-side compaction pitfalls: server-side tools can inflate the count via `cache_read_input_tokens` and trigger compaction early, and a pending tool_use is dropped if compaction fires mid-call. — [Claude docs: context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- Claude Code compaction: the agent continues with the summary plus the five most recently accessed files. Tune compaction prompts for recall first, then precision. — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Anthropic's multi-agent research system: once past 200,000 tokens the context is truncated, so the lead agent saves its plan to memory. Sub-agents write their outputs to external storage and pass lightweight references back. — [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system)
- OpenAI Agents SDK sessions (cookbook) compare two approaches. — [OpenAI cookbook](https://developers.openai.com/cookbook/examples/agents_sdk/session_memory)
  - Trimming keeps the last N user turns verbatim. It is deterministic, costs no extra calls and has weak long-range recall.
  - Summarising keeps the last N turns verbatim and compresses older turns. Recall is stronger, but it adds latency and cost and risks distortion, which the cookbook calls "context poisoning".
- The cookbook's example parameters. — [OpenAI cookbook](https://developers.openai.com/cookbook/examples/agents_sdk/session_memory)
  - `keep_last_n_turns=2`, `context_limit=4` (summarise when real user turns exceed 4).
  - Summariser `max_tokens=400`, tool outputs trimmed to 600 characters before summarising, summary target of 200 words or fewer.
  - A "turn" is a user message plus everything up to the next user message.
- What the cookbook's summaries keep: eight headings (environment, issue, steps tried and results, identifiers, timeline, tool performance insights, current status and blockers, next step). Rules: never invent facts, quote error codes exactly, mark UNVERIFIED items, flag superseded information, run a contradiction check. — [OpenAI cookbook](https://developers.openai.com/cookbook/examples/agents_sdk/session_memory)
- Cognition recommends a dedicated compression model that keeps "key details, events, and decisions". — [Cognition](https://cognition.com/blog/dont-build-multi-agents)

### Inferences
- For this loop, the first step is tool-result clearing: keep the last 3 SQL/doc results and replace older ones with a one-line stub (query, row count, handle). This can be done server-side via `additionalModelRequestFields` on Bedrock (beta) or client-side in the gateway. LLM summarisation can wait until conversations routinely exceed tens of thousands of tokens.
- Set the trigger well below the window, for example 30-60k, given the 32k degradation onset seen in the Databricks/Llama data and the Chroma findings. Combine it with `clear_at_least` so each clear saves enough to repay one cache write (1.25x the cleared prefix at the 5-minute TTL).
- Summaries for SQL work should keep table and column names verbatim, the final SQL that worked, numeric results, error messages and user constraints.

### Gaps
- The context-editing page I fetched was truncated at 100k of 107k characters. I could not confirm Anthropic's published benchmark numbers for context editing and the memory tool (widely quoted as a 39% improvement and an 84% token reduction on an internal agentic-search eval). Treat those as unverified.
- I did not fetch the details of the `compact_20260112` server-side compaction parameters, such as its trigger default and summary instructions.
- I did not confirm whether LiteLLM passes `context_management` through to Bedrock Converse via `additionalModelRequestFields`.

## 3. Tool results: token-efficient formats, pagination, handles, truncation hints, teaching errors

### Takeaway
Design tool output for the model. Return only high-signal fields and readable names instead of UUIDs. Offer a `response_format` of concise or detailed, paginate, filter and truncate with sensible defaults and a hint on how to fetch more, and give errors that state the fix. Where intermediate data is large, let code filter it before it reaches the model, or return a summary plus a handle instead of raw rows.

### Cited Findings
- Anthropic, "Writing effective tools for agents" (Sep 11, 2025):
  - Namespace tools by service and resource (`asana_search`, `asana_projects_search`), and test prefix versus suffix naming because results vary by model. — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
  - Return high-signal fields (`name`, `image_url`, `file_type`) and drop `uuid` and `mime_type`. Resolving UUIDs to natural-language names improved retrieval precision by reducing hallucinations. — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
  - A `response_format` enum (`DETAILED`/`CONCISE`) cut a Slack response from 206 tokens to 72, about one-third. — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
  - Use pagination, range selection, filtering and truncation with sensible defaults. Claude Code caps tool responses at 25,000 tokens by default. Steer agents towards many small targeted searches over one broad search. — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
  - Errors should state specific, actionable fixes, not opaque codes or tracebacks. — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
  - Consolidate tools: replace `list_users` + `list_events` + `create_event` with a single `schedule_event`, and `read_logs` with a `search_logs` that returns only the relevant lines. — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
  - Write descriptions as you would for a new hire and use unambiguous parameter names (`user_id` rather than `user`). Small description refinements brought Claude Sonnet 3.5 to state of the art on SWE-bench Verified. — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
  - Evaluate with realistic multi-call tasks and a held-out test set. Track accuracy, runtime, number of calls, token consumption and tool errors. — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
- Programmatic Tool Calling: Claude writes code that orchestrates tools in a sandbox, so intermediate results never enter the context. — [Anthropic advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
  - Tokens on complex research tasks fell from 43,588 to 27,297 (37%).
  - In one budget example, 200KB of raw data was reduced to 1KB of results reaching Claude.
  - A workflow with 20+ tool calls avoids 19+ inference passes.
  - Accuracy rose on internal knowledge retrieval (25.6% to 28.5%) and on GIA (46.5% to 51.2%).
  - Recommended for large datasets where only summaries are needed, 3+ dependent calls, or filtering before Claude sees the data.
- Tool Use Examples (example calls inside tool definitions) raised accuracy on complex parameter handling from 72% to 90% in internal testing. — [Anthropic advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
- Manus: keep error traces in context so the model learns from them, and use restorable compression (keep the URL or path, drop the body). — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- Anthropic multi-agent research: sub-agents store outputs externally and return lightweight references, which avoids a "game of telephone". — [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system)

### Inferences
- A SQL tool should return the following by default instead of full result sets:
  - Column names and types once.
  - The first N rows, for example 20-50, in a compact format such as CSV or TSV rather than JSON objects that repeat keys on every row.
  - The total row count, a `truncated: true` flag, a `result_id` handle, and a hint such as "call sql_fetch(result_id, offset) or add WHERE/LIMIT/aggregate".
- Document tools should return the matching passages with their location, not whole documents.
- Turn SQL errors into hints that teach the model: "column X not found; similar columns: X_id, X_name"; "query exceeded 10k rows; add an aggregate or LIMIT".
- A per-tool token cap, analogous to Claude Code's 25k default but probably much lower for a SQL agent (for example 2-5k), bounds the worst-case growth of history.

### Gaps
- I found no rigorous public benchmark comparing CSV, Markdown and JSON row formats for token count and accuracy. The gain from dropping repeated JSON keys is plausible but unmeasured here.
- I did not verify the state of Anthropic's old "token-efficient tool use" beta (reduced output tokens for tool calls on Claude 3.7) or whether it is now built into newer models.
- Programmatic Tool Calling and the tool search tool are Anthropic API features. I did not confirm their availability through Bedrock Converse.

## 4. Prompt caching on Bedrock (cachePoint placement, minimums, TTL, savings, what breaks caching)

### Takeaway
On Bedrock, Claude is cached only when the request explicitly asks for it. Either place `cachePoint` blocks in `tools`, `system` and/or `messages` (up to 4), or use the top-level `cache_control` automatic mode via `additionalModelRequestFields`. The cumulative prefix must meet a model minimum (512 tokens for Claude 5.x, up to 4,096 for Opus 4.5/4.6 and Haiku 4.5). The TTL is 5 minutes, or 1 hour on supported Claude models, and refreshes on each hit. First-party pricing:

| Operation | Cost relative to base input |
|---|---|
| 5-minute write | 1.25x |
| 1-hour write | 2x |
| Read (default) | 0.1x |
| Read (Opus 5.5 / Sonnet 5.5) | 0.05x |

Any change earlier in the order tools → system → messages invalidates everything after it.

### Cited Findings
**How it works on Bedrock**
- Bedrock has two caching types. Implicit caching is automatic and best-effort. Explicit caching uses cache checkpoints. "Anthropic models that support prompt caching on Amazon Bedrock support Explicit Prompt Caching. Requests without cache controls aren't cached." — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
- Two ways to request caching for Claude. — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
  - Explicit `cachePoint` blocks (Converse) or `cache_control` (InvokeModel).
  - Automatic caching: a top-level `cache_control: {type: "ephemeral"}`, passed in Converse via `additionalModelRequestFields`. Claude places the checkpoint on the last cacheable block and moves it forward as the conversation grows. This uses one of the 4 slots.
  - Automatic caching is supported on Haiku 4.5, Sonnet 4.6, Opus 4.7/4.8, Opus 5/5.5, Sonnet 5/5.5 and Haiku 5.5. Other models return a ValidationException.

**Minimums, checkpoint limits and TTLs (Bedrock table)**
- Claude 5.x (Haiku 5.5, Sonnet 5.5, Opus 5.5, Opus 5, Fable/Mythos): 512 tokens. — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
- Opus 4.8, Sonnet 5 and Sonnet 4.6: 1,024 tokens. — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
- Opus 4.7, 4.6, 4.5 and Haiku 4.5: 4,096 tokens. — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
- Every listed Claude model allows 4 checkpoints, supports 5-minute and 1-hour TTLs, and accepts checkpoints in `system`, `messages` and `tools`. — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
- Amazon Nova: about 1K minimum, 4 checkpoints, 5-minute TTL only. Checkpoints go in `system` and `messages` only, not `tools`, and caching is capped at 20K tokens. — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
- OpenAI GPT-5.6+ and GPT-6 on Bedrock: 1,024 minimum, a 30-minute TTL, and writes at 1.25x. "Converse doesn't support explicit caching for this model"; use `prompt_cache_breakpoint` via the Responses API, Chat Completions or InvokeModel instead. GPT-5.5 and earlier get implicit caching only, with no write fee. Cached tokens do not count against TPM quotas. — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
- The minimum is cumulative across tools + system + messages before each checkpoint, and there is no minimum between checkpoints. A checkpoint placed below the minimum still succeeds but is silently not cached. — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)

**What breaks caching**
- Checkpoints are processed in the order `tools` → `system` → `messages`. "Changing content in an earlier section invalidates the cache for later sections (for example, modifying `tools` invalidates the `system` and `messages` caches)." — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
- Lookback: a checkpoint checks only about 20 content blocks back for an existing cache entry. In long tool loops, add intermediate checkpoints or move the checkpoint forward. — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html); [Claude docs: prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Anthropic's invalidation table:
  - Changing tool definitions invalidates everything.
  - Toggling web search or citations, or changing the speed setting, invalidates system and messages.
  - Changing `tool_choice` or adding/removing images invalidates messages.
  - Changing thinking parameters or `output_config.effort` invalidates messages, and possibly more depending on the model. — [Claude docs: prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Changing `budget_tokens` between requests invalidates message-level breakpoints. Anthropic's example on Sonnet 4.6: changing the budget from 4,000 to 8,000 forced a full re-write of 1,370 cached tokens. — [Claude docs: extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- Matching requires a 100% identical prefix. Putting a breakpoint on a block containing timestamps or per-request content means no hits and a write on every request. Tool-use JSON key ordering must be stable. — [Claude docs: prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

**Pricing and TTL behaviour**
- First-party multipliers: 5-minute write 1.25x, 1-hour write 2x, read 0.1x by default. Reads are 0.05x for Opus 5.5 and Sonnet 5.5, and 0.025x for Fable 5.1 and Mythos 5.1. The multipliers stack with batch and long-context pricing. — [Claude docs: prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- TTL resets on each hit. On the Anthropic API it is measured from the start of the request, so a 4-minute stream leaves about 1 minute for reuse. — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html); [Claude docs: prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Use the 1-hour TTL when calls are spaced more than 5 minutes apart but less than an hour, such as slow side-agents or users who pause. "Cache hits are not deducted against your rate limit." When mixing TTLs, 1-hour entries must come before 5-minute entries. — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
- In Converse, the 1-hour TTL is `"cachePoint": {"type": "default", "ttl": "1h"}`. Sending `ttl` to a model that only supports 5 minutes can raise a ValidationException. — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
- Concurrency: a cache entry becomes available only after the first response starts. Send parallel requests only after the first has begun responding. — [Claude docs: prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- On Bedrock, an entry lives on the server that processed the request. Requests served elsewhere, such as another Region, or sent before an identical request has started its response, write a new entry instead. Cross-region inference "may lead to increased cache writes" at times of high demand. — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
- Pre-warming with `max_tokens: 0` writes the cache without generating output. It cannot be combined with manual extended thinking. — [Claude docs: prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching); [Claude docs: extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)

**Observability**
- The Converse response returns `cacheReadInputTokens`, `cacheWriteInputTokens` and `cacheDetails` (the TTL). `inputTokens` excludes cached tokens, so total input = `inputTokens + cacheReadInputTokens + cacheWriteInputTokens`. — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)

**Bedrock versus the first-party API**
- Bedrock prompt caching works only on on-demand endpoints, not batch inference. — [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
- Bedrock and Google-managed endpoints isolate caches at organisation level only. The Claude API, Claude Platform on AWS and Foundry also isolate by workspace. — [Claude docs: prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

**Through the LiteLLM gateway**
- LiteLLM `cache_control_injection_points` originally injected cache points only into messages, by role or index, so tool definitions were reprocessed on every request. — [LiteLLM issue #21969](https://github.com/BerriAI/litellm/issues/21969)
- Issue #21969, a request for a `tool_config` location on Bedrock Converse, was closed as completed on 2026-03-21. The linked commits are on forks and I could not see a merged PR. A related issue (#12695) reports assistant and tool messages dropping cache points. — [LiteLLM issue #21969](https://github.com/BerriAI/litellm/issues/21969)
- LiteLLM's docs list `bedrock/converse` among the providers supported for prompt caching. — [LiteLLM docs](https://docs.litellm.ai/docs/completion/prompt_caching.md)

**Vendor savings claims**
- Manus quotes 10x cheaper cached input on Sonnet ($0.30 versus $3/MTok). — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- AWS has marketed prompt caching as cutting costs by up to 90%; see the AWS launch post in the sources below. I did not extract the exact latency figure.

### Inferences
- Recommended layout for this loop on Claude via Converse:
  1. `cachePoint` at the end of `tools`. The tool list must be static and deterministically serialised.
  2. `cachePoint` at the end of `system`, with no timestamps or user-specific text. Put per-user or per-run context in a later message.
  3. A rolling `cachePoint` on the last message, or the top-level automatic `cache_control`, so each iteration reads the entire previous history from cache and writes only the new delta.
  4. Optionally a mid-history checkpoint when a turn adds more than about 20 blocks (the lookback window).
- Rough economics with a prefix P that grows by d per loop. Uncached, each call costs about P x 1.0. Cached, each call costs about P x 0.1 (or 0.05 on 5.5-tier models) plus d x 1.25. For a 30k prefix and a 2k delta, that is about 3k + 2.5k = 5.5k-equivalent instead of 30k, roughly 80% less input cost per loop. Latency also drops (TTFT) because the prefix is not re-prefilled. This is an inference from the multipliers above; confirm against Bedrock's per-model price list.
- Verify that LiteLLM actually emits `cachePoint` for tools, system and messages to Bedrock by logging the outgoing payload and checking that `cacheReadInputTokens > 0` from the second iteration. Given issues #21969 and #12695, do not assume it does.
- Keep `tool_choice`, thinking or effort settings, and images stable within a run, because changing any of them invalidates the message cache. Context clearing and compaction should also be batched (see section 2).

### Gaps
- I did not fetch Bedrock's per-model price list, so I could not confirm that Bedrock uses the same multipliers as the first-party API (1.25x/2x/0.1x/0.05x) for every Claude model.
- I did not fetch the AWS launch blog with the exact "up to 85% latency" claim (AWS's prompt-caching preview post is [here](https://aws.amazon.com/blogs/aws/reduce-costs-and-latency-with-amazon-bedrock-intelligent-prompt-routing-and-prompt-caching-preview/)), so the latency percentage is unverified in these notes.
- I did not verify whether LiteLLM translates OpenAI-style `cache_control` on system or tool content into Converse `cachePoint` blocks in the currently deployed version.

## 5. Tool selection at scale (dynamic tool loading / tool search; number of tools vs accuracy)

### Takeaway
Tool definitions can consume tens of thousands of tokens, and accuracy falls as tool count grows. Anthropic's tool search with `defer_loading` cut definition tokens by about 85% and raised MCP-eval accuracy (Opus 4: 49% to 74%). There is a tension with caching. Swapping tools in and out mid-run breaks the cache, so prefer a static tool list, mask tools as Manus does, or load tools through a search tool, which appends to the context rather than editing the prefix.

### Cited Findings
- Example tool-definition footprint: GitHub 35 tools (about 26K tokens), Slack 11 (about 21K), Sentry, Grafana and Splunk, for 58 tools and about 55K tokens before any conversation. Jira alone is about 17K tokens. Anthropic has seen definitions consume 134K tokens before optimisation. — [Anthropic advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
- Tool Search Tool: about 77K tokens consumed up front with the traditional approach versus about 8.7K with tool search, an 85% reduction. Accuracy on MCP evals with `defer_loading`: Opus 4 49% to 74%, Opus 4.5 79.5% to 88.1%. Keep critical, frequently used tools as `defer_loading: false`. — [Anthropic advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
- When to use tool search: more than 10K tokens of definitions, 10+ tools, multiple MCP servers, or tool-selection errors. It is less useful under 10 tools or with compact definitions. The features launched Nov 24, 2025 in beta (`advanced-tool-use-2025-11-20` header). — [Anthropic advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use); beta header per [search summary of third-party guides](https://dev.to/digitalapplied/claude-advanced-tool-use-mcp-optimization-guide-5589)
- Accuracy versus tool count: every model on BFCL did worse with more than one tool, and Llama 3.1 8B failed with 46 tools but succeeded with 19. — [dbreunig.com](https://www.dbreunig.com/2025/06/22/how-contexts-fail-and-how-to-fix-them.html)
- Manus: do not add or remove tools mid-iteration because it breaks the KV cache. Mask instead, using prefixes to group tools. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- Changing tool definitions invalidates the tools, system and messages caches. — [Claude docs: prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching); [AWS Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
- Anthropic advises consolidating overlapping tools and namespacing them. — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)

### Inferences
- A SQL and document agent probably has fewer than 10-15 tools. At that size, a compact, static, cached tool list beats dynamic loading. Consolidate tools (for example one `sql_query` with `response_format` and pagination rather than several list/describe/sample tools) and namespace them (`sql_*`, `doc_*`).
- If the tool catalogue grows, for example per-database or per-connector tools, use a single search or "load tools" meta-tool that returns definitions into the message stream, or a router that picks a tool subset once per task before the loop starts. Do not change `toolConfig` on every iteration.

### Gaps
- I did not verify whether Bedrock Converse supports Anthropic's tool search tool or `defer_loading`.
- The "RAG-MCP" or "tool loadout" accuracy numbers (for example roughly 3x tool-selection accuracy) were not verified from primary sources.

## 6. Parallel tool calls, latency and streaming

### Takeaway
Latency in agent loops is dominated by the number of sequential model round-trips and by prefill of long prompts. The main levers are:
- Parallel tool calls within one turn.
- Collapsing dependent calls into code (programmatic tool calling, which saves up to 19+ inference passes in a 20-call workflow).
- Prompt caching, which lowers TTFT.
- Smaller contexts.

Streaming improves perceived latency but not total cost.

### Cited Findings
- Anthropic's research system runs 3-5 sub-agents in parallel, each using 3+ tools in parallel. Parallelisation cut research time by up to 90% for complex queries. — [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system)
- The cost of that parallelism: agents use about 4x the tokens of chat, and multi-agent systems about 15x. On BrowseComp, token usage explained 80% of performance variance, and tokens, tool-call count and model choice together explained 95%. — [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system)
- Programmatic tool calling removes 19+ inference passes in a 20+ call workflow. — [Anthropic advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
- Cache hits reduce time-to-first-token, especially for long prompts; the Anthropic docs give no percentage. Parallel requests only hit the cache once the first response has started. — [Claude docs: prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Re-prefilling long inputs is a cost and latency problem even with large windows. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- Cognition warns that parallel sub-agents make conflicting implicit decisions, and recommends single-threaded agents for coherent tasks. — [Cognition](https://cognition.com/blog/dont-build-multi-agents)
- For thinking budgets above 32k, Anthropic recommends batch processing to avoid timeouts. Streaming thinking and `usage` details arrive on the final `message_delta`. — [Claude docs: extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)

### Inferences
- In the loop, execute all `toolUse` blocks returned in a single assistant turn concurrently (for example several independent SQL queries), and return all `toolResult` blocks in one user message. This also keeps the context compact.
- Prefer independent read-only parallelism (several SQL lookups) over parallel decision-making sub-agents, which is where Cognition's warnings apply.
- Use ConverseStream to the UI for perceived latency. Make sure the gateway does not buffer the stream, and that usage and cache fields are read from the final metadata event.

### Gaps
- I found no Bedrock-specific primary numbers on parallel tool-call latency, on the TTFT reduction from caching, or on Bedrock "latency-optimized inference".
- I did not fetch Anthropic's tool-use docs on `disable_parallel_tool_use` or the parallel tool-use prompting guidance.

## 7. Model routing and cascades (RouteLLM, FrugalGPT, vendor guidance)

### Takeaway
Routing easy queries or sub-tasks to cheaper models is well evidenced for single-turn queries:
- RouteLLM: about 2x cheaper (over 85% cheaper on MT-Bench in the paper's framing) at 95% of GPT-4 quality.
- FrugalGPT: up to 98% cheaper while matching GPT-4.
- Bedrock Intelligent Prompt Routing: "up to 30%"; AWS internal tests 48-63%.

In agent loops, the safer pattern is a strong model for planning and orchestration, and cheap models for bounded sub-tasks such as summarisation, compaction and extraction. Anthropic found that a model upgrade beat doubling the token budget.

### Cited Findings
- RouteLLM (Ong et al., arXiv 2406.18665, LMSYS/Berkeley, 2024): routers trained on Chatbot Arena preference data reduce costs "by over 85% on MT Bench, 45% on MMLU, and 35% on GSM8K" compared with using only GPT-4, while keeping 95% of GPT-4 performance. — [LMSYS blog](https://lmsys.org/blog/2024-07-01-routellm/); [arXiv](https://arxiv.org/html/2406.18665v3)
- A more conservative RouteLLM framing: the matrix-factorisation router reaches 95% of GPT-4 performance with 26% GPT-4 calls, about 48% cheaper than a random baseline. The setup was GPT-4 Turbo as the strong model and Mixtral 8x7B as the weak one. — [LMSYS blog](https://lmsys.org/blog/2024-07-01-routellm/)
- FrugalGPT (Chen, Zaharia, Zou, arXiv 2305.05176, 2023): an LLM cascade that learns which models to call per query "can match the performance of the best individual LLM (e.g. GPT-4) with up to 98% cost reduction or improve the accuracy over GPT-4 by 4% with the same cost". 98% is a ceiling, not a typical result. — [arXiv](https://arxiv.org/pdf/2305.05176)
- Amazon Bedrock Intelligent Prompt Routing: the product page says it can reduce costs by up to 30% without compromising accuracy. — [AWS product page](https://aws.amazon.com/bedrock/intelligent-prompt-routing)
- AWS's GA blog reports internal results (2024-era models; "results may vary"). — [AWS ML blog](https://aws.amazon.com/blogs/machine-learning/use-amazon-bedrock-intelligent-prompt-routing-for-cost-and-latency-benefits/)
  - Claude 3 Haiku with Claude 3.5 Sonnet v2: 48% savings at Sonnet-level quality.
  - Claude 3.5 Haiku with Claude 3.5 Sonnet v2: 56% savings.
  - RAG datasets: 63.6% average savings.
- Anthropic: an Opus 4 lead with Sonnet 4 sub-agents beat single-agent Opus 4 by 90.2% on an internal research eval. Upgrading to Sonnet 4 gave a larger gain than doubling the Sonnet 3.7 token budget. — [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system)
- The Anthropic SDK compaction exposed a `model` option for using a cheaper summariser, and the OpenAI cookbook's summariser runs as a separate small call with max 400 tokens. These show vendor-endorsed use of cheaper or secondary models for compaction. — [Claude docs: context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing); [OpenAI cookbook](https://developers.openai.com/cookbook/examples/agents_sdk/session_memory)
- Cognition suggests a fine-tuned smaller model for history compression. — [Cognition](https://cognition.com/blog/dont-build-multi-agents)

### Inferences
- The cheap-model jobs in this system are: summarising or compacting old history, condensing long document passages before they enter the main context, classifying intent (simple lookup versus multi-step analysis), and formatting the final answer.
- Keep the strong model for planning, SQL generation over unfamiliar schemas, and error recovery.
- Switching models mid-conversation discards that model's cache, because caches are per model. Route per task or sub-agent, not per loop iteration.
- The routing evidence (RouteLLM, FrugalGPT, Bedrock IPR) comes mostly from single-turn QA. Gains in multi-step tool loops are unproven and need the product's own eval set.

### Gaps
- I found no primary study of routing within multi-turn tool-using agent loops, such as per-step cheap or strong model switching, with measured cost and quality.
- I did not verify whether Bedrock Intelligent Prompt Routing supports current Claude 4.x/5.x models, tool use, or Converse with caching.

## 8. Output token limits, long outputs and thinking budgets

### Takeaway
`max_tokens` is a hard ceiling on output, including thinking. You are billed for tokens actually generated, not for the cap, so the 4,096 setting limits worst-case cost and latency per call. It can, however, truncate large tool-call arguments or final answers (detect `stopReason: max_tokens` and continue). Manual extended thinking (`budget_tokens`, minimum 1,024, must be less than `max_tokens`) is deprecated. Claude 4.7+ uses adaptive thinking with an `effort` setting. Thinking tokens are billed as output, and changing thinking settings mid-conversation invalidates the cache.

### Cited Findings
- `budget_tokens` must be at least 1,024 and less than `max_tokens`. The exception is interleaved thinking, where the budget spans all thinking blocks in a turn. Thinking tokens count towards `max_tokens`, and "`max_tokens` remains the hard ceiling on total output". The budget is a target, not a strict cap. — [Claude docs: extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- Tuning: start near 1,024 for simple tasks and increase gradually. Start at 16,000+ for complex tasks. Returns diminish while latency grows. Above 32k, use batch processing to avoid timeouts. — [Claude docs: extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- Monitor `usage.output_tokens_details.thinking_tokens`, which reports how many billed output tokens were reasoning. — [Claude docs: extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- Manual extended thinking is deprecated. Claude 4.7 and later return a 400 error for `type: "enabled"`. Migrate to `thinking: {type: "adaptive"}` plus `output_config: {effort: ...}`. Opus 5.5 and Haiku 5.5 default to medium effort, and other models that support effort default to high. At lower effort, adaptive thinking may skip thinking on easy inputs. — [Claude docs: extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- Thinking-block preservation: Opus 4.5 and models numbered 4.6+ keep earlier turns' thinking blocks in context and bill them as input. Sonnet 4.5, Haiku 4.5 and earlier models strip them. — [Claude docs: extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- Changing `budget_tokens`, the thinking mode or `effort` between requests invalidates message-level cache breakpoints, so hold them stable for a cached conversation. — [Claude docs: extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking); [Claude docs: prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Interleaved thinking (reasoning between tool calls) is automatic with adaptive thinking. Bedrock accepts the `interleaved-thinking-2025-05-14` header and ignores it where unsupported. — [Claude docs: extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- Old thinking blocks can be trimmed with `clear_thinking_20251015`, which trades cache invalidation for fewer input tokens. — [Claude docs: context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- Manus's roughly 100:1 input:output ratio means input or prefill tokens, not output, dominate agent-loop cost. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)

### Inferences
- Lowering `max_tokens` from 4,096 will not cut cost much in a tool loop, because output is a small share and you pay for what is generated. The bigger risk is the opposite: if thinking or large SQL or document tool arguments are enabled, 4,096 may truncate output mid-tool-call.
- Recommended: handle `stopReason == "max_tokens"` with a continuation or retry path. Consider per-step caps, for example a small cap for tool-selection steps and a larger cap for the final report. If you use thinking, choose an `effort` level per run and keep it fixed, since changing it invalidates the cache.
- When adaptive thinking is on, older thinking blocks re-enter the context as input on Opus 4.5+ and 4.6+ models. Account for this in context budgets, or use `clear_thinking` together with the batching guidance in section 2.

### Gaps
- I did not fetch Anthropic or Bedrock pricing pages, so the output-to-input price ratio (commonly 5x for Claude) is not cited here.
- I did not find Converse-specific guidance on a continuation pattern for `max_tokens` truncation, such as prefilling the partial assistant message. Note that prefill is restricted on some newer models; I did not verify this.
- I found no primary measurements of the cost and quality curve of adaptive-thinking effort levels in tool loops.
