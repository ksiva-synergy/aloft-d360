# Reasoning and Planning Architectures for Tool-Using LLM Agents (2023–2026): Evidence on When Each Works

Scope note: target use case is an enterprise data-analysis agent working over a governed SQL warehouse, document KBs and M365 files, on multi-step requests like "compare Q3 opex by vessel with last year, find the biggest increases, explain them, produce an Excel and a Word summary".
Provenance: items marked **[fetched]** were checked against the primary source in this session (Nov 2026). Items marked **[prior knowledge, not re-fetched]** come from well-known primary sources I did not re-open this session. The writer should spot-check those before quoting exact figures.

---

## 1. ReAct: strengths, weaknesses, failure modes

### Takeaway
ReAct (interleaving "Thought / Action / Observation") is still the default inner loop of almost every production agent, including function-calling loops with thinking. Its weaknesses show up on long horizons: drift, looping, forgetting sub-goals, plus cost and latency from one LLM call per tool step. Planning, recitation and parallelism patterns were invented mainly to patch these weaknesses.

### Cited Findings
- ReAct beats imitation-learning and RL baselines by **+34 points absolute success on ALFWorld and +10 on WebShop**, using only 1–2 in-context examples. On HotpotQA and FEVER, grounding reasoning in a Wikipedia API reduced the hallucination and error propagation seen in chain-of-thought. Trajectories are also more interpretable. Published Oct 2022, ICLR 2023, so this is an older result on pre-GPT-4 models. — [Yao et al., arXiv 2210.03629](https://arxiv.org/abs/2210.03629) [fetched]
- Cost and latency: ReAct makes one LLM call per tool step, sequentially, and re-sends the full history each step. ReWOO's authors call this redundant prompting. They report **5x token efficiency** (and +4% accuracy on HotpotQA) once planning is decoupled from observations. — [Xu et al., ReWOO, arXiv 2305.18323](https://arxiv.org/abs/2305.18323) [fetched]
- Sequential tool calling is slow. LLMCompiler reports up to **3.7x latency speedup, 6.7x cost savings and about 9% accuracy improvement vs ReAct** by planning a DAG of calls and running them in parallel. — [Kim et al., LLMCompiler, arXiv 2312.04511, ICML 2024](https://arxiv.org/abs/2312.04511) [fetched]
- Drift and forgetting sub-goals on long loops: Manus says a typical task needs **about 50 tool calls**, which makes the model "vulnerable to drifting off-topic or forgetting earlier goals". Its fix is a todo.md that is constantly rewritten (see §4). — [Manus, Context Engineering, 18 Jul 2025](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) [fetched]
- Pattern lock-in ("few-shot rut"): repetitive action–observation histories make the agent imitate its own past actions. Manus's example is reviewing 20 resumes, where the agent fell into a rhythm. The mitigation is controlled variation in serialization. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) [fetched]
- Errors are useful signal for the loop: "Erasing failure removes evidence. And without evidence, the model can't adapt." Failed actions and stack traces should stay in context. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) [fetched]
- Anthropic describes agents as "typically just LLMs using tools based on environmental feedback in a loop", i.e. ReAct-shaped. It warns that agents cost more and can compound errors. — [Anthropic, Building effective agents, 19 Dec 2024](https://www.anthropic.com/engineering/building-effective-agents) [fetched]

### Inferences
- Modern function-calling loops with interleaved thinking are ReAct with the "Thought" moved into native reasoning tokens. The papers below compare against a 2022–23 ReAct baseline on weaker models, so the size of the deltas probably overstates the gap against a 2026 frontier model in a native tool loop.
- For the opex example, which takes perhaps 10–30 tool calls (schema lookup, 2+ SQL queries, KB lookups for explanations, Excel build, Word build), plain ReAct is likely to work but is exposed to sub-goal forgetting (for example dropping the Word summary). That points to adding recitation of an explicit plan rather than abandoning ReAct.

### Gaps
- I found no recent (2025–26) controlled benchmark of plain ReAct against plan-augmented loops on frontier reasoning models in enterprise data-analysis settings.
- I found no published quantitative "looping rate" for ReAct agents. The evidence is mostly practitioner reports.

---

## 2. Plan-and-execute: Plan-and-Solve, ReWOO, LLMCompiler, and Tree/Graph-of-Thought search

### Takeaway
Up-front planning cuts tokens and latency substantially, through fewer LLM calls and parallel tool execution. It also gives modest accuracy gains on multi-hop tasks with *predictable* structure. Its weakness is brittleness when later steps depend on what earlier observations reveal, which is why production systems add replanning or use a hybrid living plan. Tree/graph search buys accuracy on puzzle-like tasks at large token multiples and is rarely justified for analytics agents.

### Cited Findings
- **Plan-and-Solve (PS/PS+) prompting** ("first devise a plan, then carry out the subtasks") targets *missing-step* errors, with PS+ also targeting *calculation* errors. It "consistently outperforms Zero-shot-CoT across all datasets by a large margin" on 10 datasets, and is comparable to 8-shot CoT on math. GPT-3 era, ACL 2023. This is a prompting result, not tool use. — [Wang et al., arXiv 2305.04091](https://arxiv.org/abs/2305.04091) [fetched]
- **ReWOO** has a Planner write the whole tool plan with variable placeholders, Workers execute it, and a Solver composes the answer. It reports **5x token efficiency, +4% accuracy on HotpotQA**, and robustness when tools fail. Separating reasoning from observations allowed reasoning to be distilled from 175B GPT-3.5 into a **7B LLaMA**. May 2023. — [Xu et al., arXiv 2305.18323](https://arxiv.org/abs/2305.18323) [fetched]
- **LLMCompiler** uses a function-calling planner that emits a DAG, a task-fetching unit, and a parallel executor. It reports up to **3.7x lower latency, up to 6.7x lower cost, and up to ~9% higher accuracy** than ReAct, works with open and closed models, and appeared at ICML 2024 (v1 Dec 2023). "Up to" figures are best cases across benchmarks. — [Kim et al., arXiv 2312.04511](https://arxiv.org/abs/2312.04511) [fetched]
- Production evidence for parallelism: in Anthropic's research system, parallel tool calling (the lead agent spawns 3–5 subagents in parallel, and each subagent calls 3+ tools in parallel) **cut research time by up to 90%** for complex queries. — [Anthropic, multi-agent research system, Jun 2025](https://www.anthropic.com/engineering/multi-agent-research-system) [fetched]
- **Tree of Thoughts**: on Game of 24, GPT-4 with CoT solved 4% and ToT solved 74%. It uses many more model calls per problem. May 2023. — [Yao et al., arXiv 2305.10601](https://arxiv.org/abs/2305.10601) [prior knowledge, not re-fetched]
- **Graph of Thoughts** reports roughly 62% higher sorting quality than ToT with more than 31% lower cost. Aug 2023. — [Besta et al., arXiv 2308.09687](https://arxiv.org/abs/2308.09687) [prior knowledge, not re-fetched]
- **LATS** (Language Agent Tree Search, MCTS over ReAct trajectories with reflection) reported about 92.7% pass@1 on HumanEval with GPT-4, at much higher sampling cost. Oct 2023. — [Zhou et al., arXiv 2310.04406](https://arxiv.org/abs/2310.04406) [prior knowledge, not re-fetched]

### Inferences
- The opex request has a mostly predictable skeleton: (1) resolve metric and dimension definitions, (2) query this year's Q3, (3) query last year's Q3, (4) compute deltas and rank, (5) retrieve explanations for the top-N, (6) build Excel, (7) build Word. Steps 2–3 and parts of 5 can run in parallel, so an LLMCompiler/ReWOO-style plan with parallel execution fits well. But step 5 depends on what step 4 finds, so a fully static plan breaks. The best fit is a plan that is revised after key observations (see §4).
- Tree/graph search is poorly matched to data analysis. There is no cheap, reliable evaluator for "a good analysis", and each node costs warehouse queries. I found no evidence it helps in tool-heavy enterprise tasks.

### Gaps
- I found no 2025–26 replication of ReWOO or LLMCompiler deltas on frontier reasoning models (o-series, Claude 4.x/5.x). The gains may be smaller now that native parallel tool calling exists in the major APIs.
- I could not extract per-benchmark LLMCompiler numbers from the abstract page alone (it does not name benchmarks or models).

---

## 3. Reflexion, self-critique and verifier patterns: when they help and when they hurt

### Takeaway
Self-correction helps when an *external, reliable signal* exists, such as test execution, a SQL error, a schema validator, or a row-count check. *Intrinsic* self-critique (the model re-judging its own reasoning with no new information) often fails to help and can make results worse, while always adding cost. For a data agent, use verifiers grounded in execution (query errors, reconciliation totals, schema checks), not "are you sure?" loops.

### Cited Findings
- **Reflexion** stores verbal reflections in episodic memory across trials, with no weight updates. It reached **91% pass@1 on HumanEval vs 80% for GPT-4** (the prior SOTA). Feedback can be scalar or free-form, and external or internally simulated. Mar 2023 (v4 Oct 2023). Note that the coding gain relies on executing unit tests, which is an external signal. — [Shinn et al., arXiv 2303.11366](https://arxiv.org/abs/2303.11366) [fetched]
- **Conflicting evidence: "LLMs Cannot Self-Correct Reasoning Yet"** (Huang et al., Google DeepMind/UIUC, ICLR 2024). Without external feedback, models rarely find their own reasoning errors and sometimes change correct answers to wrong ones. Self-correction was not better than self-consistency at matched sample counts. External feedback (code execution, verifiers) is the promising route. — [arXiv 2310.01798](https://arxiv.org/abs/2310.01798) [fetched via search summary]
  - Reported numbers from a secondary summary, *not verified against the paper*: GPT-3.5 GSM8K fell from 75.9% to 74.7% after 2 rounds, and Llama-2 fell from 62.0% to 36.5%. — [alphaXiv summary](https://alphaxiv.org/abs/2310.01798v2)
- Anthropic's **evaluator-optimizer** workflow pattern is recommended only "when there are clear evaluation criteria, and when iterative refinement provides measurable value". — [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) [fetched]
- The **"think" tool** (a structured pause to reason about tool outputs) is a lightweight in-loop self-check. On τ-bench airline, pass^1 went from 0.332 (baseline) to 0.584 (think + optimized prompt) in the table. The text cites 0.370 → 0.570, a "54% relative improvement", and the post's own text and table disagree. Retail: 0.783 → 0.812. SWE-bench: +1.6% on average. It helps for tool-output analysis, policy-heavy environments and sequential decisions where mistakes are costly. It is *not* useful for non-sequential or parallel calls or simple instruction following, and it adds prompt and output tokens. Mar 2025. **Update dated Dec 15, 2025: Anthropic now recommends extended thinking instead of a dedicated think tool "in most cases."** — [Anthropic, The "think" tool](https://www.anthropic.com/engineering/claude-think-tool) [fetched]
- **Overcorrection and cost in multi-agent verification:** in the Google/MIT scaling study, independent multi-agent systems amplified errors up to **17.2x**, while a centralized orchestrator acting as a "validation bottleneck" contained this to **4.4x**. — [Google Research blog, 28 Jan 2026](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/) [fetched]
- Self-Refine (iterative self-feedback) reported about 20% average improvement across 7 generation tasks, mostly on style and quality, where criteria are soft. — [Madaan et al., arXiv 2303.17651](https://arxiv.org/abs/2303.17651) [prior knowledge, not re-fetched]

### Inferences
- Verifiers that suit a governed-warehouse agent: SQL compile and dry-run errors fed back into the loop, row-count and NULL sanity checks, reconciling totals against a known control figure (for example, total opex across vessels equals the GL total), schema validation of the final typed answer, and checking that every number in the Word summary traces to a cell in the Excel output. All of these are external signals, the regime where self-correction has evidence behind it.
- Avoid unbounded generic "critique and revise" loops on the narrative explanation. The evidence says they add cost and can degrade correct content.

### Gaps
- I found no published study of self-critique on text-to-SQL agents specifically in 2025–26 within this budget.

---

## 4. Hybrid "living to-do list" planning (Claude Code TodoWrite, Cowork, Codex, Deep Research, Manus todo.md)

### Takeaway
Leading 2025–26 agents converged on a *hybrid*: a ReAct/tool loop in which the model keeps an explicit, mutable task list as a tool or file, updates it after each step, and re-reads it. This gets plan-and-execute's sub-goal tracking without its rigidity. The best-documented rationale is Manus's: recitation pushes the global plan into the most-attended recent context and counters lost-in-the-middle and goal drift over about 50 tool calls.

### Cited Findings
- **Manus todo.md:** on complex tasks Manus creates a todo.md and updates it step by step, checking off completed items. "By constantly rewriting the todo list, Manus is reciting its objectives into the end of the context. This pushes the global plan into the model's recent attention span, avoiding 'lost-in-the-middle' issues and reducing goal misalignment." This matters because tasks average about 50 tool calls. — [Manus, 18 Jul 2025](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) [fetched]
- **Related Manus context rules that make a living plan cheap:** KV-cache hit rate is "the single most important metric" for production agents. Cached input costs $0.30/MTok vs $3/MTok uncached on Claude Sonnet (10x). The input:output token ratio is about **100:1**. Keep the prefix stable and context append-only, and mask tool logits instead of adding or removing tools mid-task. Use the file system as restorable external memory, e.g. drop page contents but keep the URL. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) [fetched]
- **Anthropic's three core principles** include "prioritize transparency by explicitly showing the agent's planning steps". This is the user-facing reason vendors surface a to-do list: users can see and steer the plan. — [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) [fetched]
- **Claude Code subagents** are used narrowly: per Cognition, "it never does work in parallel with the subtask agent", and subagents usually only answer well-defined questions. This keeps investigation noise out of the main context while the main thread owns the plan. — [Cognition, Don't Build Multi-Agents, 12 Jun 2025](https://cognition.com/blog/dont-build-multi-agents) [fetched]
- **Effort scaling inside a plan:** Anthropic's research lead agent was given explicit rules. Simple fact-finding gets 1 agent with 3–10 tool calls, direct comparisons get 2–4 subagents with 10–15 calls each, and complex research gets 10+ subagents. Without those rules, early versions spawned **50 subagents for simple queries**. — [Anthropic multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) [fetched]
- Claude Code exposes a TodoWrite tool, and the OpenAI Codex CLI exposes an `update_plan` tool, for keeping a step list with statuses (pending / in_progress / completed) that the model updates during the run. — [Claude Code docs](https://docs.claude.com/en/docs/claude-code/overview); [openai/codex GitHub](https://github.com/openai/codex) [prior knowledge, not re-fetched]
- Anthropic's later context-engineering guidance describes "structured note-taking" (agent-maintained notes or to-do files persisted outside the context window) as a core technique for long-horizon tasks, alongside compaction and sub-agents. — [Anthropic, Effective context engineering for AI agents, Sep 2025](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) [prior knowledge, not re-fetched]

### Inferences
- For the target agent, a typed, visible plan object (steps with status, plus produced artifacts such as query IDs, the Excel path and the Word path) re-rendered in each turn's context is the lowest-risk planning design. It is auditable, which matters for governance, lets the UI show progress, and stops deliverables from being forgotten (the "and a Word summary" problem).
- The plan should carry data lineage: which query or result set backs which claim. Later verification steps (§3) can then check against it.
- Keep the plan's rendering append-friendly and cache-stable, per the Manus guidance, to preserve prompt-cache hits in long loops.

### Gaps
- I found **no published quantitative ablation** (accuracy with vs without a to-do tool) from Anthropic, OpenAI, Manus or Cognition. Vendor rationale is qualitative or engineering-based (attention recency, transparency).
- I did not retrieve OpenAI Deep Research's or Claude Cowork's published planning internals this session. Treat claims about their exact mechanism as unverified.

---

## 5. Orchestrator–worker and sub-agent architectures: when multi-agent wins and when it fails

### Takeaway
Multi-agent wins on **breadth-first, parallelizable, read-heavy** work (research, independent sub-analyses). It spends roughly 15x the tokens of chat, and token spend largely explains the gain. It loses, sometimes badly, on **tightly sequential, shared-context** work, where context fragmentation and conflicting implicit decisions dominate. The 2026 large-scale study confirms both sides. Prefer a centralized orchestrator over peer-to-peer or independent agents when reliability matters.

### Cited Findings
- **Anthropic research system** (Opus 4 lead with Sonnet 4 subagents) **outperformed single-agent Opus 4 by 90.2%** on an internal research eval. Agents use **~4x** the tokens of chat, and multi-agent systems **~15x**. On BrowseComp, **token usage alone explained 80% of performance variance**, and token usage plus number of tool calls plus model choice explained 95%. Upgrading the model (Sonnet 3.7 → Sonnet 4) gave a larger gain than doubling the token budget on Sonnet 3.7. — [Anthropic, Jun 2025](https://www.anthropic.com/engineering/multi-agent-research-system) [fetched]
- **Anthropic on poor fits:** tasks whose value doesn't justify the token cost, domains where agents must share the same context or have many inter-agent dependencies, and most coding tasks, which have fewer parallelizable subtasks. "LLM agents are not yet great at coordinating and delegating to other agents in real time." Vague delegation caused duplicated work. The fix is giving each subagent an objective, an output format, tool and source guidance, and boundaries. — [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system) [fetched]
- **Cognition, "Don't Build Multi-Agents"** (Walden Yan, 12 Jun 2025): "Share context, and share full agent traces, not just individual messages". Also: "Actions carry implicit decisions, and conflicting decisions carry bad results." In their Flappy Bird example, one subagent built a Mario-style background and another built a mismatched bird. Their default is a single-threaded linear agent, with an LLM that compresses history for long tasks. "In 2025, running multiple agents in collaboration only results in fragile systems." — [Cognition](https://cognition.com/blog/dont-build-multi-agents) [fetched]
- **Google Research + MIT, "Towards a Science of Scaling Agent Systems"** (arXiv 2512.08296, Dec 2025; blog 28 Jan 2026): 180 configurations, 5 architectures (single, independent, centralized, decentralized, hybrid), 4 benchmarks, and GPT, Gemini and Claude model families. Centralized multi-agent was **+80.9% on Finance-Agent**, a parallelizable task. **Every multi-agent variant degraded PlanCraft (strictly sequential) by 39–70%.** Error amplification was **17.2x for independent and 4.4x for centralized** systems. The coordination "tax" grows disproportionately with tool count (e.g. 16+ tools). A predictive model chose the best architecture for **87%** of unseen configurations (R² = 0.513). — [Google Research blog](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/); [arXiv 2512.08296](https://arxiv.org/abs/2512.08296) [fetched]
- **LangChain/LangGraph benchmark** (10 Jun 2025, gpt-4o, τ-bench retail plus 6 distractor domains with 19 tools each): single-agent performance **dropped sharply with 2+ distractor domains** (tool and instruction overload), while swarm and supervisor held up. Swarm slightly beat supervisor. The supervisor's main failure was the **"telephone game"**, paraphrasing sub-agent outputs. Removing handoff messages from sub-agent state and adding a `forward_message` tool gave a **"nearly 50% increase in performance"** for the supervisor. — [LangChain blog](https://www.langchain.com/blog/benchmarking-multi-agent-architectures) [fetched]
- **OpenAI, "A practical guide to building agents"** (2025) advises maximizing a single agent's capabilities first, with more tools and prompt templates. Split into multiple agents only for complex conditional logic or tool overload, usually overlapping or similar tools rather than raw tool count. It describes two patterns: a **manager** (agents as tools, with a central agent keeping control) and **decentralized handoffs** (control passes to a peer agent). — [OpenAI PDF](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf) [prior knowledge. The PDF was downloaded but its text could not be extracted this session, so verify wording]
- **Failure taxonomy:** the MAST study ("Why Do Multi-Agent LLM Systems Fail?", 2025) groups multi-agent failures into specification/system-design issues, inter-agent misalignment, and task verification and termination. — [Cemri et al., arXiv 2503.13657](https://arxiv.org/abs/2503.13657) [prior knowledge, not re-fetched. Exact counts and percentages not verified]

### Inferences
- Conflicting views reconciled: Anthropic (pro) and Cognition (con) agree on the mechanism. Multi-agent works when subtasks are independent and context can be partitioned, and fails when decisions must be consistent across shared state. The Google/MIT data quantifies this split (+81% parallel vs -39 to -70% sequential).
- For the opex example the core chain is sequential and shares definitions (metric definitions, fiscal calendar, vessel hierarchy, currency): query, compare, explain, document. That favors **a single agent with a living plan**. Workers are justified only for read-only fan-out, such as researching explanations for each of the top-N vessels in parallel or searching several KBs, where each worker returns a compact, typed finding. If sub-agents are used, use a **centralized orchestrator** (lower error amplification), pass shared definitions explicitly, and forward worker outputs verbatim rather than paraphrasing them.
- Tool overload is a real trigger for splitting. If the agent has many overlapping tools (SQL, several KB search tools, Graph and M365, Excel and Word builders), consider routing or tool masking (per Manus) before multi-agent.

### Gaps
- No published numbers specifically for multi-agent vs single-agent on enterprise BI or text-to-SQL tasks.
- OpenAI Agents SDK handoff benchmarks: none found. The SDK docs describe the mechanism (handoffs as tools, agents-as-tools), but I did not retrieve them this session.

---

## 6. Anthropic "Building effective agents": workflows vs agents, five patterns, start simple

### Takeaway
Anthropic's canonical guidance (Dec 2024) is to use the simplest thing that works. Prefer deterministic **workflows** (predefined code paths) when the task decomposes predictably, and use autonomous **agents** only for open-ended tasks with unpredictable step counts. Invest heavily in tool design (the agent-computer interface, ACI).

### Cited Findings
- Definitions: "Workflows are systems where LLMs and tools are orchestrated through predefined code paths." Agents "dynamically direct their own processes and tool usage". — [Anthropic, 19 Dec 2024](https://www.anthropic.com/engineering/building-effective-agents) [fetched]
- **Five workflow patterns:** (1) **Prompt chaining**, for fixed subtasks, trading latency for accuracy, with programmatic gates between steps. (2) **Routing**, which classifies input and dispatches it, for example easy queries to smaller models. (3) **Parallelization**, either sectioning or voting. (4) **Orchestrator-workers**, for when subtasks can't be predicted in advance. (5) **Evaluator-optimizer**, for when clear evaluation criteria exist and iteration adds measurable value. — [Anthropic](https://www.anthropic.com/engineering/building-effective-agents) [fetched]
- Start simple: find "the simplest solution possible, and only increasing complexity when needed". A single optimized LLM call with retrieval and examples is often enough. Frameworks can obscure prompts and responses, so start with the raw APIs. — [Anthropic](https://www.anthropic.com/engineering/building-effective-agents) [fetched]
- Three principles: simplicity, transparency (show planning steps), and careful ACI design. ACI example from SWE-bench: the model mishandled relative paths, so the tool was changed to require absolute paths, after which "the model used this method flawlessly". The post also recommends poka-yoke tool design and avoiding formats that need counting or escaping. — [Anthropic](https://www.anthropic.com/engineering/building-effective-agents) [fetched]
- Tool descriptions matter in practice: rewriting an MCP tool description, guided by a tool-testing agent, cut later agents' task completion time by **40%**. — [Anthropic multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) [fetched]
- The page now carries a note that the tooling landscape has changed since publication and points to newer Managed Agents docs. — [Anthropic](https://www.anthropic.com/engineering/building-effective-agents) [fetched]

### Inferences
- The opex request maps well onto a **hybrid**: an agent loop for the open-ended "explain the increases" part, wrapped around **workflow-like deterministic sub-steps** with gates. Examples are a "governed query" step that always validates SQL against the semantic layer, and fixed document-generation steps that render Excel and Word from a typed result object. Routing in front (simple lookup vs multi-step analysis) sends easy questions to a cheaper path.

### Gaps
- None material. The post is qualitative and gives no accuracy numbers for the patterns.

---

## 7. Extended / interleaved thinking with tool use; reasoning models in agent loops; thinking budgets

### Takeaway
By late 2026, Anthropic has deprecated fixed `budget_tokens` in favor of **adaptive thinking plus an `effort` parameter**. Claude 4.7+ rejects `type: "enabled"`. Adaptive mode interleaves thinking between tool calls automatically. Native interleaved thinking has largely replaced the separate "think" tool. Budget guidance is to start low for simple tasks and higher (16k+) for complex ones, expect diminishing returns, and keep the setting stable within a cached conversation.

### Cited Findings
- Extended thinking with manual `budget_tokens` is a **legacy feature**. "Claude 4.7 and later models do not support it and reject requests that use it, returning a 400 error." The recommended alternative is adaptive thinking (`thinking: {type: "adaptive"}`), with depth controlled by `output_config: {effort: ...}`. — [Claude docs, Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) [fetched Nov 2026]
- Budget tuning (manual mode): the minimum is 1,024 tokens. "For simple tasks, start near the 1,024-token minimum and increase incrementally… For complex tasks, start with a larger budget of 16,000 tokens or more." Higher budgets have "diminishing returns that depend on the task" and cost latency. Above 32k, use batch processing to avoid timeouts. The budget is a target, not a cap. — [Claude docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) [fetched]
- **Interleaved thinking** "lets Claude think between tool calls within a single assistant turn, reasoning about each tool result before determining what to do next". Older models needed the `interleaved-thinking-2025-05-14` beta header. Adaptive thinking interleaves automatically. Opus 4.6 manual mode has no interleaving, and Haiku 4.5 does not support it. In manual interleaved mode the budget can exceed `max_tokens` because it spans all thinking blocks in the turn. — [Claude docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) [fetched]
- Behavioral difference: with a fixed budget Claude thinks on every request. With adaptive thinking it decides whether and how much to think, and at lower effort it "might skip thinking entirely on easy inputs". Opus 5.5 and Haiku 5.5 default to `effort: "medium"`, while other effort-capable models default to `"high"`. — [Claude docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) [fetched]
- Cost and caching: changing the thinking budget or mode between requests **invalidates prompt-cache breakpoints**, so pick a setting and hold it for the conversation. Opus 4.5 and models 4.6+ keep prior turns' thinking blocks in context and bill them as input. — [Claude docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) [fetched]
- Think tool vs extended thinking (Mar 2025 data): on τ-bench airline, extended thinking alone scored pass^1 0.412 vs 0.584 for think tool + optimized prompt. On retail, extended thinking scored 0.770 vs 0.812 for the think tool, *below* the baseline of 0.783. By Dec 2025 Anthropic recommends extended thinking over the think tool "in most cases", presumably because interleaved and adaptive thinking now covers between-tool reasoning. — [Anthropic think tool](https://www.anthropic.com/engineering/claude-think-tool) [fetched]
- Model quality vs token spend: Sonnet 3.7 → Sonnet 4 gave a larger gain than doubling the token budget. — [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system) [fetched]

### Inferences
- For the target agent, use adaptive thinking with a fixed effort level per route (lower for simple lookups, higher for multi-step analyses) and keep it constant within a session for cache efficiency. Spend the thinking budget on the interpretive steps (choosing comparisons, explaining variances) rather than on mechanical document rendering.
- The March 2025 retail result (extended thinking slightly below baseline) is weak evidence that more reasoning doesn't help every tool-use task. Evaluate per task.

### Gaps
- I did not retrieve OpenAI's reasoning-model guidance (o-series or GPT-5 `reasoning_effort`, keeping reasoning items across tool calls via the Responses API) this session. Treat any OpenAI-specific budget numbers as unverified.
- No public benchmark found that measures effort level vs accuracy for data-analysis agents.

---

## 8. Structured outputs / typed final answers and reliability

### Takeaway
Constrained or typed outputs reliably fix *format* adherence (near-100% schema validity). Evidence on *reasoning quality* conflicts: an EMNLP 2024 paper found strict format constraints degrade reasoning, and structured-generation vendors dispute the method. The common mitigation is to let the model reason freely (in thinking or a free-text field), then emit the typed final object.

### Cited Findings
- **"Let Me Speak Freely?"** (Tam et al., EMNLP 2024 Industry): "a significant decline in LLMs' reasoning abilities under format restrictions", and "stricter format constraints generally lead to greater performance degradation in reasoning tasks". Per secondary summaries, classification tasks can improve under structure. — [arXiv 2408.02442](https://arxiv.org/abs/2408.02442); [ACL Anthology](https://aclanthology.org/2024.emnlp-industry.91) [fetched]
- **Conflicting evidence:** dottxt (the Outlines maintainers) published "Say What You Mean: A Response to 'Let Me Speak Freely'", arguing structured generation *improves* performance and criticizing the paper's prompts and benchmarking. HN commenters raised similar methodological points. The vendor has a commercial interest. — [Search summary of the HN thread](https://nextjs-hn-feed.vercel.app/post/46345333) [substance of the rebuttal not retrieved; vendor-authored]
- A Jan 2026 paper, "Thinking Before Constraining", proposes a unified decoding framework that reasons unconstrained and then constrains the final output, i.e. the "think, then structure" mitigation. — [arXiv 2601.07525](https://arxiv.org/html/2601.07525v1) [title only from search; findings not verified]
- OpenAI reported that Structured Outputs (Aug 2024, strict JSON-schema constrained decoding) scored 100% on its complex JSON-schema eval for gpt-4o-2024-08-06, vs under 40% for gpt-4-0613 with prompting alone. — [OpenAI, Introducing Structured Outputs](https://openai.com/index/introducing-structured-outputs-in-the-api/) [prior knowledge, not re-fetched]
- Anthropic's format advice: give the model enough tokens to "think" before committing, keep formats close to naturally occurring text, and avoid formats that need escaping or counting. — [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) [fetched]
- Subagent delegation works better when each subagent is given an explicit **output format**. Vague task specs produced duplicated or misdirected work. — [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system) [fetched]

### Inferences
- For the target agent, the final answer should be a typed object, e.g. `{question, definitions_used, queries:[{id, sql, row_count}], findings:[{vessel, q3_this, q3_last, delta, delta_pct, explanation, evidence_refs}], artifacts:{xlsx, docx}, caveats}`. Excel and Word are rendered from it deterministically, and verifiers check that every number in the prose maps to a `findings` entry. Reasoning happens in thinking or tool steps before the object is emitted, which sidesteps the "Let Me Speak Freely" concern.
- Typed tool *inputs* (strict schemas on the SQL and query tools) are an ACI "poka-yoke" and have no reasoning-cost concern.

### Gaps
- No primary-source quantitative study found of typed final answers in *agent loops* (as opposed to single-shot reasoning tasks).
- The substance of dottxt's rebuttal was not retrieved, so its specific counter-results are unverified.
