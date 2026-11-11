# Converting BI Artifacts (Reports, Visuals, Measures, Usage, Query Logs) into Grounding Knowledge for Text-to-SQL / Analytics Agents

Scope: the BI-artifact-specific angle only. This builds on `docs/research_notes/ALOFT knowledge base design/text_to_sql_grounding.md`, which already covers Genie's knowledge store, entity matching, and query-history suggestions; Cortex Analyst VQR; semantic-layer benchmarks (dbt, AtScale, data.world); CHESS and Spider 2.0 ablations; and Uber and Pinterest query-log retrieval. Those facts are not repeated here, only referenced as "prior note §N".

Labels: **[VENDOR]** = vendor claim or vendor-run eval; **[INDEP]** = academic paper or public benchmark; **[PROD]** = company case study on its own system; **[PRACTITIONER]** = third-party blog, GitHub tool, or consultant (unverified).

---

## 1. Research and industry evidence on using query logs, report metadata, and usage signals to improve text-to-SQL

### Takeaway
The strongest independent evidence is for **query-log mining**. Mining join paths, filter formats, group-by keys, and formulas from past SQL, then retrieving them as compact "hints", improves accuracy by large margins on cryptic schemas: TailorSQL reports up to 2× execution accuracy, and AT&T found 25% of the joins actually used were undocumented. It also cuts prompt size by roughly 2–15×. Evidence that *report metadata itself* (page names, visual titles) improves SQL accuracy is vendor-only: Power BI Copilot uses it for content routing, not for SQL generation.

### Cited Findings
**Query-log mining (independent research)**
- **[INDEP] TailorSQL (2025, VLDB AIDB workshop):** turns the past query workload into "query hint documents". Each past query is broken into sub-components (join paths, filter expressions, group-by clauses) rather than stored as full SQL, because full SQL is long, redundant, and full of boilerplate. Hints are "not directives": the LLM may ignore them. — [TailorSQL arXiv 2505.23039](https://arxiv.org/html/2505.23039v1)
- TailorSQL notes that one template per query, with literals stripped, "might help reduce information redundancy for dashboarding and reporting workloads where the same queries are issued repeatedly with differing literals" but works less well for ad-hoc workloads. That is directly relevant to BI-generated SQL. — [TailorSQL](https://arxiv.org/html/2505.23039v1)
- TailorSQL examples of what logs reveal that schemas don't:
  - a cryptically named bridge table (`cnt`) that defines the join path;
  - a birthdate stored as an 8-digit integer, whose correct year-extraction filter appears in past queries;
  - aggregation by `id` rather than `name` because names are not unique.
  
  — [TailorSQL](https://arxiv.org/html/2505.23039v1)
- **[INDEP] TailorSQL results:** single call to Claude 3 Haiku. Bird-Union is 71 tables and 1,200 questions, with PK-FK info and BIRD "evidence" removed; Spider-Union is 221 tables; FIBEN is a financial benchmark. Reported "12.5%, 10.9%, and 22.7% higher accuracy than the next best baseline" (SBERT retrieval); the excerpt does not make clear whether these are absolute points or relative gains. Headline: "up to 2× improvement in execution accuracy". At equal accuracy it used **1.8×, 15×, and 1.9× fewer tokens**. The largest gain was on FIBEN "due to … complex queries … and cryptic table names." Plugging TailorSQL's prompt into DIN-SQL and MAC-SQL also improved both. — [TailorSQL](https://arxiv.org/html/2505.23039v1); [VLDB workshop PDF](https://www.vldb.org/2025/Workshops/VLDB-Workshops-2025/AIDB/AIDB25_2.pdf)
- TailorSQL addresses **workload drift**: a multi-armed-bandit **abstention policy**, driven by user feedback, decides when to stop using query hints and fall back to generic NL2SQL. It was evaluated with a "disjoint split" where logged queries and test queries touch different tables. — [TailorSQL](https://arxiv.org/html/2505.23039v1)
- **[INDEP, AT&T researchers] Automatic Metadata Extraction for Text-to-SQL (May 2025):** studies three techniques (profiling, query-log analysis, LLM SQL-to-text). Treating BIRD dev gold SQL as a query log, **25% of equality joins used in ≥1 query were not documented** in the SQLite schema. Log analysis also surfaced multi-field joins, computed join keys, and named formulas that BIRD exposes only in its oracle "evidence" hints. — [arXiv 2505.19988](https://arxiv.org/abs/2505.19988)
- AT&T argues that extracted query **features** (join paths, predicates, formulas) can be better than raw few-shot examples. Few-shot queries "might not contain the necessary details, and might have the wrong query 'shape'", while "features can be expressed with less text … reducing prompt size." — [arXiv 2505.19988](https://arxiv.org/abs/2505.19988)
- **Databricks caveat (AT&T):** "a large portion of the queries submitted to [Databricks] do not have textual SQL queries" (PySpark dataframe workloads), so only query plans are available for those. — [arXiv 2505.19988](https://arxiv.org/abs/2505.19988)
- **[INDEP] Profiling-derived metadata (AT&T, GPT-4o, BIRD MiniDev, 500 questions):**

  | Metadata | No hints | With hints |
  | --- | --- | --- |
  | None | 49.8% | — |
  | BIRD (SME) metadata | 59.6% | 72.0% |
  | Profiling metadata | 61.2% | 72.6% |
  | Fused metadata | 63.2% | 73.0% |

  The no-oracle BIRD test submission scored 67.41%, versus 57.13% for the next-best no-oracle entry. — [arXiv 2505.19988](https://arxiv.org/abs/2505.19988). Caveat from a review: the "profiling beats SME metadata" claim "rests on a single un-replicated 500-question run." — [Pith review](https://pith.science/paper/2505.19988)
- **[INDEP] BEAVER (2024; updated 2026):** an enterprise benchmark whose gold SQL was "sourced from actual user query logs and production reports." Each item is annotated with tables, join keys, column mappings, domain knowledge, and decomposition. Agentic GPT-5.2 scores **10.8%**; with all subtask annotations given as oracle hints, **30.1%**. Subtask knowledge (which tables, which join keys, which column a phrase maps to, which domain rule) is the bottleneck. — [BEAVER arXiv 2409.02038](https://arxiv.org/abs/2409.02038); [beaverbench.github.io](https://beaverbench.github.io/)
- **[INDEP, older] Column-occurrence priors:**
  - A 2021 paper builds a **column occurrence/co-occurrence graph** (Dice coefficient) from past queries and feeds the scores as input features to an encoder-decoder text-to-SQL model on Spider. It reports improved column-prediction and exact-match accuracy; I did not capture the exact delta. — [Applied Sciences 2021](https://doi.org/10.3390/app112412116)
  - GARMT (2025) mines frequent table-access patterns and column co-occurrence with association rules to infer table associations. It evaluates runtime (−40%), not text-to-SQL accuracy. — [GARMT, MDPI Computers 2025](https://www.mdpi.com/2073-431X/14/6/220)

**Usage and popularity signals in products**
- **[VENDOR] Databricks Unity Catalog popularity:**
  - Table popularity is the count of interactive reads (JDBC, Statement Execution API, connectors, sample-data clicks) over 30 days.
  - **Column popularity** is the "approximate percentage of queries that used the column in the last 30 days."
  - The Insights tab lists frequent queries, users, **dashboards**, notebooks, and **frequently joined tables**. The joined-tables list is metastore-scoped; the frequent-* lists are workspace-scoped.
  - Limits: Insights covers only Databricks SQL queries, and "frequent queries" covers only saved SQL-editor queries.
  
  — [Databricks: View table insights and popularity](https://docs.databricks.com/aws/en/discover/table-insights)
- **[VENDOR] Power BI Copilot search ranking:** matches on item metadata. For reports it uses title, description, workspace name, **page names, visual titles, filter-pane titles, text boxes**. For semantic models it uses table/column/measure names and descriptions plus verified-answer prompts and charts. Ranking also considers "how recently you viewed it, if it was endorsed, if it's in your Favorites, and its **popularity within your tenant**." — [Power BI blog: Chat with your Data](https://powerbi.microsoft.com/en-gb/blog/the-next-era-of-copilot-in-power-bi-chat-with-your-data/); [Microsoft Learn: Copilot search](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-search-new-content)
- **[VENDOR] Power BI Copilot answer order:** it first checks whether "the answer can be found in the report visuals," cites the source visual, and only then builds a new visual from the model. It can also write new DAX for ad hoc calculations. — [Microsoft Learn: Copilot reports overview](https://learn.microsoft.com/en-us/Power-Bi/create-reports/copilot-reports-overview); [Standalone Copilot](https://learn.microsoft.com/en-us/power-bi/explore-reports/copilot-chat-with-data-standalone)
- **[VENDOR] Looker:** "In System Activity, users can see what fields are used in queries generated by agents and decide on fields to exclude." This is usage-driven pruning of agent-facing Explores. — [Looker: CA best practices](https://docs.cloud.google.com/looker/docs/conversational-analytics-looker-best-practices)

### Inferences
- For ALOFT, ~500 Power BI reports form a de-facto **curated query log**. Each PBIR visual's set of measures, columns, and filters is a pre-linked "query shape" chosen by an analyst. That makes it closer to TailorSQL's sub-component hints (join path, filter, group-by) than to free-form ad-hoc SQL, and denser in signal per artifact.
- Two different usage priors should be kept apart:
  - **design-time priors**: how many reports or visuals reference a column or measure, from PBIR;
  - **run-time priors**: how often a report or page is viewed, from activity events or usage metrics; and how often a UC column is queried, from UC column popularity.
  
  A measure used in 40 reports nobody opens is weaker evidence than one used in 3 heavily viewed reports.
- Because Power BI Import/Direct Lake models often query Databricks via generated SQL, `system.query.history` may contain the SQL that Power BI issued. That would be a second, SQL-level view of the same report workload. (Not verified in this research; see Gaps.)

### Gaps
- No independent paper measures accuracy gains from **dashboard/report metadata specifically** (visual titles, page names) as grounding for SQL generation. Power BI uses it for item retrieval, not SQL.
- I found no published ablation of **usage-weighted** column ranking on a modern LLM pipeline. The column-occurrence work is 2021 and encoder-decoder era.
- Not verified: whether Power BI DirectQuery or refresh SQL against Databricks lands in `system.query.history` with useful text and attribution back to a report.
- The TailorSQL excerpt is ambiguous on whether its 12.5/10.9/22.7% gains are absolute or relative.

---

## 2. Synthetic question generation from SQL, visuals, and measures (verified query sets and eval benchmarks); quality controls

### Takeaway
"SQL-first, then back-translate to a question" is the consensus method, because SQL-to-text is easier than text-to-SQL. Starting from known SQL gives perfect schema linking (AT&T); AT&T found LLM-generated questions often *better* than human-written ones. The validated quality controls are:
- execute and filter;
- generate multiple candidate questions and pick the semantic centroid;
- majority-vote on execution results;
- LLM-checker plus human review;
- hold out eval items from runtime context.

For private enterprise schemas, BEAVER argues you should **recompose real templates** rather than let an LLM invent SQL.

### Cited Findings
- **[INDEP] AT&T SQL-to-text procedure for few-shot mining:** (1) parse the logged SQL to get the referenced fields; (2) build a **focused schema** of only those fields; (3) ask the LLM for a long and a short question. "By query analysis, one can obtain perfect schema linking … making SQL-to-text an easier problem than text-to-SQL." — [arXiv 2505.19988](https://arxiv.org/abs/2505.19988)
- **[INDEP] AT&T selection procedure:**
  1. Extract features per logged query.
  2. Show the feature summary to an SME, who selects features of interest (e.g., an unusual formula).
  3. Return the queries containing those features as few-shot candidates.
  
  This yields a representative sample rather than all queries. — [arXiv 2505.19988](https://arxiv.org/abs/2505.19988)
- **[INDEP] AT&T quality result:** on 83 sampled BIRD MiniDev items, rated on a five-level scale from Bad to Good+, "even with no metadata, the SQL-to-text performance is surprisingly good — almost as good as human annotation. With fused metadata, the generated questions are significantly better than the human annotation." The human-written question was worse in 13 of 83 cases (16%). Grading was subjective, by the authors. — [arXiv 2505.19988](https://arxiv.org/abs/2505.19988)
- **[INDEP] AT&T few-shot retrieval:** replace names and literals in questions with placeholders before embedding ("masked questions"), then retrieve the 8 most similar as few-shot examples. — [arXiv 2505.19988](https://arxiv.org/abs/2505.19988)
- **[INDEP] OmniSQL / SynSQL-2.5M (VLDB 2025) quality controls:**
  - drop non-SELECT queries; execute and remove syntax errors and timeouts;
  - generate questions in 9 language styles (formal, colloquial, vague, metaphorical, conversational, …);
  - generate **multiple candidate questions per SQL** and keep the one with the highest average cosine similarity to the other candidates (the "semantic consistency selector");
  - generate multiple chain-of-thought solutions and **majority-vote by execution result**.
  
  GPT-4o judged 97% of questions meaningful, 89% of SQL appropriate, and 86% of samples fully correct. Where chain-of-thought regeneration changed the SQL, the new SQL was preferred in 93.98% of 5,000 cases, so regeneration also repairs bad gold SQL. — [OmniSQL PVLDB 18](https://www.vldb.org/pvldb/vol18/p4695-li.pdf)
- **[INDEP] SING-SQL (in-domain synthesis):** discards pairs showing "misalignment, ambiguity, or logical flaws," and sends unexecutable SQL through an automated repair step. — [SING-SQL](http://www.cs.bilkent.edu.tr/~oulusoy/SING_SQL-Arxiv.pdf). SQLForge also uses SQL-to-question reverse translation with structural and semantic validation. — [SQLForge, ACL Findings 2025](https://aclanthology.org/2025.findings-acl.443.pdf)
- **[INDEP] BEAVER critique of generic synthesis:** Sense, OmniSQL, SING-SQL, and SQL-factory "rely on the LLM's exposure to public databases … not well-suited for generating realistic queries over private enterprise schemas." BEAVER's **Structural Template Recomposition** instead extracts templates from real logged and report queries (base SELECT-FROM-JOIN-WHERE-AGG, CTE, nesting, domain-knowledge predicates) and recomposes them with other tables and values. "Experts verify all synthesized queries." — [BEAVER arXiv 2409.02038](https://arxiv.org/abs/2409.02038)
- **[INDEP] BEAVER annotation protocol:**
  - questions written by 6 graduate students plus 6 production DBAs, required to "eliminate ambiguity … explicitly reflect all predicates";
  - LLM checkers used as auxiliary tools, with humans deciding;
  - multi-reviewer majority vote; tables and join keys pre-extracted with **SQLGlot / sqlparse**, then human-verified;
  - about 87% inter-annotator agreement on subtask labels.
  
  One month of logs and reports yielded only **254 fully annotated real queries**, so real-log yield is low and expansion is needed. — [BEAVER](https://arxiv.org/abs/2409.02038)
- **[INDEP, 2023, older] Caution:** "state-of-the-art text-to-SQL algorithms did not further improve on popular benchmarks when trained with augmented synthetic data," blamed on "arbitrary table joins, and language gaps." — [ACL Findings 2023](https://aclanthology.org/2023.findings-acl.86.pdf)
- **[INDEP] Questions derived from visual titles:** BI-Bench (2026) builds questions from real Power BI dashboards. It picks visualizations "whose title can accurately describe user intent," e.g., "Sales amount, budget, and forecast comparison by month and year," and uses the visual's **Export data** CSV as ground truth. — [BI-Bench arXiv 2609.20886](https://arxiv.org/pdf/2609.20886)
- **[INDEP] Dashboard-to-task generation:** DashArena gives a VLM a dashboard's pages, data schema, and interaction features (extracted from code), and has it write the natural-language analytical task behind the dashboard (234 tasks). — [DashArena arXiv 2608.10567](https://arxiv.org/html/2608.10567)
- **[INDEP] Purely LLM-generated BI questions:** BI-Bench (ACL 2025 Industry) generated 336 questions with Llama-3.3-70B across descriptive, diagnostic, predictive, and prescriptive types over 29 datasets, scored with an unsupervised evaluator, without strict ground truth. — [BI-Bench ACL 2025](https://aclanthology.org/2025.acl-industry.90.pdf)
- **[VENDOR] Product-side generation from visuals:**
  - Power BI Copilot proposes trigger-phrase suggestions for a verified answer from the visual. — prior note §8
  - ThoughtSpot's "+ Add to Coaching" turns an answered question, edited or rephrased, into a reference question. It then asks the user to approve or reject the **business-term → search-token mappings** it inferred. — [ThoughtSpot: Reference questions](https://docs.thoughtspot.com/cloud/26.11.0.cl/spotter-reference-questions)
- **[VENDOR] Dedup guidance:** ThoughtSpot warns "Creating many reference questions with minor wording differences can confuse Spotter. Test whether Spotter can generalize before adding more examples." — [ThoughtSpot](https://docs.thoughtspot.com/cloud/26.11.0.cl/spotter-reference-questions)

### Inferences
- A PBIR visual is a better seed than raw SQL. Its referenced measures, columns, filters, and title give the **focused schema** that AT&T builds by parsing SQL, plus a human-written intent string (the title). Proposed pipeline per visual:
  1. compile the visual to SQL over UC, via the translated metric view;
  2. generate N candidate questions (title-conditioned plus style variants) and pick the centroid, OmniSQL-style;
  3. execute;
  4. reconcile the result against the Power BI number (see §5);
  5. route to SME review before promoting to "verified".
- Mask literals (slicer values, dates) in questions before embedding, as AT&T does, so one visual-derived example generalizes across filter values. Store the literals separately as value-index evidence (see §6).
- Keep a hold-out split: visual-derived pairs used as runtime few-shot must not also be used as eval gold. Snowflake's evaluation leakage rule is covered in prior note §2.

### Gaps
- No study measures accuracy from few-shot examples derived from **visuals or measures** specifically, as opposed to SQL logs.
- No published rejection rates for SQL-to-text on messy enterprise schemas. AT&T's 83-sample grading is on BIRD's readable schemas, and the authors say industrial schemas are "far more complex and dirty."

---

## 3. How BI and analytics vendors use existing dashboards, measures, and usage signals for grounding

### Takeaway
Vendors reuse BI artifacts in four ways:
- **auto-seed an agent from a dashboard**: Databricks Genie from AI/BI dashboards;
- **answer from existing visuals first, then fall back to model-generated queries**: Power BI Copilot;
- **use governed metric definitions as the grounding contract**: Tableau Pulse/Next, Looker LookML;
- **turn user feedback into term→token mappings at user or global scope**: ThoughtSpot.

Popularity is used mainly to **rank content** (Power BI) and **prune fields** (Looker System Activity), not to steer SQL directly. All claims below are vendor documentation.

### Cited Findings
**Databricks**
- **[VENDOR]** Publishing an AI/BI dashboard has "Enable Genie" on by default, and "Databricks automatically generates a Genie Agent based on your dashboard datasets and visualizations." — [Databricks: Genie Agents with dashboards](https://docs.databricks.com/aws/en/dashboards/genie-spaces)
- **[VENDOR]** A Databricks demo says a Genie space built from a dashboard is "prepopulated … with relevant SQL queries and instructions." — [Databricks AI/BI demo](https://answers.databricks.com/ai-bi-dashboards-genie-end-end-demo-Tc3WqbV7fKA). Since Dec 19, 2024, creating a Genie Agent from a dashboard "applies the dashboard's filter context." — [AI/BI release notes 2024](https://docs.databricks.com/aws/en/ai-bi/release-notes/2024)
- **[VENDOR] Security caveat:** Genie answers "from the full dataset query results. If a dataset query includes sensitive columns or rows, that data becomes available to Genie even if it is not shown in visualizations." — [Databricks](https://docs.databricks.com/aws/en/dashboards/genie-spaces)
- **[PROD, Databricks-hosted session] Mercedes-Benz Korea:**
  - built a **DAX-to-SQL transcompiler** to convert **600+ Power BI semantic models** into UC metric views;
  - it automates **40%** of DAX measure conversions;
  - a "master KPI catalog" serves as the semantic contract;
  - trust comes from **44 quality gates** and "**100% Power BI alignment testing**" of Genie answers against Power BI report figures.
  
  — [Databricks: From Power BI DAX to Metric Views](https://answers.databricks.com/from-power-bi-dax-metric-views-building-trusted-ai-databricks-genie-QYqSo2x49I0). Vendor co-presented; how "100% alignment" was scoped, and on what test set, is not specified.
- **[PRACTITIONER, Databricks Labs repo] Kasal Power BI → UC metric view pipeline:**
  - **DAX → Spark SQL** runs in parallel with **Power Query M → source SQL**;
  - a regex fast path handles only trivial patterns (single `SUM`, ANSI-safe `DIVIDE`, simple filtered aggregates); everything else goes to an LLM with skill files (`PATTERNS.md`, `EDGE_CASES.md`, `UNSUPPORTED.md`);
  - unsupported functions such as `TREATAS`, `LOOKUPVALUE`, `TOPN` are declined rather than faked;
  - **correctness guards** reject translations that drop prior-year windows, DIVIDE denominators, exclusions, or additive terms, or collapse share-of-total;
  - measure dependencies are topologically sorted, and one metric view is emitted per fact table.
  
  — [databrickslabs/kasal: UCMV pipeline](https://github.com/databrickslabs/kasal/blob/main/src/docs/powerbi/ucmv-pipeline-architecture.md); [UC metric view generator](https://github.com/databrickslabs/kasal/blob/main/src/docs/powerbi/tool-86-uc-metric-view-generator.md)
- **[PRACTITIONER]** Another open tool extracts via the REST/Scanner API or TMDL, translates "30+ DAX functions via 14-pass pipeline," validates against the Metric View YAML v1.1 spec, and emits **per-measure confidence scores** and audit reports. — [suryasai87/pbi-metrics-migration-tool](https://github.com/suryasai87/pbi-metrics-migration-tool)

**Microsoft Power BI**
- **[VENDOR]** Copilot search indexes report page names, visual titles, filter-pane titles, and text boxes. It generates a report description when the author left none (refreshed at most daily), respects hidden fields, and ranks using endorsement and tenant popularity. — [Microsoft Learn: Copilot search](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-search-new-content)
- **[VENDOR] Linguistic schema:** Power BI's Q&A **linguistic schema** (synonyms, phrasings, parts of speech) exports as `.lsdl.yaml`. Auto-generated entries are tagged `State: Generated`. "Power BI relies on the same linguistic modeling as the Q&A feature" for Copilot, and a model without synonyms means Copilot "might be more likely to return unexpected results." — [Microsoft Learn: Linguistic schema](https://learn.microsoft.com/en-us/power-bi/natural-language/q-and-a-tooling-advanced); [Microsoft Learn: Copilot with semantic models](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-semantic-models)
- **[PRACTITIONER] Conflict on the linguistic schema's future:**
  - One practitioner says synonyms "are explicitly in the Copilot grounding contract and survive the Q&A deprecation," while phrasings are "largely irrelevant to Copilot." In PBIP, synonyms also land in `.SemanticModel/Copilot/schema.json`. — [data-goblin/power-bi-agentic-development](https://github.com/data-goblin/power-bi-agentic-development/blob/main/plugins/semantic-models/skills/semantic-model/references/ai-copilot-readiness.md)
  - A consultancy claims `.lsdl` files "will become inert" after Q&A retirement. — [EPC Group](https://www.epcgroup.net/blog/power-bi-qa-deprecation-migration-playbook)
  - The Microsoft doc above still describes Copilot as relying on linguistic modeling.

**ThoughtSpot**
- **[VENDOR] Spotter memory:**
  - **Reference questions** (verified Q→answer pairs, now "legacy") "influence how Spotter reasons, rather than forcing a specific output," and do not remember chart choices.
  - **Business terms** map a phrase to a column, value, filter, or formula. They are global and "last resort": only for definitions "universally true across all contexts." Example: don't bind "this year" to one date column when several exist.
  - Memory is stored at **user level** or **global (model) level**; data-model instructions are global only.
  
  — [ThoughtSpot: Reference questions](https://docs.thoughtspot.com/cloud/26.11.0.cl/spotter-reference-questions); [Business terms](https://docs.thoughtspot.com/cloud/26.11.0.cl/spotter-business-terms); [Memory levels](https://docs.thoughtspot.com/cloud/26.11.0.cl/spotter-coaching-permissions)
- **[VENDOR]** Feedback from a check mark or X lets the user approve or reject the **business terms and search tokens** behind an answer. Admins see feedback in a "Spotter Conversations Liveboard." — [ThoughtSpot: Getting started with Spotter](https://docs.thoughtspot.com/cloud/26.11.0.cl/spotter-getting-started). Memory serializes to TML `nls_feedback` entries with `type`, `access` (GLOBAL/USER), `feedback_phrase`, `parent_question`, `search_tokens`, `formula_info`, and `rating`. — [ThoughtSpot TML for feedback](https://docs.thoughtspot.com/cloud/26.11.0.cl/tml-coaching)

**Tableau / Salesforce**
- **[VENDOR] Tableau Pulse Metrics Layer definitions:**
  - measure and aggregation, or a calculation;
  - **fixed definitional filters** (e.g., Status = Open);
  - a time dimension for comparisons;
  - **related dimensions** for breakdowns;
  - favorable/unfavorable direction.
  
  "Only one metric definition" per set of metadata; many follower "metrics" (time and filter contexts) sit on one definition. — [Tableau: Pulse Metrics Layer](https://www.tableau.com/blog/what-is-tableau-pulse-metrics-layer)
- **[VENDOR]** Tableau Next / Agentforce ground answers in Tableau Semantics on Data 360. An **Open Semantic Interchange (OSI)** YAML spec (datasets, fields, metrics, business context) is converted into a Tableau semantic data model, and the same model serves Agentforce and MCP clients. — [Salesforce Developers blog, Oct 2026](https://developer.salesforce.com/blogs/2026/10/build-trusted-conversational-analytics-with-aiforce-data-360-and-tableau-semantics). A practitioner flags the risk of "two homes for one metric" (Pulse vs Tableau Semantics) and recommends "a fixed set of questions with known answers to test the whole chain." — [Tableau Field Notes](https://ankurnapa.github.io/tableau-field-notes/articles/agentic-analytics-architecture/)

**Google Looker**
- **[VENDOR]** The agent fetches Explore schema (labels, descriptions, synonyms, type, `dimension_group`), ignores `hidden` fields, and resolves values via `allowed_value`, sampling, and fuzzy search. Looker composes the SQL, so the LLM never writes joins. Guidance:
  - "Place field-specific metadata, including synonyms and descriptions, directly in LookML rather than agent instructions";
  - "don't define the same term in both LookML and in the agent instructions."
  
  — [Looker: CA overview](https://docs.cloud.google.com/looker/docs/conversational-analytics-overview); [Looker: CA best practices](https://docs.cloud.google.com/looker/docs/conversational-analytics-looker-best-practices)
- **[VENDOR]** "Prism" runs evals for Conversational Analytics agents: custom question and answer sets, execution traces, regression tracking. — [Google Cloud Blog: Prism](https://cloud.google.com/blog/products/ai-machine-learning/run-evals-for-conversational-analytics-agents-using-prism)

### Inferences
- The pattern most transferable to ALOFT is Power BI Copilot's **"existing visual first, then model"**:
  1. retrieve a matching report visual (by page name, visual title, measures) and return its governed number with a link;
  2. otherwise compose from the metric registry (UC metric views translated from DAX);
  3. only then fall back to free text-to-SQL.
  
  This mirrors dbt's semantic-layer-first routing in prior note §3.
- Kasal and Mercedes-Benz Korea show DAX→SQL translation is only **partly automatable** (~40% at Mercedes-Benz Korea). The registry therefore needs per-measure states such as translated-verified, translated-unverified, and unsupported-kept-as-description-only. An untranslated measure is still valuable as a glossary and synonym entry.
- ThoughtSpot's user-level vs global memory and Looker's "one home per definition" rule argue for a single owner per glossary term in ALOFT, with report-derived synonyms entering at *candidate* scope until a data owner promotes them.

### Gaps
- No vendor publishes accuracy deltas from seeding agents with dashboards (Genie) or answering from existing visuals first (Power BI).
- How Genie selects "relevant SQL queries" from a dashboard's datasets is undocumented.
- ThoughtSpot Sage/Spotter use of query popularity for ranking was not found in current docs.

---

## 4. Schema linking and context pruning research: the role of column-usage priors

### Takeaway
The mainstream academic schema linkers (CHESS, DIN-SQL, RESDSQL, CodeS) rank schema items by **question relevance**, not usage frequency. In what I found, the papers that use **workload priors** are TailorSQL (query-log hints plus per-document-class retrieval budgets), AT&T (literal-driven schema expansion, and "generate SQL, then collect referenced fields" as schema linking), and older column-occurrence graphs. BEAVER shows that the subtasks such priors would solve (table retrieval, join keys, column mapping) are the dominant enterprise failure.

### Cited Findings
- **[INDEP] Task alignment (AT&T):** "LLMs are not good at direct schema linking — identifying which tables/columns are relevant to a question — but are good at generating SQL." Their linker therefore generates SQL under five schema/profile variants (focused vs full schema; minimal vs maximal profile) and takes the union of fields referenced. If a generated literal exists (per an **LSH index on value shingles**) only in fields not yet referenced, those fields are added and the SQL revised. — [arXiv 2505.19988](https://arxiv.org/abs/2505.19988)
- **[INDEP]** AT&T: "industrial databases can have hundreds of tables each with hundreds of fields, so in practice schema linking is a necessity". This counters the "long context removes schema linking" view; their related-work section notes the Distillery BIRD entry argued schema linking is unnecessary. AT&T also observed long prompts lose material "in the middle." — [arXiv 2505.19988](https://arxiv.org/abs/2505.19988)
- **[INDEP] TailorSQL retrieval:** per-document-class token budgets (tables, columns, hints) tuned by Bayesian optimization. Recall matters more for schema documents than for hint documents ("if a relevant hint is not present … TailorSQL might still generate the correct SQL"). Workload-tailored embeddings mix each document with auxiliary info from past queries. In the ablation on Bird-Union, removing query hints raised context size and lowered accuracy. — [TailorSQL](https://arxiv.org/html/2505.23039v1)
- **[INDEP] BEAVER subtasks:** multi-table retrieval, join key detection, column mapping, domain knowledge extraction, query decomposition. Oracle subtask hints roughly tripled execution accuracy (10.8% → 30.1%). Residual errors involve analytical constructs (grouping, ordering), window and scalar functions. — [BEAVER](https://arxiv.org/abs/2409.02038)
- **[INDEP]** CHESS ablations and the Spider 2.0 schema-linking error share are in prior note §5. TailorSQL plugged into DIN-SQL and MAC-SQL improved both (Tables 2–3). — [TailorSQL](https://arxiv.org/html/2505.23039v1)
- **[INDEP, older]** Column occurrence/co-occurrence scores from query history as an encoder input feature. — [Applied Sciences 2021](https://doi.org/10.3390/app112412116)
- **[VENDOR] Hiding as pruning:** Looker hides fields to cut noise and "improves the accuracy of field selection." Power BI Copilot respects hidden fields. Microsoft's checklist: "Select only relevant tables, columns, and measures (very important)" (prior note §4). — [Looker best practices](https://docs.cloud.google.com/looker/docs/conversational-analytics-looker-best-practices); [Power BI Copilot search](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-search-new-content)

### Inferences
- PBIR usage gives a cheap, high-precision **column whitelist and prior**: columns never referenced by any visual, filter, or measure in ~500 reports are strong candidates for down-weighting or hiding (Looker/Genie-style). The most-referenced columns get higher retrieval priority and richer descriptions. Use it as a *prior* combined with question similarity, not a hard filter, since ad-hoc questions legitimately touch unused columns.
- Model relationships plus the column pairs visuals combine give **join-path hints** (TailorSQL style), and report-level filters give **filter-format hints** (TailorSQL's birthdate example). Both are compact, and both beat full few-shot SQL on prompt size.
- AT&T's literal check (a generated literal must exist in a referenced column's value index) is a cheap guard ALOFT can run against a value index built from slicer and filter values (§6).

### Gaps
- Did not fetch RESDSQL or CodeS papers. I cannot cite their exact mechanisms; from general knowledge they are question-conditioned rankers or classifiers, but treat that as unverified.
- No 2024–2026 paper found that quantifies a **usage-frequency prior** inside an LLM schema linker with an ablation.

---

## 5. Building evaluation benchmarks from existing BI reports: numerical reconciliation as an eval

### Takeaway
Using a BI visual's exported result as ground truth is now an established academic method. BI-Bench takes visuals from 3K+ real `.pbix` files and their "Export data" tables, scored on table shape plus cell values with tolerance `rtol=1e-2, atol=0.5`. In industry, Mercedes-Benz Korea reports "100% Power BI alignment testing" for Genie, and practitioners describe "agent vs dashboard same-number" CI gates. Key design choices are tolerance, granularity checks, pinned data snapshots, and guarding against "lucky data" false positives.

### Cited Findings
- **[INDEP] BI-Bench (arXiv 2609.20886):**
  - crawled **3K+ real Power BI `.pbix` files**;
  - selected visuals whose titles express intent and took the answer by exporting the visual's underlying table ("Export data");
  - schemas are typically "multi-snowflake" (2 fact tables, 7 dimensions in the example);
  - frontier LLMs score **<50%**, and a tool-augmented BI-Agent gains up to **40 points**.
  
  Metric: the output is correct only if it matches the **table shape (enforcing aggregation granularity)** and cell values (row/column permutation allowed). Formatting is normalized (currency, %, dates) and numeric match uses `np.isclose(a,b,rtol=1e-2,atol=0.5)` following the Spider2 eval script. — [BI-Bench arXiv 2609.20886](https://arxiv.org/pdf/2609.20886)
- **[INDEP] DashboardQA:** 112 Tableau Public dashboards and 405 QA pairs for GUI agents. Best agent (Gemini-2.5-Pro) **38.69%**; OpenAI CUA 22.69%. Interactive dashboards are hard even to *read*. — [DashboardQA arXiv 2508.17398](https://arxiv.org/abs/2508.17398)
- **[PROD/VENDOR] Mercedes-Benz Korea:** "44 quality gates and a test suite that validates 100% alignment between Genie answers derived from metric views and the corresponding Power BI report figures." — [Databricks session page](https://answers.databricks.com/from-power-bi-dax-metric-views-building-trusted-ai-databricks-genie-QYqSo2x49I0)
- **[PRACTITIONER] Execution-accuracy comparison policy:**
  - ignore row order unless the gold query has ORDER BY;
  - compare as multisets;
  - ignore column order and aliases;
  - use relative tolerance for floats and exact comparison for decimals and ints;
  - flag empty-vs-empty matches separately.
  
  Pitfalls: "**False positives on lucky data**" (a query missing `status='paid'` passes if every row is paid), and **data drift**: store gold SQL rather than gold results, and pin a snapshot (time travel `AS OF`, cloned schema). It also proposes answer-level evals: numeric grounding of prose numbers against result rows. — [Agent Evals & Guardrails: Text-to-SQL evals](https://sarangk90.github.io/awesome-agent-evals-and-guardrails/02-offline-evals/05-text-to-sql-evals/)
- **[PRACTITIONER/VENDOR] Same-number harness:** for each golden case, fix model version, metric, dimensions, filters, order, limit, principal, and expected rows. Run via agent tools and via the dashboard or REST path, and assert equality within tolerance. "Start with 5–10 cases drawn from metrics you already trust in a dashboard." — [datahashi](https://datahashi.com/blog/2026-10-07-eval-harness-same-number/). Tolerance conventions: absolute and/or relative, pass if either holds; parse "$565,238.13", "(500)", "12%". — [Saiku Cloud evals](https://docs.saiku.bi/api/evals/). Strict row-count match, then approximate numeric match, then a diff. — [nao](https://getnao.io/blog/analytics-agent-benchmark-context-stack/)
- **[INDEP]** BEAVER stores subtask annotations (tables, join keys, column mapping, domain knowledge, decomposition) so failures can be *diagnosed*, not just counted — avoiding "all-or-nothing" execution accuracy. — [BEAVER](https://arxiv.org/abs/2409.02038)

### Inferences
- Each ALOFT eval item can be a (question, Power BI visual, filter context, expected table) tuple. The expected table comes from running the visual's DAX query against the semantic model, which reproduces what "Export data" gives. Compare it with the agent's Databricks SQL result using BI-Bench-style shape plus tolerance matching. A mismatch can come from the agent, the DAX→SQL translation, or **data latency between the Power BI refresh and UC**; the harness must record refresh timestamps to tell these apart.
- Shape and granularity checks matter for BI: many wrong answers have the right total at the wrong grain. Store the visual's group-by columns as part of the gold record.
- Reconciliation doubles as a test of the **metric registry**, separate from the agent: running each translated metric view against its source DAX measure over a fixed filter grid catches lost DIVIDE denominators or time windows, the same failure classes Kasal guards for.
- To avoid lucky-data passes, evaluate each item under several slicer contexts (different regions or periods) taken from the report's own filter values.

### Gaps
- No public detail on Mercedes-Benz Korea's alignment test design (number of cases, tolerance, how unsupported measures were handled).
- Not verified here: the exact DAX query a PBIR visual issues. It is typically captured via Performance Analyzer or `executeQueries`, but I did not source this.
- Microsoft docs say the `executeQueries` REST API does **not** support INFO functions or DMVs. — [Datasets – Execute Queries](https://learn.microsoft.com/en-us/rest/api/power-bi/datasets/execute-queries). Kasal's doc says it runs `EVALUATE INFO.MEASURES()` via that API. — [Kasal measure conversion](https://github.com/databrickslabs/kasal/blob/main/src/docs/powerbi/tool-73-measure-conversion.md). Unresolved conflict; ALOFT should test before depending on either.

---

## 6. Value and entity matching: building value indexes from BI slicer, filter, and dimension values

### Takeaway
Every production system grounds literals against actual column values: approximate string match, LSH on shingles, fuzzy search, or curated value lists. BI artifacts add **curated, high-precision literals**: the values analysts actually filter on, slicer options, and `allowed_value`/suggestion lists. These should seed or prioritize the value index rather than replace a full distinct-value profile. Specific evidence that slicer values improve accuracy was not found.

### Cited Findings
- **[INDEP] AT&T:** "a Locality Sensitive Hash (LSH) index on shingles is effective for the field value index as it provides an approximate match on values, but does not do semantic similarity". It is used to add columns containing a generated literal to the schema and to trigger SQL revision. — [arXiv 2505.19988](https://arxiv.org/abs/2505.19988)
- **[INDEP] TailorSQL:** "Filter expressions in past queries provide insights into the format of various columns, including literals within those columns." Logged filters teach value *format* (e.g., integer-encoded dates), not just membership. — [TailorSQL](https://arxiv.org/html/2505.23039v1)
- **[INDEP] BEAVER** annotates "column mapping: mappings from phrases in the question to specific table columns" and "domain_knowledge: domain-specific formatting rules or predicate logic." Phrase-to-column and phrase-to-value mapping is a first-class subtask. — [BEAVER HF dataset card](https://huggingface.co/datasets/beaverbench/beaver-query)
- **[VENDOR] Looker:**
  - values must be "exact matches of values in the underlying data";
  - the agent uses `allowed_value` from `parameter` fields, samples data, or runs fuzzy search (e.g., "jeans" → Product Name; "NY" → City vs State, which may need a clarifying question);
  - authors can hardcode `suggestions` or use `suggest_dimension`/`suggest_explore` for efficient value lookup.
  
  — [Looker: CA overview](https://docs.cloud.google.com/looker/docs/conversational-analytics-overview); [Looker best practices](https://docs.cloud.google.com/looker/docs/conversational-analytics-looker-best-practices)
- **[VENDOR] ThoughtSpot** business terms can map a phrase to "a specific column or value" or to a filter. — [ThoughtSpot: Business terms](https://docs.thoughtspot.com/cloud/26.11.0.cl/spotter-business-terms)
- **[VENDOR] Power BI** linguistic schema stores synonyms for tables, columns, and measures; value-level synonyms were not confirmed in what I read. — [Microsoft Learn: Linguistic schema](https://learn.microsoft.com/en-us/power-bi/natural-language/q-and-a-tooling-advanced)
- **[VENDOR] Tableau Pulse** metric definitions include **fixed definitional filters** (e.g., `Status = Open`) and related dimensions. That is curated (dimension, value) evidence attached to a metric. — [Tableau Pulse Metrics Layer](https://www.tableau.com/blog/what-is-tableau-pulse-metrics-layer)
- Genie entity-matching limits (120 columns, 1,024 values per column, string only, blocked by row filters and column masks), QuickSight value synonyms, Pinterest low-cardinality value injection, and Snowflake Cortex Search for high-cardinality literals are covered in prior note §§1, 4, 7.

### Inferences
- Proposed value-index tiers for ALOFT, from highest to lowest precision:
  1. literals hard-coded in report, page, or visual filters and in DAX `CALCULATE` filters, such as `Status = "Open"` — these are often *definitional* and belong on the metric, not just in the index;
  2. slicer dimensions, whose columns get full distinct-value coverage and top priority under Genie's 120-column cap;
  3. profiled distinct values of other low-cardinality string columns;
  4. Cortex-Search-style semantic or LSH lookup for high-cardinality columns.
- Report filter literals reveal canonical spellings and codes (e.g., `'WEB'` vs `'web'`, vessel codes vs names). Pairing a report's display label with the underlying stored value gives value synonyms.
- Respect UC row filters and column masks. Genie blocks entity matching on such tables (prior note §1), and values harvested from Power BI should not leak members a user cannot see in UC.

### Gaps
- No source found that quantifies accuracy gains from **slicer- or filter-derived** value lists versus generic distinct-value profiling.
- I did not verify the exact PBIR JSON paths for slicer values or visual filter literals (`filterConfig` and similar); ALOFT should confirm against its own exported PBIR.
- Not confirmed whether Power BI's linguistic schema supports **value-level** synonyms comparable to QuickSight's.
