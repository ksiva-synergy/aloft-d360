# Evaluating, Observing and Hardening Tool-Using LLM Agent Loops in Production (2024–2026)

Context for the report writer: the target system is an enterprise data-analysis agent (SQL warehouse, knowledge bases, Microsoft 365 files) whose loop is changing (planning tool, budgets, compaction). Notes below are organized by key question. Research date: 2026-11-04. Leaderboard numbers move fast; each is tagged with the source and, where known, its date.

---

## 1. Agent evaluation methods (outcome vs trajectory, tool-call correctness, LLM-as-judge, pass@k vs pass^k, simulated users)

### Takeaway
The 2026 consensus (Anthropic, OpenAI, Hamel Husain) is: grade the outcome first, using environment end-state where possible. Add step-level checks of tool choice, arguments and results only to diagnose failures. Use code-based graders wherever a rule can decide, and LLM judges only for nuance, each judge built per failure mode and calibrated against human labels (TPR/TNR). Report pass^k (consistency) rather than pass@k for user-facing agents. Simulated-user multi-turn evals (tau-bench family) show large reliability gaps that single-trial accuracy hides.

### Cited Findings
**Anthropic, "Demystifying evals for AI agents" (Jan 9, 2026; Grace, Hadfield, Olivares, De Jonghe)**
- Defines task, trial, grader, transcript (trace/trajectory) and outcome. The outcome is "the final state of the environment after a trial": for a flight-booking agent, whether a reservation exists in the DB, not whether the agent said it booked one. It also separates the *evaluation harness* from the *agent harness/scaffold*. — [Anthropic Engineering](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- Three grader types:
  - Code-based (string match, unit tests, static analysis, tool-call/transcript checks): fast, cheap, reproducible, but brittle.
  - Model-based (rubrics, NL assertions, pairwise, reference-based, multi-judge): flexible, but non-deterministic and in need of human calibration.
  - Human (SME review, A/B, inter-annotator agreement): gold standard, but slow.
  - Scores can be weighted, binary (all graders must pass) or hybrid. — [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- "Grade what the agent produced, not the path it took." Avoid rigid checks on exact tool-call sequences, because agents find valid unanticipated paths. Use partial credit for multi-part tasks, and make graders hack-resistant. — [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- pass@k is the probability of at least one success in k trials; pass^k is the probability that all k succeed. Worked example: a 75% per-trial success rate gives pass^3 ≈ 42%. By k=10, pass@k approaches 100% while pass^k approaches 0%. Use pass^k for customer-facing, consistency-critical agents. — [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- LLM-judge calibration:
  - Calibrate against human experts.
  - Give the judge an "Unknown" escape hatch to reduce hallucinated grades.
  - Use structured rubrics, grading each dimension with a separate isolated judge.
  - — [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- Grader bugs can dominate scores. Opus 4.5 initially scored 42% on CORE-Bench because of rigid grading (rejecting "96.12" when "96.124991…" was expected), ambiguous specs and irreproducible tasks. It reached 95% after fixes and a less constrained scaffold. With frontier models, 0% across many trials (even pass@100) usually means a broken task or grader. — [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- Each trial must start from a clean, isolated environment. In one case Claude read git history from earlier trials and gained an unfair advantage. Shared resource limits make trials non-independent. — [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- Test both "should" and "should not" behaviors. Claude.ai web-search evals needed many rounds to balance under- and over-triggering. — [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

**Hamel Husain / Shreya Shankar, Evals FAQ (hamel.dev)**
- Error analysis is "the most important activity in evals":
  - Read traces, open-code the failures, then group them into a taxonomy.
  - Review at least 30 traces yourself before letting an LLM suggest categories.
  - Keep a working pool of about 100 diverse traces.
  - The authors spend "60-80% of our development time on error analysis and evaluation."
  - — [Hamel Husain Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)
- Use binary pass/fail rather than 1–5 Likert scales. Prefer code assertions when a rule can detect the failure. Build one LLM judge per failure mode, not an overall-quality judge. Avoid generic metrics (helpfulness, BERTScore, ROUGE). — [Hamel Husain](https://hamel.dev/blog/posts/evals-faq/)
- Judge validation: label about 100–200 examples per failure mode, split them into train/dev/test, and measure TPR and TNR against human labels. "Once you know your judge's True Positive and True Negative rates, you can correct its estimates." — [Hamel Husain](https://hamel.dev/blog/posts/evals-faq/)
- Agent evaluation in two phases. Phase 1 is outcome-first: a black-box success rule per task, recording the first upstream failure. Phase 2 adds step-level diagnostics: tool choice, parameter extraction, error handling, context retention, efficiency (steps, seconds, tokens) and goal checkpoints. "Errors cascade in LLM chains," so fix early-stage failures first. — [Hamel Husain](https://hamel.dev/blog/posts/evals-faq/)
- Transition failure matrix: rows are the last successful state, columns the first failed state. The worked example shows GenSQL → ExecSQL causing 12 failures versus 2 for DecideTool → PlanCal, so investigate the hotspots first. This applies directly to a SQL agent. — [Hamel Husain](https://hamel.dev/blog/posts/evals-faq/)
- Tool-call evaluation: check the tool name, arguments, result and resulting state as separate checks, plus authorization and preconditions ("a well-formed call can still be wrong if the user never approved the action"). — [Hamel Husain](https://hamel.dev/blog/posts/evals-faq/)
- RAG: evaluate retrieval separately with Recall@k, Precision@k and MRR. Then evaluate generation with context relevance (C|Q), faithfulness (A|C) and answer relevance (A|Q). — [Hamel Husain](https://hamel.dev/blog/posts/evals-faq/)

**OpenAI agent evals / trace grading**
- OpenAI recommends a two-stage flow: trace grading while debugging ("the fastest way to identify workflow-level issues"), then datasets and eval runs for repeatable benchmarking. Trace graders answer questions such as "did the agent choose the correct tool? did a handoff occur when it should? did the workflow break an instruction or policy?" — [OpenAI Agent evals guide](https://developers.openai.com/api/docs/guides/agent-evals)

**pass^k and simulated users (tau-bench / Sierra)**
- tau-bench (Yao, Shinn, Razavi, Narasimhan; Sierra; June 2024):
  - The agent talks to an LLM-simulated user, uses domain API tools and follows a policy document.
  - It is graded by comparing the end-of-conversation DB state with an annotated goal state.
  - It introduced pass^k. gpt-4o-class function-calling agents solved <50% of tasks, and pass^8 was <25% in retail.
  - — [arXiv 2406.12045](https://arxiv.org/abs/2406.12045)
- tau2-bench (Barres, Dong, Ray, Si, Narasimhan; June 2025) adds a dual-control Telecom domain (a Dec-POMDP where both agent and user act on a shared environment), a compositional task generator and an environment-coupled user simulator. Agents show "significant performance drops" moving from no-user to dual-control. — [arXiv 2506.07982](https://arxiv.org/abs/2506.07982)

**LLM-as-judge reliability**
- Position bias in capable LLM judges is systematic, not random noise. Its direction shifts by task even for the same judge. It is strongly affected by the quality gap between candidates and only weakly by prompt length. (Shi et al., IJCNLP-AACL 2025.) — [arXiv 2406.07791](https://arxiv.org/html/2406.07791v9)
- A 2026 AMCIS paper reports position bias (one definition preferred 65.7% of the time), self-preference of up to +73.3 pp when a model judges its own output, and inter-judge Fleiss' κ = 0.357. — [AMCIS 2026](https://aisel.aisnet.org/amcis2026/sig_svs/svs/1)
- Vendor blog (secondary, treat with caution): exact-match agreement overstated 21 LLM judges by 33–41 points versus Cohen's κ on MT-Bench. — [Kili Technology](https://kili-technology.com/blog/data-story-who-judges-the-judge-llm-as-a-judge)
- MAST's LLM-judge annotator (o1, few-shot) reached accuracy 0.94 and κ = 0.77 against humans (zero-shot: accuracy 0.89, κ = 0.58). Human-human κ was 0.88. Accuracy and κ diverge sharply, so report κ or TPR/TNR, not raw agreement. — [MAST arXiv 2503.13657v3](https://arxiv.org/html/2503.13657v3)

### Inferences
- For the data-analysis agent, the "outcome" should mean a verifiable artifact wherever possible: the result set of the final SQL (execution-match against a reference query/result), the cited KB/M365 document IDs, and the numeric answer within a tolerance. A judge should grade the narrative separately. Anthropic's CORE-Bench anecdote argues for numeric tolerance in answer matching.
- Report pass^k (k=3–5) on a regression set when loop changes such as compaction or budget limits are made. Non-determinism changes there may not move pass@1 but will move pass^k.
- Raw "agreement %" for judges is misleading. Require TPR/TNR or κ on a held-out human-labeled split before trusting a judge in a CI gate.

### Gaps
- I did not fetch the Sierra blog post on pass^k directly. tau-bench arXiv is the primary source used.
- OpenAI's grader-type catalog (string check, text similarity, score model, python, label model) is in the separate Evals guide, which I did not fetch. Only the trace-grading page was verified.
- I found no primary 2025–2026 study quantifying how well LLM judges grade *tool-call trajectories* specifically, as opposed to final outputs. Agent-as-a-judge literature was not retrieved.

---

## 2. Benchmarks for data/analysis agents and tool use: what they measure and SOTA

### Takeaway
Single-shot text-to-SQL is near saturation on BIRD: about 83% test EX versus a 93% human baseline. Enterprise, agentic SQL is still hard: Spider 2.0-Lite tops out around 76%, Spider 2.0-DBT around 66%, BIRD-Interact around 17%. Data-science and analysis benchmarks (DA-Code, DSBench) had about 30–34% best scores at release. Conversational tool-use benchmarks (tau2) are around 85–88% pass^1 for frontier models, but newer knowledge-retrieval variants (tau3-Banking) are around 55%. Treat third-party leaderboard aggregators with caution; several numbers below conflict.

### Cited Findings
**Text-to-SQL**
- **Spider 2.0 (XLANG Lab; enterprise text-to-SQL workflows)**
  - Settings and sizes: Snow has 547 examples, all Snowflake. Lite has 547 (BigQuery 214, Snowflake 198, SQLite 135). DBT has 68 repository-level DuckDB/DBT tasks.
  - Tasks require long contexts, multiple dialects and multi-query workflows, often producing >100-line SQL.
  - Original baselines: o1-preview solved 17.1% and GPT-4o 10.1% (versus 86.6% on Spider 1.0).
  - Current leaderboard tops, with no per-entry dates on the page:
    - Snow: Genloop Sentinel Agent v2 Pro, 96.70; Native mini, 96.53; QUVI-3 + Gemini-3-pro-preview, 94.15.
    - Lite: Tianqiong Data Agent + GLM 5.2, 76.23; DecisionX Agent, 74.95.
    - DBT: SignalPilot Agent, 65.6; Databao Agent, 60.29.
  - — [Spider 2.0 site](https://spider2-sql.github.io/)
  - The Snow scores in the mid-90s contrast sharply with Lite in the mid-70s. A web-search summary (not verified against the paper) says ReFoRCE claimed SOTA of 35.83 on Snow and 36.56 on Lite in 2025. The Snow jump may reflect agent systems with heavy Snowflake-specific engineering or evaluation changes, so treat it cautiously. — [Spider 2.0 site](https://spider2-sql.github.io/); Spider 2.0 paper: [arXiv 2411.07763](https://www.arxiv.org/pdf/2411.07763)
- **BIRD (execution accuracy, test)**
  - Overall leaderboard top: AskData (AT&T), 83.40 (Oct 22, 2026); GrainSQL, 82.95 (Sep 26, 2026); Huawei DataGallery-Text2SQL, 82.39 (Sep 7, 2026).
  - Human performance is 92.96.
  - Single-model leaderboard top: Google Gemini-SQL2, 80.04; JPMorganChase ReToolSQL, 78.14.
  - BIRD also reports R-VES (an efficiency-weighted metric); human R-VES is 83.26.
  - — [BIRD leaderboard](https://bird-bench.github.io/)
- **BIRD-Interact (ICLR 2026 Oral; interactive/agentic SQL)**: GPT-5 (Med) reached 8.67% SR on c-Interact and 17.00% on a-Interact (Oct 2025). **LiveSQLBench** Base-Full-V1: Gemini-2.5-pro 28.67 (colloquial) / 35.67 (normal). **BIRD-Critic** covers SQL debugging. — [BIRD leaderboard](https://bird-bench.github.io/)

**Data-science / analysis agents**
- **DA-Code** (EMNLP 2024): 500 tasks from real data-analysis work (wrangling, ML, EDA). The best LLMs with the DA-Agent baseline reached 30.5% accuracy. Metrics are score, completion rate within 20 steps, average steps, and the share of executable code. — [ACL Anthology](https://aclanthology.org/2024.emnlp-main.748); [arXiv 2410.07331](https://arxiv.org/pdf/2410.07331)
- **DSBench** (Jing et al., Sept 2024): 466 data-analysis tasks (ModelOff/Kaggle) and 74 data-modeling tasks. The best analysis result was AutoGen + GPT-4o at 34.12%, versus vanilla GPT-4o at 23.39%. A secondary summary gives a human benchmark of 64.06% task-level. — [arXiv 2409.07703](https://arxiv.org/pdf/2409.07703)

**Tool use / function calling**
- **BFCL V4 (Berkeley)** adds agentic categories: web search (100 human-crafted multihop questions), memory (kv / vector / recursive-summary) and format sensitivity. Overall-score weights are Agentic 40%, Multi-Turn 30%, Live 10%, Non-Live 10%, Hallucination 10%. — [Gorilla BFCL V4 blog](https://gorilla.cs.berkeley.edu/blogs/15_bfcl_v4_web_search.html); [evalscope BFCL v4 docs](https://evalscope.readthedocs.io/en/latest/third_party/bfcl_v4.html). I could not retrieve the live leaderboard. An aggregator's frontier-model overall scores of about 70–77% are unverified. — [benchmarklist](https://benchmarklist.com/benchmarks/bfcl_v4/)
- **tau-bench family leaderboard (taubench.com)**
  - tau2-bench (retail/airline/telecom, pass^1): Qwen3.5-397B-A17B 87.9%, Gemini 3.0 Pro 85.4%, Claude Opus 4.5 85.3%.
  - tau3-Banking (knowledge retrieval, March 2026): Qwen 3.8 Max 55.2%, Claude Opus 5 48.7%, Grok 4.5 47.9%.
  - In Feb 2026, 50+ airline/retail tasks were audited and corrected; it is unclear whether scores were rerun.
  - — [taubench.com](https://taubench.com/)

**General agents**
- **GAIA**: the sources conflict.
  - A secondary report puts the top HAL (Princeton) agent with Claude Sonnet 4.5 at 74.55% overall (human about 92%), with about 65% on Level 3. — [beancount.io research log](https://beancount.io/bean-labs/research-logs/2026/06/16/gaia-benchmark-general-ai-assistants); [HAL GAIA via benchmarklist](https://benchmarklist.com/benchmarks/hal_gaia/)
  - An April 2026 blog claims Writer Action Agent leads Level 3 at 61%. — [agentmarketcap](https://agentmarketcap.ai/blog/2026/04/06/gaia-benchmark-2026-general-agent-leaderboard-swe-bench-alternative)
  - Only test-set scores are comparable. Unverified.
- **TheAgentCompany** (simulated software company; checkpoint-based partial credit): Gemini 2.5 Pro fully completed 30.3% of tasks (39.3% with partial credit) in the paper's runs. An aggregator claims 52.4% for DeepSeek-V3.2-Exp (Aug 2026), unverified. — [arXiv 2412.14161v3](https://arxiv.org/html/2412.14161v3); [anotherwrapper aggregator](https://anotherwrapper.com/tools/llm-pricing/evals/the-agent-company)
- **AppWorld** (state-based unit tests that check DB changes, which penalizes collateral side effects): the 2024 best on test-challenge was GPT-4o ReAct at about 30.2% TGC / 13.0% SGC. 2026 aggregator entries show about 89–91% TGC on test-normal, not test-challenge. — [AppWorld review](https://liner.com/review/appworld-controllable-world-apps-and-people-for-benchmarking-interactive-coding); [alphaxiv AppWorld](https://alphaxiv.org/benchmarks/allen-institute-for-ai/appworld); [wizwand AppWorld](https://www.wizwand.com/sota/agentic-tool-use-on-appworld-normal)

### Inferences
- For an enterprise warehouse agent, Spider 2.0-Lite/Snow and BIRD-Interact are the closest public proxies. BIRD's 80%+ single-shot numbers overstate what to expect on messy enterprise schemas. The jump from 17% at Spider 2.0 launch to about 76% on Lite in two years suggests agentic scaffolding (schema exploration, iteration, self-correction) is the dominant lever.
- AppWorld-style and tau-style state-based grading (end DB state, collateral-damage checks) is the right template for internal evals of any write-capable tools (e.g., M365 file edits).
- Public benchmarks are not a substitute for an in-domain golden set. Several leaderboards had task or grader fixes (tau-bench Feb 2026; Spider 2.0 2024–2025), which confirms Anthropic's warning about grader bugs.

### Gaps
- InfiAgent-DABench numbers were not retrieved.
- Live BFCL V4 and official GAIA/HAL, TheAgentCompany and AppWorld leaderboards were not retrieved directly. The numbers above for those come from aggregators and are flagged.
- tau2-bench per-domain and pass^k values were not shown on the leaderboard page.
- No public benchmark specifically covers Microsoft 365 file/KB retrieval for analytics agents that I found.

---

## 3. Golden sets from production traces; CI regression gates; A/B and shadow runs

### Takeaway
Start small (20–50 tasks from real failures, per Anthropic) and grow toward about 100+ CI examples (per Hamel). Split the suite into "capability" evals, which start with low pass rates, and "regression" evals, which should sit near 100%. Graduate capability tasks into regression once they pass. In CI, favor deterministic assertions over judges. Run judges on sampled production traces asynchronously, and use A/B tests for significant changes when there is enough traffic.

### Cited Findings
- Start with 20–50 simple tasks drawn from real failures; early changes have large effects, so small samples suffice. Turn bug-tracker and support-queue issues into test cases prioritized by user impact. Each task should be unambiguous (two domain experts reach the same verdict) and have a reference solution that passes all graders. — [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- Capability evals should start at low pass rates; regression evals should sit near 100%. Capability tasks "graduate" into the continuously running regression suite. Watch for saturation: SWE-bench Verified went from about 30% to >80% in a year. — [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- Anthropic's layered "Swiss cheese" model:
  - Automated evals for CI/CD and every model upgrade.
  - Production monitoring for drift.
  - A/B tests for significant changes with enough traffic.
  - User feedback, which is sparse and skewed toward severe issues.
  - Manual transcript review.
  - Systematic human studies to calibrate graders.
  - A dedicated evals team owns the infrastructure, while domain experts and product teams contribute tasks.
  - — [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- CI needs small, purpose-built datasets ("100+ examples" in many cases) covering core features, past bugs and edge cases. "Favor assertions or other deterministic checks over LLM-as-judge evaluators" in CI. Production evals should sample live traces with asynchronous, reference-free judges, track confidence intervals, and investigate when the lower bound crosses the threshold. Add representative production failures back to CI. — [Hamel Husain](https://hamel.dev/blog/posts/evals-faq/)
- Cadence by cost and saturation:
  - Cheap code assertions run on every change.
  - New-policy judges with 0% passing run as often as possible.
  - Smaller-model judges run nightly.
  - High-stakes judges run before each release.
  - Online: cheap checks on every trace, an expensive judge on a nightly sample.
  - Re-run error analysis on 100+ fresh traces every 2–4 weeks or after significant changes.
  - — [Hamel Husain](https://hamel.dev/blog/posts/evals-faq/)
- Sampling for golden sets: combine random and targeted sampling and keep some random traces in every batch. Synthetic data should be generated from structured dimensions (tuples first, then NL queries), but never used to estimate production failure rates. For sensitive data, prefer permitted access to real data, then in-place expert review, then redacted traces, with synthetic as a last resort. — [Hamel Husain](https://hamel.dev/blog/posts/evals-faq/)
- Report a "pass-all rate" across binary checks with drill-down, and avoid complicated weighted composites. Hamel argues against eval-driven development ("write evaluators for failures you observe, not ones you imagine"). Anthropic recommends it for planned capabilities. — [Hamel Husain](https://hamel.dev/blog/posts/evals-faq/); contrasted with [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- OpenAI's workflow: high-signal traces lead to graders on traces, then datasets and eval runs for prompt comparisons and regression over time. — [OpenAI](https://developers.openai.com/api/docs/guides/agent-evals)

### Inferences
- A practical gate for the agent's loop changes (planning tool, budgets, compaction):
  - Block merges if the regression suite's pass^k drops (e.g., k=3), using deterministic SQL-result and citation checks.
  - Report capability-suite deltas with confidence intervals but do not block on them.
  - Run a nightly judge-based suite on a sample of production traces.
- Shadow runs are a natural fit for read-only analytics tools: replay production questions through the candidate loop against the same warehouse snapshot and diff the outcomes. They are unsafe for write tools unless tools are mocked or sandboxed. Anthropic's clean-environment rule applies.
- Compaction changes specifically need long-horizon tasks in the golden set. MAST's "loss of conversation history" (2.8%) and "step repetition" (15.7%) modes are the likely regressions (see section 5).

### Gaps
- I found no primary source with quantified guidance on shadow deployment for LLM agents specifically, or on sample sizes and statistical power for agent A/B tests. Only qualitative guidance ("enough traffic") was found.
- Vendor-specific CI integrations (LangSmith/Braintrust/Langfuse experiment runners) were not documented from primary docs in this pass.

---

## 4. Observability: OpenTelemetry GenAI conventions, tracing tools, what to log, privacy

### Takeaway
OpenTelemetry's GenAI semantic conventions define `invoke_agent`, `create_agent` and `execute_tool` spans with token-usage, model, conversation-ID and error attributes. They remain at "Development" (experimental) stability and moved in 2025–2026 to a dedicated repo (`semantic-conventions-genai`). Prompt and response content capture is explicitly opt-in because of PII. Tool choice: Langfuse is MIT open source (acquired by ClickHouse, Jan 2026); Arize Phoenix is source-available (ELv2) and self-hostable; LangSmith and Braintrust are commercial (LangSmith self-hosting is Enterprise-only); AWS AgentCore Observability is OTel-compatible and CloudWatch-backed.

### Cited Findings
**OpenTelemetry GenAI semantic conventions**
- The GenAI conventions "have moved to the OpenTelemetry GenAI semantic conventions repository" and are no longer maintained in the core semconv repo. The new repo covers spans, metrics and events, MCP, and provider-specific conventions (e.g., OpenAI). — [opentelemetry.io notice](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/); [GitHub semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai)
- Stability is **Development**. Instrumentations should not change their default emitted version; users opt in via `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`. — [OTel semconv v1.37.0 agent spans](https://github.com/open-telemetry/semantic-conventions/blob/v1.37.0/docs/gen-ai/gen-ai-agent-spans.md)
- Agent span types and attributes:
  - `create_agent {gen_ai.agent.name}` and `invoke_agent {gen_ai.agent.name}`, both span kind CLIENT. `execute_tool` is defined in the general GenAI spans doc.
  - Required: `gen_ai.operation.name` and `gen_ai.provider.name`.
  - Conditionally required: `error.type`, `gen_ai.agent.id`/`name`/`description`, `gen_ai.conversation.id`, `gen_ai.data_source.id`, `gen_ai.request.model`.
  - Recommended: `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`, `gen_ai.response.model`, request params.
  - Operation names: `chat`, `create_agent`, `embeddings`, `execute_tool`, `generate_content`, `invoke_agent`, `text_completion`.
  - — [OTel v1.37.0](https://github.com/open-telemetry/semantic-conventions/blob/v1.37.0/docs/gen-ai/gen-ai-agent-spans.md)
- Privacy: `gen_ai.input.messages`, `gen_ai.output.messages` and `gen_ai.system_instructions` are **Opt-In** because they are "likely to contain sensitive information, including user PII." Instrumentations may filter or truncate this content. — [OTel v1.37.0](https://github.com/open-telemetry/semantic-conventions/blob/v1.37.0/docs/gen-ai/gen-ai-agent-spans.md)
- Implementations (secondary, vendor docs):
  - `execute_tool` is one span per tool invocation, carrying the tool name and call ID.
  - `gen_ai.tool.call.arguments` is captured only with content capture enabled.
  - `gen_ai.usage.cache_read.input_tokens` sits on model-call or agent spans, not tool spans.
  - — [VS Code Copilot monitoring agents with OTel](https://code.visualstudio.com/docs/agents/guides/monitoring-agents); [groundcover attributes](https://docs.groundcover.com/use-groundcover/ai-observability/attributes); [TanStack AI OTel](https://tanstack.com/ai/latest/docs/advanced/otel.md?framework=vue)

**AWS Bedrock AgentCore Observability**
- Three pillars: tracing/telemetry, metrics/monitoring and audit logging.
- Emits OTel-compatible telemetry. CloudWatch dashboards cover session count, latency, duration, token usage and error rates. Built-in metrics cover agents, gateway and memory resources, and you can add custom spans and metrics.
- All data is stored in CloudWatch. The trace-visualization dashboard is for agent-runtime data only.
- CloudTrail audits Gateway and Registry API activity.
- — [AWS AgentCore docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability.html)

**Tracing platforms: open source vs commercial**
- **Langfuse**: OSS under MIT, self-hostable, with the same MIT core for cloud and self-hosted. Acquired by ClickHouse in January 2026. — [dev.to 2026 comparison](https://dev.to/gabrielanhaia/langfuse-vs-langsmith-vs-phoenix-vs-braintrust-the-honest-2026-comparison-253p); [Langfuse compare (vendor)](https://langfuse.com/compare)
- **Arize Phoenix**: source-available under Elastic License 2.0 (not OSI open source), self-hostable with no feature gates. — [Arize alternatives (vendor)](https://arize.com/compare/arize-alternatives/); [dev.to comparison](https://dev.to/gabrielanhaia/langfuse-vs-langsmith-vs-phoenix-vs-braintrust-the-honest-2026-comparison-253p)
- **LangSmith**: the SDK is MIT, the platform closed. Self-hosting is listed as Enterprise-only (some sources say cloud-only; they conflict). — [Langfuse compare](https://langfuse.com/compare); [futureagi LangSmith alternatives](https://futureagi.com/blog/langsmith-alternatives-2026)
- **Braintrust**: closed source with a vendor-run control plane. — [Langfuse compare](https://langfuse.com/compare)
- Caveat: the comparison pages are vendor-published (Langfuse, Arize). Verify licensing on current docs.

**Request IDs and per-step logging hooks (Claude API, as an example provider)**
- Every response has a `request-id` header (also `request_id` in error bodies), exposed by the SDKs as `_request_id`. It should be logged per step for support and debugging. Streaming responses can error mid-stream after HTTP 200, so their errors need separate handling. — [Claude API errors](https://platform.claude.com/docs/en/api/errors)

### Inferences
- Minimum per-step record for the data agent:
  - Trace and conversation ID; agent/loop version; model; `invoke_agent` / `chat` / `execute_tool` span hierarchy.
  - Input, output and cache-read/cache-write tokens; latency, plus time to first token for streamed turns.
  - Tool name and call ID; tool status and `error.type`; retry count; provider request-id.
  - SQL text hash plus rows returned and bytes scanned or warehouse cost; cited doc IDs for KB/M365.
  - Compaction events (tokens before and after); budget remaining.
- Keep message content opt-in and redacted by default, as OTel recommends. M365 and warehouse rows are likely to contain PII. Store content in a separate access-controlled store keyed by span ID if it is needed for golden-set mining.
- Because the GenAI semconv is still "Development," pin the convention version and expect attribute renames. Abstract logging behind a thin internal schema.

### Gaps
- I could not fetch the authoritative `gen-ai-spans.md` (execute_tool attributes) or the GenAI metrics doc (`gen_ai.client.token.usage`, `gen_ai.client.operation.duration`, time-to-first-token metrics) from the new repo. Exact names and stability of cache-token and TTFT attributes are confirmed only via vendor implementations.
- I did not fetch primary docs for LangSmith, Braintrust or Phoenix features (online evaluators, datasets, annotation queues), so feature-level comparison is not sourced here.
- Microsoft (Azure AI Foundry) agent observability was not researched in this pass. It may be relevant given the M365 data sources.

---

## 5. Reliability engineering: failure taxonomies, loop detection, retries/backoff, idempotency, prompt-injection defenses

### Takeaway
Empirical taxonomies (MAST) show that the most common agent failures are system-design issues rather than raw model errors: step repetition (15.7%), reasoning-action mismatch (13.2%), unawareness of termination conditions (12.4%) and weak verification (17.3% combined). Targeted fixes such as verification steps yield gains of up to +15.6%. For prompt injection from tool results (warehouse rows, documents, emails), the strongest 2025 guidance is architectural: CaMeL, Dual LLM, plan-then-execute, code-then-execute. Prompt-level defenses like spotlighting help but are not guarantees.

### Cited Findings
**Failure taxonomies**
- MAST ("Why Do Multi-Agent LLM Systems Fail?", v3 Oct 2025):
  - 14 failure modes in 3 categories, built from 150 traces and applied to 1,600+ annotated traces from 7 multi-agent frameworks.
  - Human inter-annotator κ = 0.88.
  - — [arXiv 2503.13657](https://arxiv.org/abs/2503.13657)
- MAST prevalence:

  | Category | Failure mode (ID) | Prevalence |
  |---|---|---|
  | System design | Disobey task specification (FM-1.1) | 11.8% |
  | System design | Disobey role specification (FM-1.2) | 1.5% |
  | System design | Step repetition (FM-1.3) | 15.7% |
  | System design | Loss of conversation history (FM-1.4) | 2.8% |
  | System design | Unaware of termination conditions (FM-1.5) | 12.4% |
  | Inter-agent | Conversation reset (FM-2.1) | 2.2% |
  | Inter-agent | Fail to ask for clarification (FM-2.2) | 6.8% |
  | Inter-agent | Task derailment (FM-2.3) | 7.4% |
  | Inter-agent | Information withholding (FM-2.4) | 0.85% |
  | Inter-agent | Ignored other agent's input (FM-2.5) | 1.9% |
  | Inter-agent | Reasoning-action mismatch (FM-2.6) | 13.2% |
  | Verification | Premature termination (FM-3.1) | 6.2% |
  | Verification | No/incomplete verification (FM-3.2) | 8.2% |
  | Verification | Incorrect verification (FM-3.3) | 9.1% |

  Many verifiers perform only superficial checks, such as confirming that code compiles. — [MAST v3 HTML](https://arxiv.org/html/2503.13657v3)
- MAST interventions on ChatDev: better role specs and workflow gave +9.4% task success. A high-level task-objective verification step gave +15.6%. The authors conclude that tactical fixes do not resolve all failures and that structural redesign is needed. — [MAST v3 HTML](https://arxiv.org/html/2503.13657v3)
- Tool-call error studies:
  - "Butterfly Effects in Toolchains" (EMNLP 2025 Findings) builds a grounded-theory taxonomy of 5 categories of parameter-filling failures. — [arXiv 2507.15296](https://arxiv.org/pdf/2507.15296)
  - "Hell or High Water" (2025) studies recovery from external tool failures. It finds tool *search* is the most common failure point for all models tested; its categories are search, ID, chaining and tool-use failures. — [arXiv 2508.11027](https://arxiv.org/pdf/2508.11027)
  - AgentRX (2026) reports 9 cross-domain root-cause categories. — [arXiv 2602.02475](https://www.arxiv.org/pdf/2602.02475)
  - An ICML 2026 stage-aware taxonomy for MCP tool agents uses Routing, Request/Parameter and Runtime failure stages. — [ICML 2026](https://icml.cc/virtual/2026/77938)
  - AssetOpsBench (881 trajectories) found system design to be the most common failure source. — [arXiv 2506.03828](https://arxiv.org/pdf/2506.03828)

**Retries, throttling, long requests (Claude API as concrete example)**
- 429 `rate_limit_error`: rate limit or spend cap. A tier spend-cap 429 has **no** `retry-after` header and keeps failing, so do not retry it blindly. Sharp usage increases can trigger 429s from acceleration limits; ramp traffic gradually.
- 529 `overloaded_error`: API-wide overload.
- 500 `api_error`: retry with exponential backoff.
- 504 / `timeout_error`: use streaming for long requests.
- The SDKs auto-retry connection errors, 429 and 5xx with exponential backoff, **twice by default**, honoring `retry-after`; this is configurable via `max_retries`.
- Use streaming or the Batch API for requests longer than 10 minutes.
- — [Claude API errors](https://platform.claude.com/docs/en/api/errors)

**Prompt injection from tool results**
- **CaMeL** (Debenedetti, Shumailov, Carlini, Tramèr et al., Google DeepMind/ETH; Mar 2025, rev. Jun 2025):
  - Extracts control and data flow from the trusted user query, so untrusted retrieved data cannot change program flow.
  - Enforces capability-based security policies at tool-call time to stop private-data exfiltration.
  - On AgentDojo it solves 77% of tasks with provable security, versus 84% for an undefended system.
  - — [arXiv 2503.18813](https://arxiv.org/abs/2503.18813)
- **Design Patterns for Securing LLM Agents** (Beurer-Kellner, Tramèr, Debenedetti et al., June 2025). Six patterns:
  - Action-Selector
  - Plan-Then-Execute
  - LLM Map-Reduce
  - Dual LLM (a privileged LLM with tools never sees untrusted data; a quarantined LLM without tools processes it and returns references)
  - Code-Then-Execute (the CaMeL style)
  - Context-Minimization
  - Core principle: once an agent has ingested untrusted input, it should be structurally unable to trigger consequential actions. "No single pattern is likely to suffice."
  - — [arXiv 2506.08837v3](https://arxiv.org/html/2506.08837v3)
- **SQL-agent case study** in the same paper:
  - Risks: injection via user or DB content leading to unauthorized access or modification, RCE in the Python interpreter, and DoS.
  - Recommended: code-then-execute so the LLM does not read DB results directly, a sandboxed interpreter, and user confirmation or guardrails.
  - Trade-off: the agent loses the ability to judge whether results are sufficient, and sandboxing does not stop leakage via outputs or visualizations.
  - The email/calendar case covers data exfiltration and unauthorized sends; it pairs user confirmation with plan-then-execute or Dual LLM.
  - — [arXiv 2506.08837v3](https://arxiv.org/html/2506.08837v3)
- **Spotlighting** (Hines et al., Microsoft, Mar 2024) is a family of input transformations that give the model a continuous provenance signal. On GPT-family models it cut indirect-injection attack success from >50% to <2% with minimal task impact. — [arXiv 2403.14720](https://arxiv.org/abs/2403.14720)
- Guardrails versus evaluators: inline guardrails must be fast and deterministic (a few ms: regexes, schema validators, light classifiers). "You would almost never use a slow or non-deterministic LLM-as-Judge as a synchronous guardrail." A cascade that sends only borderline cases to a judge is acceptable. — [Hamel Husain](https://hamel.dev/blog/posts/evals-faq/)

### Inferences
- **Loop detection** maps directly to MAST FM-1.3 (step repetition, the top mode at 15.7%) and FM-1.5 (termination). Practical controls:
  - Hash (tool name + normalized args) per step and stop or replan after N identical calls.
  - Enforce a hard step and token budget with a graceful "partial answer" exit.
  - Add an explicit final verification step; MAST shows verification interventions give the largest gains.
- **Idempotency**: read-only SQL and KB queries are naturally retry-safe. Any write tool (M365 file edits, scheduled jobs) needs idempotency keys keyed on the tool call ID so that SDK-level and loop-level retries don't double-apply. AppWorld's collateral-damage grading is a good test for this.
- **Retry layering**: SDK retries (2 by default) plus loop-level retries plus warehouse retries can multiply. Cap total retries per step, treat spend-cap 429s (no `retry-after`) as terminal, and log retry counts per span.
- **Injection posture for this agent**: warehouse rows, KB documents and M365 files are all untrusted tool output. The cheapest robust step is to keep the planner from executing consequential actions after reading untrusted content (plan-then-execute, or Dual LLM for summarizing documents), plus spotlighting/datamarking of tool results. CaMeL's 77% versus 84% utility cost on AgentDojo gives a reference trade-off.

### Gaps
- I did not find primary 2025–2026 empirical data on loop-detection techniques or their effectiveness. The recommendations above are inferences from MAST.
- No primary source on idempotency patterns specific to LLM tool calls was retrieved.
- Spotlighting's specific sub-methods (delimiting, datamarking, encoding) and per-method numbers were not confirmed from the abstract; the full paper is needed.
- Anthropic and OpenAI first-party prompt-injection guidance for tool results (e.g., classifier-based defenses) was not fetched in this pass.

---

## 6. Metrics to track for an analytics agent

### Takeaway
Track a small, layered set:
- Outcome: task success measured as pass-all of binary checks, plus pass^k on the regression suite.
- Answer quality: SQL execution accuracy against a reference; groundedness/faithfulness and citation correctness; retrieval Recall@k.
- Efficiency: steps per task, tokens (with cache hits), latency and TTFT, cost per *successful* task.
- Reliability: tool error rate, retries, loop/budget exhaustion, abandonment.
Most of these have established definitions in benchmarks (BIRD EX/R-VES, DA-Code completion rate and steps) or in eval guidance (Hamel, Anthropic). Cost per successful task and abandonment lacked primary-source definitions in this research.

### Cited Findings
- **Task success / consistency**: pass@k versus pass^k (75% per trial gives pass^3 ≈ 42%). — [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents). tau-bench pass^8 <25% in retail for gpt-4o-era agents. — [arXiv 2406.12045](https://arxiv.org/abs/2406.12045)
- **Partial credit / checkpoints**: TheAgentCompany reports full completion (binary: all checkpoints) and a partial-credit score side by side (30.3% vs 39.3% for Gemini 2.5 Pro). — [arXiv 2412.14161v3](https://arxiv.org/html/2412.14161v3). Anthropic recommends partial credit for multi-part tasks. — [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- **SQL correctness**: execution accuracy (EX) is the standard. BIRD also reports R-VES, a reward-based valid efficiency score, which accounts for query efficiency (human R-VES 83.26). — [BIRD leaderboard](https://bird-bench.github.io/)
- **Groundedness / citation**: retrieval Recall@k, Precision@k and MRR; then context relevance (C|Q), faithfulness (A|C) and answer relevance (A|Q). — [Hamel Husain](https://hamel.dev/blog/posts/evals-faq/)
- **Efficiency**: steps, seconds and tokens per task as step-level diagnostics. — [Hamel Husain](https://hamel.dev/blog/posts/evals-faq/). DA-Code reports completion rate within 20 steps, average steps and executable-code share. — [arXiv 2410.07331](https://arxiv.org/pdf/2410.07331)
- **Ops metrics**: session count, latency, duration, token usage and error rates as built-in metrics. — [AWS AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability.html). OTel recommended attributes are input/output tokens, finish reasons and `error.type`. — [OTel v1.37.0](https://github.com/open-telemetry/semantic-conventions/blob/v1.37.0/docs/gen-ai/gen-ai-agent-spans.md). Cache-read tokens are exposed as `gen_ai.usage.cache_read.input_tokens` in implementations. — [VS Code Copilot OTel docs](https://code.visualstudio.com/docs/agents/guides/monitoring-agents)
- **Failure-mode rates**: track rates per MAST-like category (repetition, termination, verification). — [MAST](https://arxiv.org/html/2503.13657v3). Track judge validity as TPR/TNR. — [Hamel Husain](https://hamel.dev/blog/posts/evals-faq/)
- **Production signals**: user feedback is sparse and skewed toward severe issues, so pair it with sampled automated evals. — [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

### Inferences
Suggested metric set for the report:

| Metric | Proposed definition |
|---|---|
| Task success | Pass-all of binary checks. Report pass^1 in production sampling and pass^3 on the CI regression suite. |
| SQL correctness | Result-set match against a reference query, with numeric tolerance. Also track SQL error rate and auto-correction rate. |
| Groundedness | Judge-scored faithfulness (A\|C) with known TPR/TNR. |
| Citation accuracy | Share of cited KB/M365 doc IDs that contain the claimed fact. |
| Retrieval Recall@k | On the KB/M365 golden set. |
| Steps per task | Median and p95, plus the budget-exhaustion rate. |
| Loop rate | Identical-call repetition events per 100 tasks. |
| Tool error rate | By tool and by `error.type`. |
| Retry rate | By provider status code. |
| Cost per successful task | Total cost / successful tasks. It penalizes cheap-but-failing loops; cost per task alone hides that. |
| Cache hit ratio | Cache-read tokens / input tokens. Especially relevant when compaction changes the prompt prefix. |
| Latency | TTFT and end-to-end p50/p95. |
| Abandonment | User leaves or re-asks within N minutes without accepting an answer. |

### Gaps
- I found no primary source that defines "cost per successful task" or "abandonment" for agents. These are proposed definitions.
- The exact OTel metric names for time to first token and token usage (e.g., `gen_ai.client.token.usage`, `gen_ai.server.time_to_first_token`) were not verified from the spec in this pass.
- No published production benchmarks of typical cost, latency or steps per task for enterprise analytics agents were found.
