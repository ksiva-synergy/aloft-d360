# Evaluating, Monitoring and Operating Retrieval/Knowledge Systems and Data-Analytics Agents (2024 – Oct 2026)

Scope: eval-and-observability harness for an enterprise knowledge base serving (a) a text-to-SQL analytics agent and (b) document-RAG agents. Research date: 24 Oct 2026. Source dates noted where known. Vendor-authored material is flagged **[vendor]**.

## Retrieval metrics and building golden sets cheaply

### Takeaway
Measure retrieval separately from generation, starting with a cheap synthetic "question-per-chunk" set that yields precision/recall baselines in a day; then grow the set by mining real user questions (clustered by topic and capability) and promote LLM-generated items only after human review. RAGAS and ARES give reproducible generators; ARES adds statistically grounded confidence intervals from ~150 human labels.

### Cited Findings
- Jason Liu (May 2024): the biggest mistake is spending effort on synthesis (generation) before knowing whether retrieval works. His recipe is to generate synthetic questions for each chunk, check whether that chunk is retrieved, and compute precision/recall as a baseline — [Jason Liu, Systematically Improving Your RAG, 2024-05-22](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/)
- Concrete baselines from the same post: on essays, full-text search and embeddings performed about the same, but full-text was ~10x faster; on GitHub issues, full-text got ~55% recall and embeddings ~65% recall. Baseline difficulty tells you which experiments are worth running — [Jason Liu, 2024](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/)
- Liu: queries like "what's the latest X" cannot be solved by lexical or semantic search alone; they need query understanding that extracts metadata filters (date ranges, sources). Golden sets should therefore include filter/temporal questions — [Jason Liu, 2024](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/)
- Liu: mine real queries by clustering them into **topics** (what people ask about) and **capabilities** (kinds of question, e.g. compare/contrast, deadlines, fetch tables), then model each cluster against thumbs-up/down to find under-performing segments. Distribution shifts (one client's "deadline" questions went from 2% to 80% after onboarding) should trigger re-prioritisation — [Jason Liu, 2024](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/)
- Liu: use the synthetic set to quantify trade-offs, e.g. a retriever feature's recall gain versus its latency cost — [Jason Liu, 2024](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/)
- RAGAS metric catalogue (docs updated Dec 2025): RAG metrics are Context Precision, Context Recall, Context Entities Recall, Noise Sensitivity, Response Relevancy, Faithfulness (plus multimodal variants). There are also NVIDIA metrics (Answer Accuracy, Context Relevance, Response Groundedness), agent metrics (Topic Adherence, Tool Call Accuracy, Tool Call F1, Agent Goal Accuracy), SQL metrics (Execution-based Datacompy Score, SQL Query Equivalence), and rubric-based general metrics — [RAGAS docs, Available metrics](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/)
- RAGAS test-set generation builds a `KnowledgeGraph` from documents and enriches it with transforms (HeadlinesExtractor, HeadlineSplitter, KeyphrasesExtractor). Synthesizers then pair a node property with a persona, style and length to generate query/answer pairs. A `query_distribution` mixes synthesizers by probability; single-hop queries use one node, multi-hop queries use related node pairs — [RAGAS single-hop testset tutorial](https://docs.ragas.io/en/stable/howtos/applications/singlehop_testset_gen/); [RAGAS multi-hop customisation](https://docs.ragas.io/en/stable/howtos/customizations/testgenerator/_testgen-customisation/)
- ARES (arXiv 2311.09476, NAACL 2024) needs three inputs: an in-domain passage set, a **human preference validation set of ~150+ annotated datapoints**, and ≥5 few-shot in-domain query/answer examples. It generates synthetic query–passage–answer triples, fine-tunes lightweight judges for context relevance, answer faithfulness and answer relevance, and uses **prediction-powered inference (PPI)** to produce confidence intervals. The authors claim it stays accurate across domain shifts using only a few hundred human annotations — [ARES paper](https://arxiv.org/html/2311.09476v2)
- Hamel Husain (Mar 2024): generate test inputs synthetically with an LLM (for example, "write 50 different instructions…"); you don't need to wait for production data. Refine generation using early real usage, and treat tests the model struggles with as the most valuable — [Hamel Husain, Your AI Product Needs Evals, 2024-03-29](https://hamel.dev/blog/posts/evals/)
- Amazon Bedrock retrieve-only evaluation jobs offer `ContextRelevance` (no ground truth) and `ContextCoverage` (needs ground-truth texts) **[vendor]** — [AWS Bedrock docs, RAG eval metrics](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-evaluation-metrics.html)
- MLflow 3 RAG judges: `RetrievalRelevance` (no ground truth), `RetrievalGroundedness` (no ground truth), and `RetrievalSufficiency` (needs ground truth: do retrieved docs contain everything needed?). All three require a trace with a `RETRIEVER` span — [MLflow built-in judges](https://mlflow.org/docs/latest/genai/eval-monitor/scorers/llm-judge/predefined/)

### Inferences
- recall@k, MRR and nDCG are standard IR measures that need labelled relevant chunk IDs. The question-per-chunk method gives exactly one known-relevant chunk per question, so recall@k and MRR are computable immediately. nDCG needs graded relevance and is only worth adding once real queries get multi-chunk labels. The LLM-judged "context precision/recall" metrics in RAGAS, Bedrock and MLflow are reference-light substitutes; use them where chunk-ID labels don't exist, and validate them as judges (next section).
- For the text-to-SQL agent, the equivalent of question-per-chunk is question-per-table or question-per-column. Generate NL questions from schema plus column descriptions, then measure whether schema retrieval (table/column linking) returns the right objects. Spider 2.0 identifies schema linking over very large schemas as the main failure (next sections).
- Single-chunk synthetic questions are biased toward easy, lexically overlapping queries; Liu's ~97% expectation reflects this. Real-query mining and multi-hop synthesizers are needed to keep the set from saturating.
- A practical funnel: synthetic (cheap, broad) → LLM-filtered → human-verified subset (~150–300 items, the ARES/PPI scale) → real-traffic additions from thumbs-down and cluster analysis.

### Gaps
- I found no rigorous published comparison of synthetic versus real-user golden sets for predicting production quality in enterprise RAG.
- I did not fetch RAGAS's exact formula pages for context precision/recall (whether they are LLM-judged or ID-based in the current version). Check the docs before implementing.

## Generation/grounding metrics, tooling landscape, and LLM-as-judge reliability

### Takeaway
All major tools converge on the same core RAG triad: context relevance, groundedness/faithfulness, and answer relevance, with correctness and citation metrics added on top. The judge, not the framework, determines quality. Practitioners and research agree: use binary, single-criterion judges, validate them against human labels with precision/recall/kappa (not raw agreement), swap positions in pairwise judging, and re-check alignment periodically because criteria drift.

### Cited Findings
**Metric definitions and tools**
- TruLens RAG triad: **context relevance** (each retrieved chunk relevant to the query), **groundedness** (split the response into claims and search for supporting evidence in the context), and **answer relevance** (the response addresses the question). The TruLens claim is that passing all three means "hallucination free up to the limit of its knowledge base" — [TruLens RAG Triad](https://www.trulens.org/getting_started/core_concepts/rag_triad/)
- Snowflake/TruLens benchmarked their own judges **[vendor self-benchmark]**. Groundedness on LLM-AggreFact: F1 0.81, precision 0.78, recall 0.85, Cohen's κ 0.54. Context relevance on TREC-DL: F1 0.64, precision 0.51, recall 0.87. Answer relevance on HotpotQA: F1 0.79, precision 0.99, recall 0.66 — [Snowflake engineering blog](https://www.snowflake.com/en/blog/engineering/benchmarking-LLM-as-a-judge-RAG-triad-metrics/)
- Amazon Bedrock retrieve-and-generate metrics: Correctness, Completeness, Helpfulness, Logical coherence, Faithfulness, **Citation precision** (how many cited passages were correctly cited), **Citation coverage** (whether response content is supported by citations and whether any are missing), Harmfulness, Stereotyping, Refusal. Custom metrics are supported **[vendor]** — [AWS Bedrock docs](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-evaluation-metrics.html)
- Bedrock's citation coverage is the ratio of faithfulness to the cited passages versus faithfulness to all retrieved passages. It is "not applicable" when the response is fully unfaithful, and a score of 1 doesn't mean everything is cited, only everything that *could* have been cited **[vendor]** — [AWS ML blog, Bedrock Evaluations GA](https://aws.amazon.com/blogs/machine-learning/evaluate-models-or-rag-systems-using-amazon-bedrock-evaluations-now-generally-available/)
- MLflow 3 / Databricks: scorers receive a Trace, extract fields, and return `Feedback` attached to the trace. The same scorer can run in offline `evaluate()` and in production monitoring. Scorer types are built-in judges, Guidelines judges (pass/fail natural-language rules), custom judges, code-based scorers, and third-party scorers — [Databricks docs, Scorers and LLM judges](https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/concepts/scorers); [MLflow scorers](https://mlflow.org/docs/latest/genai/eval-monitor/scorers/)
- MLflow/Databricks built-in judges: RelevanceToQuery, Correctness (needs expectations), Completeness, Fluency, Safety, Equivalence, Summarization, Guidelines, ExpectationsGuidelines, RetrievalRelevance, RetrievalGroundedness, RetrievalSufficiency, **ToolCallCorrectness** (needs expectations), **ToolCallEfficiency** — [MLflow built-in judges](https://mlflow.org/docs/latest/genai/eval-monitor/scorers/llm-judge/predefined/); [Azure Databricks built-in judges](https://docs.azure.cn/en-us/databricks/mlflow3/genai/eval-monitor/concepts/judges/)
- MLflow `RetrievalGroundedness` returns yes/no plus a rationale listing supported and unsupported statements with quotes. It evaluates **each retriever span separately**, so multi-retriever agents get one Feedback per span — [MLflow RetrievalGroundedness](https://mlflow.org/docs/latest/genai/eval-monitor/scorers/llm-judge/rag/groundedness/)
- Eugene Yan: separate **faithfulness** (answer relies only on the source, including saying "I don't know" when the source lacks the answer) from **helpfulness** (relevance, comprehensiveness, conciseness). Two error types: hallucinated answers (false positives) and wrongly claiming the info is absent (false negatives, often due to retrieval). Faithful ≠ correct: for org-specific documents that deviate from general knowledge, faithfulness is what matters — [Eugene Yan, Evaluating Long-Context Q&A Systems](https://eugeneyan.com/writing/qa-evals/)

**Judge reliability and calibration**
- Shankar et al., "Who Validates the Validators?" (UIST 2024, arXiv 2404.12272): LLM evaluators "inherit all the problems of the LLMs they evaluate." EvalGen has humans grade a sample of outputs (thumbs up/down) and selects the candidate assertions (code or LLM prompt) best aligned to those grades. Alignment is measured as **coverage** (failing outputs humans call bad) and **false failure rate** (failing outputs humans call good) — [Shankar et al. 2024](https://arxiv.org/abs/2404.12272)
- Shankar et al. key finding, **criteria drift**: "users need criteria to grade outputs, but grading outputs helps users define criteria." Some criteria only emerge after seeing outputs, so evaluation criteria cannot be fully fixed in advance — [Shankar et al. 2024](https://arxiv.org/abs/2404.12272)
- Husain: track the correlation between model-based and human evaluation; collect human critiques and iterate the judge prompt (he prefers prompt engineering over fine-tuning the judge); use the strongest model you can afford; keep re-checking agreement periodically. Raw agreement is misleading with imbalanced classes, so measure precision and recall separately — [Hamel Husain 2024](https://hamel.dev/blog/posts/evals/)
- Husain's workflow: a domain expert grades 25–50 examples at a time in a spreadsheet (model response, model critique, model verdict, expert critique, expert verdict) until the judge aligns. He prefers binary good/bad labels because granular scores are harder to manage — [Hamel Husain 2024](https://hamel.dev/blog/posts/evals/)
- Eugene Yan: use pass/fail for objective criteria and win/lose/tie for subjective ones. Split labelled data about 75% dev / 25% held-out test when aligning a judge. Use **one evaluator per dimension**; a "God Evaluator" covering 5–10 dimensions has "never" worked well for him. Combine them with simple rules and distinguish guardrail metrics (ship-blockers) from north-star metrics. For pairwise judging, run twice with positions swapped and treat flips as ties — [Eugene Yan, Product Evals in Three Simple Steps](https://eugeneyan.com/writing/product-evals/)
- Eugene Yan (AlignEval): report recall, precision, F1 and Cohen's κ for the judge. With ~20 labels, metrics fluctuate even on re-runs; aim for **≥50 labelled samples** — [Eugene Yan, AlignEval](https://eugeneyan.com/writing/aligneval/)
- From Yan's literature survey: in one QA study, GPT-4 reached Spearman ρ 0.67 with humans on correctness but only 0.55 on faithfulness, so "accurately quantifying faithfulness remains a challenging task." Pairwise comparison is more stable than direct scoring for subjective criteria; direct scoring suits objective checks such as faithfulness — [Eugene Yan, Evaluating LLM-Evaluators](https://eugeneyan.com/writing/llm-evaluators/)
- Position bias: in a study of 12–15 judges, 22 tasks and >100k–150k instances, position bias is **not random**, varies across judges and tasks, is weakly related to length, and is strongly driven by the quality gap between candidates. Judges with similar aggregate consistency disagree on specific instances — [Judging the Judges, arXiv 2406.07791](https://arxiv.org/html/2406.07791v9)
- Wang et al.: ranking can be manipulated by reordering responses (Vicuna-13B "beat" ChatGPT on 66/80 queries with ChatGPT as judge). Mitigations: multiple-evidence calibration, balanced position calibration (aggregate across orders), and human-in-the-loop for high-entropy cases — [Large Language Models are not Fair Evaluators, arXiv 2305.17926](https://doi.org/10.48550/arxiv.2305.17926)
- Self-preference: some judges (e.g. GPT-4o, Claude 3.5 Sonnet) systematically score their own outputs higher, and also show **family bias** toward same-family models (measured on >5,000 expert-annotated pairs, 9 judges) — [Play Favorites, arXiv 2508.06709](https://arxiv.org/html/2508.06709). A 2026 study across 20 LLMs found advanced capability is often uncorrelated or negatively correlated with low self-preference bias, and that multi-dimensional decomposed evaluation reduced it by 31.5% on average — [Quantifying and Mitigating Self-Preference Bias, arXiv 2604.22891](https://arxiv.org/html/2604.22891v4)

### Inferences
- Tool choice matters less than judge validation. RAGAS, TruLens, MLflow/Databricks and Bedrock implement nearly the same triad. Pick based on where traces already live (an MLflow trace store if on Databricks), and plan to write custom judges for domain criteria.
- Use a judge model from a different family than the generator, to reduce self/family preference.
- Vendor judge benchmarks (Snowflake/TruLens, MLflow "research-validated") are self-reported. Treat them as priors and re-validate on your own ~50–150 labelled items per judge.
- For citation accuracy in document-RAG, use two separate checks, mirroring Bedrock: (a) does each cited span support its claim (precision), and (b) are supportable claims cited (coverage).

### Gaps
- I did not fetch DeepEval, Arize Phoenix or LangSmith docs in this pass. Their metric sets (e.g. DeepEval's G-Eval and contextual precision/recall/relevancy, Phoenix's hallucination/QA evals) are reportedly similar, but this is unverified here.
- I found no independent head-to-head benchmark of RAGAS vs TruLens vs DeepEval vs MLflow judges on the same human-labelled enterprise data.

## Text-to-SQL evaluation

### Takeaway
Execution accuracy (EX, comparing result sets) replaced exact match because many SQL strings are equivalent. But EX has both false positives (coincidentally matching data) and false negatives (ambiguous questions, column-order rigidity, bad gold SQL). Public benchmarks have very high annotation error rates (52.8% BIRD Mini-Dev, 62.8% Spider 2.0-Snow), so an internal harness should combine focused result-set comparison, an LLM semantic-equivalence judge with full context, and expert-audited gold queries.

### Cited Findings
- Exact Match (EM) checks syntax-level equivalence and has high false-negative rates. EX compares execution results and became BIRD's primary metric, but still has **false positives** (e.g. an extra `age < 19` filter passes because no student is older than 18) and **false negatives** (ambiguous questions, column-order differences such as lname/fname, noisy gold SQL) — [FLEX, arXiv 2409.19014](https://arxiv.org/pdf/2409.19014v4.pdf)
- FLEX: an LLM judge given the question, schema, external knowledge, generated SQL, gold SQL and execution results, with detailed binary criteria. It raised agreement with human experts from Cohen's κ 62.0 (EX) to 87.04. Earlier LLM methods did *worse* than EX (LLM-SQL-Solver with GPT-4o κ 52.29; Prometheus-2 κ ~61) because they lacked context and used vague criteria or 1–5 rubrics. Re-scoring 50 models changed BIRD rankings substantially; noisy annotations were the main cause of underestimation — [FLEX](https://arxiv.org/pdf/2409.19014v4.pdf)
- Spider 2.0 (ICLR 2025, arXiv 2411.07763): 632 enterprise workflow problems on databases often with >1,000 columns (BigQuery, Snowflake, SQLite, DuckDB, PostgreSQL, ClickHouse), plus dbt projects. Gold SQL averages far longer than BIRD (Spider 2.0 requires >50 tokens versus BIRD's 30.9 average) — [Spider 2.0](https://arxiv.org/html/2411.07763v2)
- Spider 2.0 uses **execution-based focused evaluation**. Per-task scripts compare only the essential gold columns, and predictions may contain extra columns, because questions often don't specify the output columns; this reduces false negatives. Spider 2.0-lite/snow use EX; full Spider 2.0 uses Success Rate. Scripts accept strings, tables or database files, and each task scores 0/1 — [Spider 2.0](https://arxiv.org/html/2411.07763v2)
- Spider 2.0 quality control: each item was reviewed by ≥3 annotators. 45% had errors at first validation and 5% after the second round, and they "red-teamed" the evaluation scripts with known-false and correctly-formatted results — [Spider 2.0](https://arxiv.org/html/2411.07763v2)
- Spider 2.0 results: best o1-preview agent 21.3% on Spider 2.0 (later o1-preview/o3-mini reached ~23.8% on snow and ~23.4% on lite), versus 91.2% EX on Spider 1.0 and 73.0% on BIRD. Main failure causes: schema linking in huge schemas, dialect functions, nested query planning, and using external docs. "Erroneous data analysis" was 35.5% of errors (dialect functions 10.3%, advanced calculation 7.5%, query planning 17.7%) — [Spider 2.0](https://arxiv.org/html/2411.07763v2)
- Annotation-error audit (PVLDB vol. 19, data cutoff Oct 2025): expert analysis aided by an agent (SAR-Agent) found errors in 263/498 (**52.8%**) BIRD Mini-Dev examples and 76/121 (**62.8%**) Spider 2.0-Snow examples with public gold SQL. Correcting a 100-item BIRD Dev sample changed the 16 agents' EX by −7% to +31% relative (CHESS 62%→81%), and ranks shifted by up to ±9 positions (average 5) — [Pervasive Annotation Errors Break Text-to-SQL Benchmarks](https://www.vldb.org/pvldb/vol19/p931-jin.pdf)
- The SAR-Agent audit method verifies annotations step by step by running targeted probe queries against the database (EDA-style) rather than giving a single-turn LLM verdict. Humans then adjudicate all flagged cases — [Pervasive Annotation Errors](https://www.vldb.org/pvldb/vol19/p931-jin.pdf)
- Exact SQL equivalence is undecidable in general, so evaluation uses practical "match functions": string or structure match, or execution match on valid DB instances — [Fundamental Challenges in Evaluating Text2SQL, arXiv 2501.18197](https://arxiv.org/html/2501.18197)
- RAGAS ships SQL metrics: an execution-based DataCompy score (result-set diff) and an LLM SQL-query-equivalence check — [RAGAS metrics](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/)
- Husain describes an assertion-style unit test for a query-generating tool: check the expected result *count* (exactly 1, >1, or 0 listings) rather than SQL text — [Hamel Husain 2024](https://hamel.dev/blog/posts/evals/)

### Inferences
- Recommended internal SQL scoring stack:
  1. Parse and dry-run check (syntax, dialect, permissions, cost guard).
  2. Focused result-set comparison (order-insensitive unless ORDER BY matters, tolerant of extra columns, numeric tolerance).
  3. A FLEX-style LLM judge with full context, run only on mismatches and suspicious matches.
  4. Human adjudication of judge disagreements, feeding gold-set corrections.
- **Run gold and predicted SQL on multiple data states**, or on perturbed or "adversarial" fixtures, to catch coincidental-match false positives like the `age < 19` example.
- **Non-determinism:** run each question k times and report pass@1 together with pass^k (see the agent section). Pin warehouse snapshots or time-travel versions so gold results don't drift with live data.
- Budget for expert audit of the internal gold set. The 45%→5% (Spider) and 52.8%/62.8% (audits) figures suggest a first-pass internal gold set will also contain many errors.

### Gaps
- BIRD's own updated evaluation (e.g. reward-based or "soft F1" variants, BIRD-Interact) was not fetched.
- I found no published production post-mortem from a company running text-to-SQL at scale with quantified eval-versus-online metrics.

## Agent trajectory evaluation

### Takeaway
Score agents on end state (did the database or answer reach the goal?) plus reliability across repeated trials (pass^k), then add trajectory diagnostics (tool-call correctness, redundant calls) and cost/latency per task. Production-grade frameworks (MLflow, RAGAS) now include tool-call correctness and efficiency judges.

### Cited Findings
- τ-bench (Yao et al., Jun 2024; ICLR 2025): an LLM-simulated user, domain APIs, policy docs and a stateful database. Reward r = r_action × r_output ∈ {0,1}: the final DB state must exactly match the unique gold outcome, and the agent's replies must contain the required information (substring checks). The authors note r=1 is necessary but not sufficient; for example, it misses policy violations such as acting without user confirmation — [τ-bench paper, ICLR 2025](https://proceedings.iclr.cc/paper_files/paper/2025/file/1b126cc38b8638e07bef37e7b2bb72bf-Paper-Conference.pdf)
- **pass^k** is the probability that *all* k i.i.d. trials succeed, averaged over tasks; the unbiased estimate is C(c,k)/C(n,k). Contrast pass@k, the probability that at least one succeeds. gpt-4o succeeded on <50% of tasks with pass^8 <25% in retail — [τ-bench, arXiv 2406.12045](https://arxiv.org/abs/2406.12045)
- If per-trial success is p, pass^k ≈ p^k: 80% gives pass^8 16.8%; 95% gives 66.3%; 99% gives 92.3% **[vendor explainer]** — [sandtable, pass^k](https://sandtable.dev/concepts/pass-k)
- Sierra: compare final DB state with the expected outcome, which allows conversational variation, and report degradation as k grows **[vendor, τ-bench authors' employer]** — [Sierra blog](https://sierra.ai/blog/tau-bench-shaping-development-evaluation-agents)
- MLflow judges `ToolCallCorrectness` (tools and arguments correct for the query; needs expectations) and `ToolCallEfficiency` (no redundant calls; reference-free) — [Azure Databricks built-in judges](https://docs.azure.cn/en-us/databricks/mlflow3/genai/eval-monitor/concepts/judges/)
- RAGAS agent metrics: Topic Adherence, Tool Call Accuracy, Tool Call F1, Agent Goal Accuracy — [RAGAS metrics](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/)
- Braintrust supports `trialCount` for repeated trials and groups trials by input to expose unstable inputs. Duration and Cost are reportable metrics in PR comments **[vendor]** — [Braintrust compare experiments](https://www.braintrust.dev/docs/evaluate/compare-experiments); [Braintrust CI docs](https://www.braintrust.dev/docs/evaluate/run-in-ci)

### Inferences
- For the analytics agent, the "end state" is the final result set or chart data. Compute r_action as the focused result-set match, and r_output as "the narrative states the key numbers". Then pass^k gives a reliability signal that matters to business users, who see every run, not the average.
- Trajectory metrics to log per task: number of tool calls, duplicate calls (same tool and args), failed SQL attempts before success, schema-lookup calls, total tokens, cost, and wall-clock time. Gate on end-state success first; use trajectory metrics as diagnostics or soft gates, since multiple valid trajectories exist.

### Gaps
- τ²-bench and later τ-bench variants (2025) were not fetched; details unverified here.
- I found no standard published thresholds for "acceptable" step efficiency or cost per task; these are product decisions.

## Online monitoring: tracing, retrieval logs, feedback, drift, freshness, cost

### Takeaway
Instrument with the OpenTelemetry GenAI semantic conventions: `invoke_agent`, `chat`, `retrieval` and `execute_tool` spans, plus token usage. Note that these are still **Development** status (now maintained in a separate repo), so pin versions. Reuse offline scorers asynchronously on sampled production traces. Make feedback questions specific. Freshness SLOs and drift detection are under-documented and must be designed in-house.

### Cited Findings
- The GenAI semconv moved out of the main OpenTelemetry semconv site into the separate `open-telemetry/semantic-conventions-genai` repository, which uses Weaver to depend on core conventions — [opentelemetry.io notice](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/); [semantic-conventions-genai repo](https://github.com/open-telemetry/semantic-conventions-genai/tree/main)
- **Retrieval span** (status: Development): `gen_ai.operation.name = retrieval`, name `retrieval {gen_ai.data_source.id}`, kind CLIENT. Attributes: `gen_ai.data_source.id` (conditionally required), `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.retrieval.top_k` (recommended), and opt-in `gen_ai.retrieval.query.text` and `gen_ai.retrieval.documents` (e.g. `[{"id":"doc_123","score":0.95},…]`). `error.type` is set on failure — [GenAI spans spec](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md)
- Retrieval-span attributes are emitted by Haystack, LangChain and LlamaIndex instrumentation scenarios. **Execute-tool** spans (`execute_tool {gen_ai.tool.name}`, kind INTERNAL) are covered by many frameworks (e.g. OpenAI Agents, CrewAI, Google ADK, LlamaIndex, Pydantic-AI, LiteLLM) — [retrieval-span report](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/reference/reports/retrieval-span.md); [execute-tool-span report](https://ithub.global.ssl.fastly.net/open-telemetry/semantic-conventions-genai/blob/main/reference/reports/execute-tool-span.md)
- Other conventions: `gen_ai.usage.input_tokens` should include cached tokens; `gen_ai.conversation.id` correlates a session/thread; `invoke_agent` is an operation name (Development) — [GenAI spans spec](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md)
- MLflow/Databricks: the same scorer runs in development evaluation and in production monitoring; scorers attach Feedback to traces — [Databricks scorers](https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/concepts/scorers)
- Braintrust online scoring runs asynchronously on logged production traces, including sampled traffic, with no latency impact. Because live traffic has no ground truth it relies on LLM judges, and interesting traces feed back into datasets **[vendor]** — [Braintrust, Evaluate systematically](https://www.braintrust.dev/docs/evaluate)
- Feedback design: generic thumbs-down conflated tone, latency and correctness. Changing the copy to "Did we answer the question correctly? Yes/No" made feedback usable as eval data — [Jason Liu 2024](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/)
- Husain: build a domain-specific trace viewer (Gradio/Streamlit/Shiny, "in less than a day") that shows the tool/scenario, whether the input was synthetic or real, filters, and links to source systems. "Remove ALL friction from looking at data"; keep reading traces until you stop learning new things — [Hamel Husain 2024](https://hamel.dev/blog/posts/evals/)
- Husain: start with existing analytics, e.g. Rechat tracked LLM test results over time in Metabase — [Hamel Husain 2024](https://hamel.dev/blog/posts/evals/)
- Drift in usage mix (topic or capability distribution shifting after onboarding a new client) is a key monitoring signal — [Jason Liu 2024](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/)
- Shankar et al. note that criteria drift interacts with model drift, prompt edits and upstream chain changes — [Shankar et al. 2024](https://arxiv.org/abs/2404.12272)

### Inferences
- A minimum viable trace schema for this KB: root `invoke_agent` span (conversation.id, user/tenant, agent version, prompt version, index version), then `retrieval` spans (data_source.id = index name plus version; top_k; doc IDs and scores; opt-in query text, subject to PII policy), then `execute_tool` spans (SQL text, warehouse, rows returned, bytes scanned, error.type), then `chat` spans with token usage. Cost per retrieval or task = token cost + embedding cost + warehouse cost, attached as span attributes and aggregated per task.
- Because the semconv is in Development status, attribute names may change. Isolate them behind a thin internal helper and pin the semconv version (inference from the "Development" status labels).
- Freshness SLO: emit per-index "last successful ingest" and "source change → indexed" lag metrics, and alert on breach. Also log the doc `last_modified` in retrieval results so stale-answer incidents can be traced.

### Gaps
- I found no authoritative published standard or best practice for **index freshness SLOs** or for **embedding/query drift detection** in RAG (e.g. thresholds, statistical tests). This needs internal design or further targeted research.
- Arize Phoenix and LangSmith online-eval and monitoring features were not verified in this pass.
- The OTel GenAI **metrics** (e.g. token-usage and duration histograms) were not verified in detail.

## Regression gating in CI; A/B and shadow testing of retrieval changes

### Takeaway
Use tiered evals: cheap deterministic assertions on every change, LLM-judge suites on a sample or schedule (with repeated trials), and A/B tests only for significant product changes. Gate merges on score floors or baseline deltas against an immutable baseline experiment, and avoid demanding a 100% pass rate.

### Cited Findings
- Husain's three levels: L1 unit tests/assertions (run on every code change), L2 human and model eval (on a cadence), L3 A/B tests (after significant product changes). Cost is L3 > L2 > L1. Rechat had hundreds of assertions run in CI (GitHub Actions/GitLab), with results tracked outside CI alongside prompt/test versions — [Hamel Husain 2024](https://hamel.dev/blog/posts/evals/)
- Husain: unlike unit tests, LLM evals "don't necessarily need a 100% pass rate"; the pass rate is a product decision. Defer A/B testing until the product is mature enough to show real users — [Hamel Husain 2024](https://hamel.dev/blog/posts/evals/)
- Braintrust CI **[vendor]**: `braintrustdata/eval-action@v2` runs evals on PRs and posts score/metric comments (it needs `pull-requests: write`). `report_scores`/`report_metrics` filter what's shown. Comparing against a baseline experiment gives per-case deltas, regression sorting and diff mode — [Braintrust CI docs](https://www.braintrust.dev/docs/evaluate/run-in-ci); [eval-action README](https://github.com/braintrustdata/eval-action); [Compare experiments](https://www.braintrust.dev/docs/evaluate/compare-experiments)
- Braintrust article **[vendor]**: for fast PR feedback use `bt eval --first N` or `--sample N` with full runs after merge; use a `paths` filter so expensive suites run only when prompts, code or evals change; gate on aggregate score floors, pass rates or baseline deltas; use trial counts for non-deterministic outputs — [Braintrust, LLM eval pipeline in GitHub Actions](https://www.braintrust.dev/articles/llm-eval-pipeline-github-actions)
- Liu: evaluate a retrieval feature by running the synthetic set with and without it and comparing recall versus latency (e.g. "recall doubles, latency +20%") before deciding to ship — [Jason Liu 2024](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/)

### Inferences
- Retrieval-change gate: on any change to the embedding model, chunking or index config, re-index into a shadow index and run the golden retrieval set (recall@k/MRR per topic and capability cluster). Block the change if any guardrail cluster regresses beyond a threshold, even when the aggregate improves; per-segment views follow Liu's cluster approach and Yan's guardrail-vs-north-star split.
- Shadow testing: dual-query production traffic against the old and new index (no user impact), log both doc-ID sets, and compute overlap and judge-scored relevance on a sample. Promote after offline gates and shadow agreement pass, then A/B test only for user-visible changes.
- Set gate thresholds with noise in mind: with small sets (~20–50 items), judge metrics fluctuate run to run (Yan), so use repeated trials and confidence intervals (ARES/PPI-style) rather than single-run point deltas.

### Gaps
- LangSmith and MLflow CI-gating specifics were not fetched.
- I found no published, rigorous study of shadow-index testing methodology for RAG; the inference above is based on general practice.

## Anti-patterns and lessons learned

### Takeaway
The recurring lessons: look at your own data, build task-specific binary evals rather than generic framework scores, validate the validators (and re-validate as criteria drift), don't trust public benchmark gold labels, and don't let generic thumbs signals or "God evaluators" stand in for targeted measurement.

### Cited Findings
- Unsuccessful AI products "almost always share a common root cause: a failure to create robust evaluation systems." Symptoms: whack-a-mole fixes, no visibility beyond vibe checks, and bloated prompts — [Hamel Husain 2024](https://hamel.dev/blog/posts/evals/)
- "Don't rely on generic evaluation frameworks… create an evaluation system specific to your problem"; "Keep it simple. Don't buy fancy LLM tools. Use what you have first"; vendors who claim to remove the need for humans to look at data should be viewed skeptically — [Hamel Husain 2024](https://hamel.dev/blog/posts/evals/)
- Over-trust in LLM graders: the "GPT-4 aces MIT EECS" preprint was debunked within hours, partly because GPT-4 graded itself — [Shankar et al. 2024](https://arxiv.org/abs/2404.12272)
- People over-generalise from single failures and struggle to scale evaluation even with tooling — [Shankar et al. 2024](https://arxiv.org/abs/2404.12272)
- "God Evaluator" anti-pattern: one judge covering many dimensions is hard to calibrate — [Eugene Yan](https://eugeneyan.com/writing/product-evals/)
- Raw agreement as a judge metric is misleading under class imbalance — [Hamel Husain 2024](https://hamel.dev/blog/posts/evals/)
- Spending effort on generation before measuring retrieval is the most common mistake — [Jason Liu 2024](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/)
- Ambiguous feedback copy produces unusable labels — [Jason Liu 2024](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/)
- Trusting public text-to-SQL leaderboards: annotation errors shift ranks by up to 9 positions — [Pervasive Annotation Errors](https://www.vldb.org/pvldb/vol19/p931-jin.pdf); earlier LLM SQL judges underperformed plain EX — [FLEX](https://arxiv.org/pdf/2409.19014v4.pdf)
- Single-run success rates hide unreliability; pass^k drops sharply with k — [τ-bench](https://arxiv.org/abs/2406.12045)
- Uncontrolled position and self-preference biases in judges — [Wang et al.](https://doi.org/10.48550/arxiv.2305.17926); [Play Favorites](https://arxiv.org/html/2508.06709)

### Inferences
- For ALOFT, the highest-leverage early investments are:
  1. A trace viewer tailored to the KB, showing retrieved chunks, SQL, results, and links to source objects.
  2. Binary per-dimension judges, each validated on ≥50 expert labels.
  3. An expert-audited SQL gold set with focused result comparison.
  4. Segment-level (topic × capability) dashboards rather than one global score.

### Gaps
- Few public, detailed **production post-mortems** for enterprise RAG or text-to-SQL incidents exist. The material found is practitioner guidance and benchmark audits rather than incident reports.
- Hamel Husain and Shreya Shankar's later material (2025 course/FAQ on error analysis, open/axial coding) was not fetched in this pass.
