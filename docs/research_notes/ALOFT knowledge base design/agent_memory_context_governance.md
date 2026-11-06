# Agent Memory Architectures, Context Engineering ("Harness Engineering") and Knowledge Governance for LLM Agents (2024 – late 2026)

Research date: 24 Oct 2026. Scope: how production agent systems separate working/session context, episodic memory, semantic/organisational knowledge and procedural knowledge (skills); how they assemble context windows; and how they keep injected knowledge safe and trustworthy. Target reader: an AI engineer designing the memory + knowledge harness for an enterprise analytics agent platform.

Source quality legend used below: **[primary]** = vendor engineering blog / official docs / peer-reviewed or arXiv paper by the system's authors; **[vendor-competitive]** = vendor writing about a competitor; **[preprint-2026]** = recent arXiv preprint, abstract-level reading only, not yet widely replicated.

---

## 1. Context engineering: how production agents assemble the context window

### Takeaway
By late 2025 the field (Anthropic, LangChain, Manus, OpenAI) converged on treating context as a finite "attention budget": keep a small, stable, always-loaded core (system prompt, tool definitions, skill/memory *metadata*), load everything else just-in-time via tools using lightweight references, and manage long horizons with three levers — compaction, structured note-taking to external storage, and sub-agent isolation. Chroma's "context rot" study shows that performance degrades with input length even on trivial tasks, so "just use a bigger window" is not a substitute for curation.

### Cited Findings

**Anthropic — "Effective context engineering for AI agents" (29 Sep 2025) [primary]**
- Defines context engineering as "the set of strategies for curating and maintaining the optimal set of tokens (information) during LLM inference", the "natural progression of prompt engineering"; curation happens "each time we decide what to pass to the model" — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Guiding principle: "find the smallest possible set of high-signal tokens that maximize the likelihood of some desired outcome." Context is "a finite resource with diminishing marginal returns" — LLMs have an "attention budget"; n² pairwise attention and training on shorter sequences produce "a performance gradient rather than a hard cliff" — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Simple working definition of agents: "LLMs autonomously using tools in a loop" (refines the Dec 2024 "Building effective agents" workflow-vs-agent distinction) — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- System prompts should sit at the "right altitude" — between brittle hard-coded if/else logic and vague guidance; organise into sections with XML tags / Markdown headers; start minimal on the best model and add instructions based on observed failures — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- "Bloated tool sets" with ambiguous decision points are among the most common failures: "If a human engineer can't definitively say which tool should be used… an AI agent can't be expected to do better." Prefer "diverse, canonical examples" over a laundry list of edge-case rules — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- **Just-in-time retrieval**: agents "maintain lightweight identifiers (file paths, stored queries, web links, etc.)" and load data at runtime via tools; Claude Code does data analysis over large databases by writing targeted queries and using `head`/`tail` "without ever loading the full data objects into context." Metadata (folder hierarchy, names, timestamps) is itself signal — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- **Hybrid strategy**: Claude Code drops `CLAUDE.md` into context up front, and uses glob/grep for just-in-time retrieval, "bypassing the issues of stale indexing." Anthropic suggests hybrid may suit "less dynamic content, such as legal or finance work" — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- **Compaction**: summarise a near-full conversation and restart with the summary; Claude Code keeps "architectural decisions, unresolved bugs, and implementation details" plus "the five most recently accessed files." Tune the compaction prompt first for recall, then precision. "Tool result clearing" is described as "one of the safest lightest touch forms of compaction" and shipped on the Claude Developer Platform — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- **Structured note-taking / agentic memory**: agent writes notes (to-do list, `NOTES.md`) outside the window and re-reads them; the Claude-plays-Pokémon example keeps tallies across thousands of steps and resumes after context resets. A file-based **memory tool** was released in public beta with Sonnet 4.5 — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- **Sub-agents**: each sub-agent may use "tens of thousands of tokens or more" but returns "a condensed, distilled summary… (often 1,000-2,000 tokens)". Selection heuristic: compaction for back-and-forth conversational flow; note-taking for iterative work with milestones; multi-agent for parallelisable research/analysis — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

**Anthropic — Agent Skills / progressive disclosure (16 Oct 2025; open standard announced 18 Dec 2025) [primary]**
- A skill is a directory with a `SKILL.md` whose YAML frontmatter (`name`, `description`) is pre-loaded into the system prompt at startup (level 1); the body is read only if relevant (level 2); bundled files (e.g., `forms.md`, `reference.md`) are read only when needed (level 3+). Because of this, "the amount of context that can be bundled into a skill is effectively unbounded." — [Anthropic](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- Skills can include scripts that run deterministically without loading code or data into context (e.g., PDF form-field extraction) — [Anthropic](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- Framed explicitly as packaging "procedural knowledge" ("like putting together an onboarding guide for a new hire"); authoring advice: start from evaluation gaps, split mutually exclusive content into separate files, watch the `name`/`description` because they drive triggering — [Anthropic](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- Security: "malicious skills may introduce vulnerabilities… or direct Claude to exfiltrate data"; install only from trusted sources and audit bundled code and any instructions to contact external network sources — [Anthropic](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- Agent Skills published as an open standard for cross-platform portability (18 Dec 2025 update) — [Anthropic](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)

**Manus — "Context Engineering for AI Agents: Lessons from Building Manus" (Yichao 'Peak' Ji, 18 Jul 2025) [primary]**
- "KV-cache hit rate is the single most important metric for a production-stage AI agent." Manus' average input:output token ratio is ~100:1; with Claude Sonnet cached input costs $0.30/MTok vs $3/MTok uncached (10×) — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- Cache practices: stable prompt prefix (no second-precision timestamps at the top), append-only context, deterministic JSON serialisation (key ordering), explicit cache breakpoints — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- **"Mask, don't remove"**: Manus tried RAG-style dynamic tool loading but found changing tool definitions mid-loop invalidates the cache and confuses the model when history refers to now-missing tools; instead it masks token logits via a state machine and uses consistent tool-name prefixes (`browser_`, `shell_`) — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus). (Note tension with LangChain's report of RAG over tool descriptions improving selection ~3× — [LangChain](https://blog.langchain.com/context-engineering-for-agents/).)
- **File system as context**: "unlimited in size, persistent by nature, and directly operable by the agent"; compression must be **restorable** — drop a page's content but keep its URL, drop a document's content but keep its path — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- **Recitation**: a typical Manus task takes ~50 tool calls; constantly rewriting `todo.md` pushes the plan into recent attention to counter lost-in-the-middle drift — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- **Keep errors in context** (failed actions and stack traces shift the model away from repeating them) and **avoid self-few-shotting** (uniform repeated action/observation pairs cause drift; add structured variation) — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)

**LangChain — "Context Engineering" (2 Jul 2025) [primary]**
- Taxonomy: **write** (save outside window: scratchpads, long-term memories), **select** (pull in: scratchpad reads, memory retrieval, tool selection, RAG), **compress** (summarisation, trimming/pruning), **isolate** (multi-agent, sandboxes, state-schema fields hidden from the LLM) — [LangChain](https://blog.langchain.com/context-engineering-for-agents/)
- Context types: instructions (prompts, memories, few-shot, tool descriptions), knowledge (facts, memories), tools (feedback from tool calls). Cites Drew Breunig's failure modes: context poisoning, distraction, confusion, clash — [LangChain](https://blog.langchain.com/context-engineering-for-agents/)
- Reports Claude Code ran "auto-compact" after 95% of the window (as of Jul 2025); Anthropic's multi-agent researcher used up to 15× more tokens than chat; Windsurf: "embedding search becomes unreliable as a retrieval heuristic as the size of the codebase grows" so they combine grep/file search, knowledge-graph retrieval and re-ranking — [LangChain](https://blog.langchain.com/context-engineering-for-agents/)
- Memory selection failure example: ChatGPT injected Simon Willison's location from memory into an image request, making the context feel like it "no longer belongs to them" — [LangChain](https://blog.langchain.com/context-engineering-for-agents/)

**OpenAI — Agents SDK sessions and context-engineering cookbook [primary]**
- Agents SDK `Session`s automatically prepend stored history before each run and append all new items (user input, assistant output, tool calls) after; cannot be combined in the same run with server-side `conversation_id`/`previous_response_id` continuation — [OpenAI Agents SDK docs](https://openai.github.io/openai-agents-python/sessions/)
- Cookbook compares **trimming** (last-N turns: deterministic, zero latency, risk = context loss/"amnesia") vs **summarisation** (older turns → structured summary: retains long-range constraints, risk = "context distortion/poisoning", must log summary prompts/outputs for auditability). A "turn" = a user message plus everything until the next user message — [OpenAI Cookbook](https://developers.openai.com/cookbook/examples/agents_sdk/session_memory)
- SDK ships a `ToolOutputTrimmer` input filter: keeps the last `recent_turns` intact and replaces older bulky tool outputs above `max_output_chars` with previews — [OpenAI Agents SDK source](https://github.com/openai/openai-agents-python/blob/main/src/agents/extensions/tool_output_trimmer.py)

**Chroma — "Context Rot: How Increasing Input Tokens Impacts LLM Performance" (Hong et al., 14 Jul 2025) [primary]**
- Evaluated 18 LLMs (incl. GPT-4.1, Claude 4, Gemini 2.5, Qwen3); "model performance consistently degrades with increasing input length" even with task complexity held constant — [Chroma](https://research.trychroma.com/context-rot)
- Lower needle–question semantic similarity accelerates degradation; distractors have non-uniform impact that grows with length; surprisingly, logically coherent haystacks hurt more than shuffled ones — [Chroma](https://research.trychroma.com/context-rot)
- On LongMemEval, focused prompts (~300 tokens) vastly outperformed full prompts (~113k tokens) across all model families; thinking modes narrowed but did not close the gap — [Chroma](https://research.trychroma.com/context-rot)
- Under distractors, Claude models had the lowest hallucination rates (tending to abstain), GPT models the highest — [Chroma](https://research.trychroma.com/context-rot)

### Inferences
- For an analytics agent: keep a cache-stable prefix (system prompt + fixed tool set + skill/memory index), then append retrieved knowledge and tool results. Changing the tool set per turn is costly; prefer masking / tool-name prefixes, or select tools once per session rather than per step.
- "Focused 300 tokens vs 113k tokens" is the strongest empirical argument for a retrieval-and-curation layer over dumping whole catalogues/schemas into context. Semantic-layer definitions, table docs and metric definitions should be loaded just-in-time by reference (table/metric IDs), not pre-stuffed.
- Compaction is a lossy write path into memory: its outputs should be logged and evaluated like any other memory write (OpenAI explicitly flags summary poisoning).
- Skills map cleanly onto "procedural knowledge" (how to build a cohort analysis, how to validate a KPI), with only metadata in the always-loaded prefix.

### Gaps
- Did not re-fetch Anthropic's Dec 2024 "Building effective agents" directly; its workflow patterns (prompt chaining, routing, orchestrator-workers, evaluator-optimizer) are not cited here from the primary page.
- No quantitative public data found on how much compaction or tool-result clearing improves task success; Anthropic and OpenAI describe trade-offs qualitatively.
- Claude Code's current (late 2026) auto-compact threshold was not verified; the 95% figure is from a July 2025 secondary description.

---

## 2. Memory systems: tiers, consolidation, and benchmarks

### Takeaway
Production memory systems share a two-tier shape — a small, always-in-context "core"/profile tier and a large, searched "archival"/collection tier — plus a consolidation pipeline that turns raw episodes into semantic facts with explicit ADD/UPDATE/DELETE (Mem0) or temporal invalidation (Zep/Graphiti). Background ("sleep-time"/"subconscious") consolidation is preferred over hot-path writes for quality and latency. Benchmark claims are heavily disputed: LoCoMo is short enough that a full-context baseline beats Mem0, and Mem0 and Zep each report beating the other.

### Cited Findings

**Memory-type taxonomy (LangMem / LangGraph) [primary]**
- Three types: **semantic** (facts & knowledge; stored as a *profile* — one schema'd document updated in place — or a *collection* of records), **episodic** (past experiences / few-shot examples capturing observation, thoughts, action, result), **procedural** (system behaviour; prompt rules refined via a prompt optimiser) — [LangMem conceptual guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)
- Collections must "reconcile new information with previous beliefs, either deleting/invalidating or updating/consolidating"; over-extraction hurts precision, under-extraction hurts recall; relevance should combine similarity with "importance" and "strength" (recency/frequency of use) — [LangMem](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)
- **Active ("hot path") vs background ("subconscious") formation**: hot path is immediate but adds latency and tool-choice burden; background reflection after a conversation goes quiet gives "higher recall" without slowing interaction — [LangMem](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)
- Hierarchical **namespaces** e.g. `("acme_corp", "{user_id}", "code_assistant")`, templated at runtime; retrieval by key, semantic search, or metadata filter — [LangMem](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)
- LangGraph separates thread-scoped short-term memory (checkpointed state, usable as scratchpad) from cross-session long-term memory — [LangChain](https://blog.langchain.com/context-engineering-for-agents/)

**MemGPT / Letta [primary]**
- Core memory = labelled, persisted, editable blocks always in context (e.g., `persona`, `human`, custom); Letta guidance: typically 2,000–5,000 chars per block, 5–15 blocks max for reliability. External memory = archival (semantic, unbounded) + conversation search, retrieved by tool calls — [Letta skills repo](https://github.com/letta-ai/skills/blob/HEAD/letta/letta-api-client/memory-architecture.md)
- Archival memory is "agent-immutable" (agents can insert/search but not easily modify/delete; developers can via SDK); don't use it for frequently changing state or always-visible info — [Letta docs](https://docs.letta.com/v1-sdk/memory/archival-memory/index.md)
- Context window is "compiled" from DB state on every request; blocks can be shared between agents — [Letta blog: Memory Blocks](https://www.letta.com/blog/memory-blocks/)
- **Sleep-time agents ("MemGPT 2.0")**: Letta creates a primary agent (no core-memory-edit tools) and a sleep-time agent that asynchronously rewrites the primary's memory blocks, turning "raw context" into "learned context"; motivation: incremental in-loop memory formation in MemGPT made memories "messy and disorganized" and slowed the agent — [Letta blog: Sleep-time Compute](https://www.letta.com/blog/sleep-time-compute/)
- Trade-off: a sleep-time agent managing archival retrieval is "high-latency in message space" and can make the primary feel forgetful; Letta recommends primary-agent archival for most cases — [Letta forum](https://forum.letta.com/t/should-archival-memories-be-managed-by-a-sleeptime-agent/74)

**Mem0 (Chhikara et al., arXiv 2504.19413, Apr 2025) [primary]**
- Two-phase pipeline: **extraction** (from latest message pair + summary + last m=10 messages) and **update**, where for each candidate fact the top s=10 similar memories are retrieved and an LLM chooses **ADD / UPDATE / DELETE / NOOP** via a tool call; all LLM ops used GPT-4o-mini — [Mem0 paper](https://arxiv.org/abs/2504.19413)
- Mem0ᵍ variant stores entities/relations as a directed labelled graph in Neo4j with conflict detection on update — [Mem0 paper](https://arxiv.org/abs/2504.19413)
- Claims on LoCoMo: 26% relative improvement in LLM-as-a-Judge (J) over OpenAI memory, 91% lower p95 latency and >90% token savings vs full-context — [Mem0 paper](https://arxiv.org/abs/2504.19413)
- Overall J from Mem0's own Table 2: Full-context **72.90**, Mem0ᵍ 68.44, Mem0 66.88, Zep 65.99, LangMem 58.10, OpenAI 52.90, A-Mem 48.38; best RAG config ~61. **Full-context beat both Mem0 variants on accuracy**; Mem0's win is cost/latency (Mem0 ~1.8k memory tokens vs ~26k full-context) — [Mem0 paper](https://arxiv.org/abs/2504.19413)
- On open-domain questions Mem0's own table shows Zep ahead (J 76.60 vs Mem0ᵍ 75.71) — [Mem0 paper](https://arxiv.org/abs/2504.19413)

**Zep / Graphiti (Rasmussen et al., arXiv 2501.13956, Jan 2025) [primary]**
- Three-tier temporal knowledge graph: **episode subgraph** (raw messages/text/JSON, a "non-lossy data store"), **semantic entity subgraph** (resolved entities + fact edges), **community subgraph** (clusters with summaries; label propagation instead of Leiden to allow incremental updates, with periodic refresh) — [Zep paper](https://arxiv.org/abs/2501.13956)
- **Bi-temporal model**: each fact edge carries `t_valid`/`t_invalid` (when it was true in the world) and `t'_created`/`t'_expired` (when the system learned/retired it). An LLM compares new edges to related ones; contradictions set the old edge's `t_invalid` to the new edge's `t_valid` — history is preserved, not deleted; new information is prioritised — [Zep paper](https://arxiv.org/abs/2501.13956)
- Bidirectional episode↔fact indices let derived facts be "traced to their sources for citation or quotation" — [Zep paper](https://arxiv.org/abs/2501.13956)
- Graph writes use predefined Cypher rather than LLM-generated queries "to ensure consistent schema formats and reduce the potential for hallucinations" — [Zep paper](https://arxiv.org/abs/2501.13956)
- Results: DMR 94.8% vs MemGPT 93.4% (gpt-4-turbo); but full-conversation baseline 98.0% vs Zep 98.2% on gpt-4o-mini, i.e., DMR is near-saturated. LongMemEval: gpt-4o 71.2% vs full-context 60.2% (+18.5%), gpt-4o-mini 63.8% vs 55.4%; context ~1.6k vs 115k tokens; latency ~2.6 s vs 28.9 s (~90% reduction). Experiments Dec 2024–Jan 2025 — [Zep paper](https://arxiv.org/abs/2501.13956)

**Benchmark disputes (flagged)**
- Zep's rebuttal (6 May 2025, updated through Jun 2026) [vendor-competitive]: claims Mem0 misconfigured Zep (both speakers assigned the user role; timestamps appended to text instead of `created_at`; sequential instead of parallel search); corrected Zep LoCoMo J = **75.14% ± 0.17** (~10% relative over Mem0ᵍ); p95 search 0.632 s vs Mem0's reported 0.778 s for Zep. The article notes a correction to its own earlier calculation, and its page metadata still says "outperforms it by 24%" while the text says 10% — [Zep blog](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)
- Zep's critique of LoCoMo: conversations ~16k–26k tokens fit in modern windows (full-context ~73% beats Mem0's ~68%); no knowledge-update questions; category 5 unusable (missing ground truth); multimodal errors, speaker misattribution and ambiguous questions — [Zep blog](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/). The full-context > Mem0 point is confirmed by Mem0's own Table 2 — [Mem0 paper](https://arxiv.org/abs/2504.19413)
- Zep's blog banner also claims a later LoCoMo score of "80% at <200ms latency" (banner date reads "December 9, 2015", evidently a typo for 2025); not independently verified — [Zep blog](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)

**LongMemEval (Wu et al., arXiv 2410.10813, Oct 2024; ICLR 2025) [primary]**
- 500 curated questions testing five abilities: information extraction, multi-session reasoning, temporal reasoning, **knowledge updates**, **abstention**; commercial assistants and long-context LLMs show a ~30% accuracy drop across sustained interactions — [LongMemEval](https://arxiv.org/abs/2410.10813)
- Frames memory as **indexing → retrieval → reading**; effective optimisations: session decomposition (finer value granularity), fact-augmented key expansion for indexing, time-aware query expansion — [LongMemEval](https://arxiv.org/abs/2410.10813)

**Consumer/vendor memory products [primary]**
- ChatGPT memory (launched Feb 2024; GA to Free/Plus/Team/Enterprise Sep 2024): "Memory updated" notices with a manage/forget UI; deleting a chat doesn't delete derived memories; steering away from proactively remembering sensitive info like health details; Enterprise owners can disable memory org-wide; Temporary Chat bypasses memory. Since 10 Apr 2025 memory works two ways: explicit "saved memories" and implicit "chat history" referencing all past conversations — [OpenAI](https://openai.com/index/memory-and-new-controls-for-chatgpt/)
- Claude memory tool (API): client-side tool — Claude only *requests* `view`/`create`/`str_replace`/`insert`/`delete`/`rename` on a `/memories` prefix; the application maps that to its own storage (per-user dir, DB keys) and must reject paths outside `/memories` (path-traversal protection). Claude checks its memory directory before starting a task — [Claude docs](https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool)

### Inferences
- A defensible enterprise design mirrors Zep + Letta: immutable episode log (source of truth, citable) → derived semantic facts with bi-temporal validity → small curated "core" blocks always in context. Never let derived facts be the only copy.
- Mem0-style ADD/UPDATE/DELETE with a hard DELETE loses audit history; prefer Zep-style invalidation (or tombstones) for organisational knowledge.
- Run consolidation in the background (sleep-time / post-session jobs) and route outputs through a review queue for anything that becomes organisation-wide; keep hot-path writes for user-scoped preferences.
- Evaluate on LongMemEval-style categories (knowledge update, temporal, abstention) and on your own analytics tasks; treat LoCoMo and DMR results as weak evidence, and always include a full-context baseline.

### Gaps
- No independent (non-vendor) replication of the Mem0-vs-Zep LoCoMo numbers was found.
- Did not verify Anthropic's consumer Claude app memory feature details or ChatGPT memory changes after June 2025.
- No strong primary evidence found on *which* episodic→semantic consolidation prompts/strategies work best beyond LongMemEval's indexing findings and vendor descriptions.

---

## 3. Tool design for retrieval

### Takeaway
Retrieval tools should be few, purpose-built, namespaced and token-budgeted: prefer `search_*` / consolidated "get context" tools over `list_*` dumps, return human-meaningful fields instead of opaque IDs, support concise/detailed response modes, paginate/truncate with steering messages, and evaluate tool descriptions empirically. MCP distinguishes application-controlled resources from model-controlled tools.

### Cited Findings
- **Anthropic "Writing effective tools for agents — with agents" (11 Sep 2025) [primary]**: tools are "a contract between deterministic systems and non-deterministic agents"; "more tools don't always lead to better outcomes"; avoid tools that merely wrap API endpoints — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
- Prefer `search_contacts` over `list_contacts`, `search_logs` over `read_logs`, and a consolidated `get_customer_context` over separate `get_customer_by_id`/`list_transactions`/`list_notes` — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
- **Namespacing** by service and resource (`asana_projects_search`); prefix vs suffix naming had "non-trivial effects" that vary by model — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
- Return high-signal fields (`name`, `file_type`) instead of `uuid`/`mime_type`; resolving UUIDs to semantic names "or even a 0-indexed ID scheme" significantly improved retrieval precision and reduced hallucination — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
- **`response_format` enum** (`concise` / `detailed`): in a Slack example concise used ~⅓ of the tokens (72 vs 206); detailed includes IDs needed for follow-up calls — effectively a "search then fetch" pattern — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
- **Response budgets**: implement pagination, range selection, filtering and/or truncation with sensible defaults; Claude Code caps tool responses at 25,000 tokens by default; truncation messages and error messages should steer the agent (e.g., toward many small targeted searches) rather than return opaque codes — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
- Tool descriptions: write as for a new hire, make implicit terminology explicit, unambiguous parameter names (`user_id` not `user`). Precise description refinements helped Claude Sonnet 3.5 reach SOTA on SWE-bench Verified; a web-search tool bug (Claude appending "2025" to queries) was fixed via description changes — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
- Evaluate with realistic multi-call tasks and held-out sets; track accuracy plus runtime, number of tool calls, tokens and tool errors — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
- **MCP primitives (spec 2025-06-18) [primary]**: Prompts = user-controlled; **Resources = application-controlled** ("contextual data attached and managed by the client", e.g., file contents, git history); **Tools = model-controlled** — [MCP spec](https://modelcontextprotocol.io/specification/2025-06-18/server)
- MCP tool annotations can disclose open-world access or destructive behaviour — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
- Tool RAG: semantic search over tool descriptions (LangGraph Bigtool) reportedly improves tool selection ~3× — [LangChain](https://blog.langchain.com/context-engineering-for-agents/); Manus cautions it breaks KV-cache and confuses models mid-loop — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)

### Inferences
- For analytics: `search_metrics`/`search_tables` (concise: name, description, owner, freshness, trust tier) → `get_table_context(id, format=detailed)` (schema, semantic definitions, sample stats, lineage). Query-result tools should return row counts + a capped preview + a handle to the full result stored server-side (Manus' restorable compression).
- Use MCP *resources* for curated, application-chosen context (approved metric definitions, tenant policies) and *tools* for model-initiated retrieval; this aligns trust with control.

### Gaps
- No published head-to-head data on optimal page sizes or default token caps beyond Claude Code's 25k figure.

---

## 4. Governance and safety of injected knowledge

### Takeaway
Any retrieved content — documents, query results, memories, even skills — is a potential instruction channel. No prompt-level defence is reliable; spotlighting/delimiting reduces but doesn't eliminate attacks. The robust approach is architectural: break Simon Willison's "lethal trifecta" (private data + untrusted content + exfiltration channel), constrain what an agent may do after ingesting untrusted content (design patterns paper / CaMeL), gate memory writes (poisoning is demonstrated with query-only access), and enforce scope/tenant isolation and provenance at the storage layer.

### Cited Findings

**OWASP LLM01:2025 Prompt Injection [primary]**
- Indirect injection occurs when an LLM accepts input from external sources (websites, files); RAG and fine-tuning "do not fully mitigate" it; "it is unclear if there are fool-proof methods of prevention" — [OWASP](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- Mitigations: constrain model behaviour; define/validate output formats with deterministic code and request citations; input/output filtering incl. the "RAG Triad" (context relevance, groundedness, answer relevance); least privilege with API tokens handled in code not by the model; human approval for high-risk actions; **segregate and identify external content**; adversarial testing — [OWASP](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- Scenario #4 is directly RAG-relevant: an attacker modifies a document in a RAG repository so malicious instructions alter outputs; scenario #2: hidden instructions cause an image-link exfiltration — [OWASP](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)

**Microsoft spotlighting (Hines et al., arXiv 2403.14720, Mar 2024) [primary]**
- Three techniques: **delimiting** (special tokens around untrusted input), **datamarking** (interleave a marker, e.g., replace whitespace with `ˆ`), **encoding** (e.g., base64) plus system-prompt instructions explaining the transformation — [Spotlighting](https://arxiv.org/abs/2403.14720)
- GPT-3.5-Turbo baseline ASR ~60%; defensive instructions alone had "only a negligible impact"; delimiters roughly halved ASR but "could be easily subverted by an attacker who gains knowledge of our system prompt"; datamarking and encoding gave stronger reductions with negligible task-performance impact — [Spotlighting](https://arxiv.org/abs/2403.14720)

**Simon Willison (Jun 2025) [primary commentary]**
- **Lethal trifecta**: access to private data + exposure to untrusted content + ability to externally communicate; combining all three lets an attacker steal data. Exploits reported against Microsoft 365 Copilot, GitHub's MCP server, GitLab Duo and many others; vendor fixes usually close the exfiltration vector. Guardrails claiming "95%" detection are "a failing grade" in security — [Simon Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)
- **Design Patterns for Securing LLM Agents against Prompt Injections** (Beurer-Kellner et al., 2025; IBM, Invariant, ETH, Google, Microsoft): "once an LLM agent has ingested untrusted input, it must be constrained so that it is impossible for that input to trigger any consequential actions." Six patterns: Action-Selector, Plan-Then-Execute, LLM Map-Reduce, Dual LLM (privileged LLM handles only symbolic `$VAR` references to quarantined output), Code-Then-Execute (CaMeL; taint tracking through a DSL), Context-Minimization. Includes a SQL Agent case study — [Simon Willison](https://simonwillison.net/2025/Jun/13/prompt-injection-design-patterns/)

**Memory / knowledge-base poisoning [primary]**
- **AgentPoison** (NeurIPS 2024): backdoor triggers optimised so poisoned demonstrations are retrieved from memory/RAG; 82% retrieval success, 63% end-to-end ASR, <1% benign-performance drop with poisoning ratio <0.1%; triggers transfer across embedders and evade perplexity/rephrasing defences — [AgentPoison](https://arxiv.org/html/2407.12784)
- **MINJA** (NeurIPS 2025): attacker with **query-only** access (no write privilege) gets malicious records into an agent's memory bank via "bridging steps" and progressive prompt shortening; injection success rate "uniformly exceeds 95%" in main experiments, while end-to-end ASR varies and can fall as benign record density increases (e.g., 68.9% → 31.1% on one EHRAgent setting) — [MINJA](https://proceedings.neurips.cc/paper_files/paper/2025/file/42a97bbd9844d2bf68596730af80bcdf-Paper-Conference.pdf)
- Follow-up work (EMNLP 2026) evaluates defences including paraphrasing, relevance gating and consistency checks — [Query-Efficient Memory Injection Attacks](https://yangzhangalmo.github.io/papers/EMNLP26-AMIA.pdf) (not read in depth)

**Human control and curation [primary]**
- ChatGPT surfaces "Memory updated" with a link to review/forget, lets enterprise admins disable memory, and steers away from sensitive memories — [OpenAI](https://openai.com/index/memory-and-new-controls-for-chatgpt/)
- Claude memory tool keeps storage entirely in the application, so retention, encryption and review are the developer's responsibility; path restriction is mandatory — [Claude docs](https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool)
- Letta archival memory is agent-immutable (only developers can edit/delete via SDK) and sleep-time agents, not the user-facing agent, hold core-memory-write tools — [Letta docs](https://docs.letta.com/v1-sdk/memory/archival-memory/index.md); [Letta blog](https://www.letta.com/blog/sleep-time-compute/)

**Tenant isolation, scope and provenance [preprint-2026]**
- "Governed Shared Memory for Multi-Agent LLM Systems" (arXiv 2606.24535, 2026): names four failure modes — unauthorized leakage, stale propagation, contradiction persistence, provenance collapse. Live measurement of a production multi-tenant service (MemClaw) found tenant isolation held, but **sub-tenant scope was not enforced on direct GET-by-id** for agent-scoped credentials (remediated), and a synchronous near-duplicate gate could reject contradictory writes before the async contradiction detector saw them. All 50 depth-4 derivation chains reconstructed with correct writer identity — [arXiv 2606.24535](https://arxiv.org/html/2606.24535)
- "Governed write gateway" pattern recommends tests proving model-originated writes cannot acquire human authority and that audit events commit atomically with claims — [Agent Memory Atlas](https://neoneye.github.io/agent-memory-atlas/patterns/governed-write-gateway/) (community pattern catalogue, not peer-reviewed)

### Inferences
- An analytics agent with warehouse access (private data) that reads user-uploaded docs, Slack, or web content (untrusted) and can render links/images, send emails or write to external systems (exfiltration) has the full trifecta. Remove at least one leg per execution context: e.g., quarantined sub-agents summarise untrusted docs into structured fields; the privileged agent that can run SQL and export never sees raw untrusted text.
- Treat memory writes as a privileged operation: tag every memory with provenance (source episode, writer identity — human/agent/job, tenant, scope), trust tier (e.g., curated/org-approved > system-derived > user-asserted > agent-inferred), and require human approval to promote anything into org-wide scope. MINJA shows ordinary users can poison shared memory via normal queries.
- Wrap retrieved content in delimited/datamarked blocks labelled as data, but never rely on that alone; enforce authorisation at the storage layer (every read path, including get-by-id) rather than in prompts.
- Log retrieval events (query, returned memory IDs, trust tier, tenant) alongside summaries/compactions, since OpenAI notes summaries need logging for audit and the governed-memory study found enforcement gaps only through live probing.

### Gaps
- Did not fetch OWASP LLM02 (Sensitive Information Disclosure), LLM04 (Data and Model Poisoning) or LLM08 (Vector and Embedding Weaknesses) 2025 entries; their specific guidance on PII in retrieved context and vector-store multi-tenancy is not cited here.
- No primary source found with concrete, tested patterns for PII redaction inside retrieved context for agents (beyond ChatGPT's "steer away from sensitive info").
- No quantitative evaluation found of human-in-the-loop memory approval workflows (approval rates, latency, quality impact).

---

## 5. Knowledge lifecycle: staleness, conflicts, deprecation, versioning

### Takeaway
The strongest primary design is bi-temporal validity with invalidation-not-deletion (Zep/Graphiti). 2026 preprints formalise "memory pollution" and show that append-only or last-write-wins memory can perform *worse than no memory* under world change, and that conflicts should be surfaced (enabling abstention) rather than silently collapsed. Resolution should weigh source authority, validity time and scope — not recency alone.

### Cited Findings
- Graphiti tracks four timestamps per fact (`t_valid`, `t_invalid`, `t'_created`, `t'_expired`), uses an LLM to detect temporally overlapping contradictions and invalidates older edges while keeping them; it "consistently prioritizes new information" — [Zep paper](https://arxiv.org/abs/2501.13956)
- Mem0's update phase uses DELETE "for removal of memories contradicted by new information" — [Mem0 paper](https://arxiv.org/abs/2504.19413)
- LangMem: collections must delete/invalidate or update/consolidate; profiles keep only the latest state — [LangMem](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)
- LongMemEval explicitly tests knowledge updates and abstention — [LongMemEval](https://arxiv.org/abs/2410.10813); Chroma found Claude models' conservative abstentions under ambiguity lowered their full-prompt LongMemEval scores — [Chroma](https://research.trychroma.com/context-rot)
- Claude Code's just-in-time grep/glob retrieval is described as bypassing "stale indexing" — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- **TEPA** (arXiv 2608.07429, 2026) [preprint-2026]: defines "memory pollution" — active memories superseded by newer conflicting evidence. Under controlled full-reversal drift (50 seeds), append-only and last-write-wins both scored 0.210, no-memory 0.309, TEPA (keyed precedents revoked on contradiction, revoked history kept for audit) 0.950 — [TEPA](https://arxivsignals.io/papers/2608.07429)
- **TRACE** (arXiv 2609.33517, 2026) [preprint-2026]: "temporal memory admission" — a memory can be relevant and faithful yet "inadmissible for action". Four gates per item: Authorization (principal/role/scope), Temporal (epoch/validity/supersession), Applicability (task/purpose), Provenance receipts (records derivation "without certifying that the source statement is true"), producing a reason-coded audit trail. Restore-all admits stale state; reset discards valid state — [TRACE](https://arxiv.org/html/2609.33517v1)
- **StateFuse** (arXiv 2607.05844, 2026) [preprint-2026]: immutable history + explicit conflict objects + resolvers that may choose or abstain but not rewrite state; ties on accuracy with flat multi-value baselines but surfaces contradictions that collapsed (last-write-wins) surfaces hide, enabling safer abstention — authors call the claim "narrow" — [StateFuse](https://arxiv.org/pdf/2607.05844v1)
- Governed shared memory: stale propagation handled by marking outdated rows non-active; pipeline-ordering bug where dedup pre-empted contradiction detection — [arXiv 2606.24535](https://arxiv.org/html/2606.24535)
- Search synthesis of 2026 work: resolve conflicts by source authority, temporal validity, scope and policy, not recency alone; retain superseded records for audit — [TRACE](https://arxiv.org/html/2609.33517v1); [StateFuse](https://arxiv.org/pdf/2607.05844v1)

### Inferences
- For "doc says X, data says Y" in analytics: model both as claims with source type and authority (e.g., governed semantic-layer definition > certified dashboard > wiki doc > agent-inferred memory), validity interval and freshness; when they conflict, surface both with provenance and let the agent abstain/ask, then open a curation task rather than auto-overwriting.
- Version organisational knowledge like code: immutable versions, explicit `superseded_by`, deprecation flags that exclude from default retrieval but remain auditable; tie memory entries to underlying object versions (table schema hash, metric definition version) so schema changes can trigger staleness invalidation.
- Order the write pipeline carefully: contradiction detection must run before or alongside deduplication.

### Gaps
- 2026 preprints were read at abstract/summary level only and are not yet peer-reviewed or replicated.
- No primary source found specifically on staleness detection driven by upstream data-catalogue/schema changes for analytics agents; this is an inference.
- No vendor (Anthropic/OpenAI/Letta) documentation found describing built-in TTL/expiry for memories.
