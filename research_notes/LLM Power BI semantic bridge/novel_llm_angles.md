# Novel LLM and agent use cases for a large Power BI estate feeding a Databricks semantic layer (ALOFT)

Scope: brainstorm-grade, sourced list of LLM/agent use cases beyond basic PBI-to-UC mapping, for a maritime ship-management estate of roughly 500 semantic models and 500 reports with heavy near-duplication (per-client copies such as `BV Report` / `BV Report_GENCO` / `BV Report_GERMANY`; per-year copies such as `CII SDK-2024` / `CII SDK-2025`). Sources: Databricks, Snowflake, Excel. Inputs available: Scanner API output (DAX, M, schema) and Fabric PBIR report definitions.

Labeling convention: anything under **Cited Findings** is demonstrated or documented. Anything marked **[Speculative]** under Inferences is a proposal that no source demonstrates end to end.

Research date: 2026-11-10. Product surfaces (Fabric IQ, Genie Code, Prep data for AI) change fast; re-verify before building.

---

## 1. What first-party tooling now exists to let an agent read from and write to Power BI? (foundation for every other use case)

### Takeaway
Microsoft now ships two distinct MCP surfaces: a **read-only Fabric IQ MCP** (discover, schema, report metadata, value search, DAX execution under the signed-in user) and a **Power BI Authoring MCP** (create/modify models, bulk refactors, DAX validation, TMDL/PBIP). Together they make "ALOFT agent consults a PBI model" and "ALOFT pushes descriptions back into PBI" technically feasible today, with important auth limits (Fabric IQ MCP has no service-principal or app-only auth).

### Cited Findings
- Fabric IQ MCP is a remote MCP server exposing a **read-only** toolset: `DiscoverArtifacts`, `ResolveFabricItem`, `GetReportMetadata`, `GetSemanticModelSchema`, `ValueSearch`, `ExecuteQuery`. It "doesn't expose a natural-language answering tool"; the calling agent composes DAX itself. Endpoint `https://fabriciq.svc.cloud.microsoft/v1/mcp/fabriciq` (private-link variant `https://api.fabric.microsoft.com/v1/mcp/fabriciq`). — [Microsoft Learn: Fabric IQ MCP](https://learn.microsoft.com/en-us/fabric/iq/connectors/fabric-iq-mcp)
- Fabric IQ MCP limits: one semantic model per `ExecuteQuery` (no cross-model joins); default 250 rows, larger results as embedded CSV, still subject to Power BI query limits; **service-principal and app-only authentication not supported**; runs under the signed-in user's permissions with no admin-impersonation path; RLS/OLS can give different users different results; results only as fresh as the last refresh; unavailable in Power BI-only regions and sovereign clouds; doesn't support dashboards, paginated reports, or apps. — [Microsoft Learn: Fabric IQ MCP](https://learn.microsoft.com/en-us/fabric/iq/connectors/fabric-iq-mcp)
- `ExecuteQuery` takes 1–4 DAX queries (each a single `EVALUATE`), `maxRows` default 250, max 1,000. Microsoft's own agent skill says to call `ValueSearch` "BEFORE writing a DAX filter on a named entity… so DAX does not guess canonical spelling." — [microsoft/skills-for-fabric: fabriciq SKILL.md](https://github.com/microsoft/skills-for-fabric/blob/main/skills/fabriciq/SKILL.md); [semantic-model-consumption SKILL.md](https://github.com/microsoft/skills-for-fabric/blob/main/skills/semantic-model-consumption/SKILL.md)
- Fabric IQ MCP replaced the earlier preview "Power BI MCP consumption endpoint". It drops that endpoint's `GenerateQuery` tool and adds `DiscoverArtifacts`, `ResolveFabricItem`, and `ValueSearch`. — [Glean docs: Power BI in Assistant](https://docs.glean.com/connectors/native/powerbi/assistant)
- The older consumption server (`https://api.fabric.microsoft.com/v1/mcp/powerbi`) had Execute Query, Get Semantic Model Schema, Get Report Metadata, and Generate Query. Generate Query used the Copilot DAX engine and needed a Copilot license; Execute Query needed Build permission; "service principal authentication doesn't currently support RLS." — [Microsoft Learn: Power BI Consumption MCP setup](https://learn.microsoft.com/en-us/power-bi/developer/mcp/remote-mcp-server-get-started)
- Power BI Authoring MCP: create/update/delete tables, columns, measures, relationships, calculation groups, perspectives, RLS roles; "change hundreds of objects at once" (bulk renames, refactors, translations); evaluate against best practices; work on TMDL/PBIP so changes "flow through your normal source control and review process"; execute and validate DAX. Hosted endpoint is preview (`https://api.fabric.microsoft.com/v1/mcp/powerbi/authoring`); local server is GA and supports a service principal in CI. — [Microsoft Learn: Power BI Authoring MCP](https://learn.microsoft.com/en-us/power-bi/developer/mcp/power-bi-authoring-mcp)
- The authoring server's tool list includes `measure_operations`, `dax_query_operations`, `trace_operations`, `transaction_operations` (begin/commit/rollback), and `database_operations` (import/export TMDL, deploy to Fabric). — [GitHub: microsoft/powerbi-modeling-mcp](https://github.com/microsoft/powerbi-modeling-mcp/)
- A third-party enterprise search vendor (Glean) already productizes the "agent answers from PBI" pattern: it generates DAX from indexed Power BI context plus live Fabric IQ metadata, calls `ExecuteQuery`, and "should prefer existing measures and the governed semantic model behind a report rather than attempting to calculate answers from dashboard labels." — [Glean docs](https://docs.glean.com/connectors/native/powerbi/assistant)

### Inferences
- The lack of service-principal auth on Fabric IQ MCP means a background ALOFT job **cannot** use it as an unattended reconciliation oracle. It fits user-delegated, in-session checks (on-behalf-of the logged-in ALOFT user). For unattended batch work, the local Authoring MCP (service principal supported) or the XMLA/`executeQueries` REST path are the candidates. The latter was not verified in this research.
- Since Fabric IQ MCP is per-user and RLS-aware, a "second opinion" from Power BI reflects what *that user* is allowed to see. That is a feature for user-facing reconciliation and a trap for global accuracy scoring.

### Gaps
- Not verified: whether the REST `executeQueries` endpoint or XMLA read access works with a service principal on this tenant's capacities. This is needed for unattended oracle use.
- Not verified: pricing/capacity consumption of Fabric IQ MCP calls.

---

## 2. Estate rationalization and metric drift: can LLMs/embeddings cluster near-duplicate models and detect conflicting KPI definitions?

### Takeaway
Exact-duplicate detection is a solved, commoditized problem: Measure Killer, Soterre, and pbiplint all hash normalized DAX. Model and report similarity scoring also exists. The **gap an LLM fills is semantic equivalence and drift explanation**: deciding that two textually different DAX expressions compute the same KPI, or that two same-named measures differ in a business-relevant way, and writing that up for a data owner. No source demonstrates LLM-based semantic DAX equivalence at estate scale; that part is speculative.

### Cited Findings
- Measure Killer offers tenant-wide "Find duplicates tenant wide" for identical DAX across all scanned models. Its guidance: across models, duplicates are often fine; "what you want to check is the opposite, that a KPI is calculated the same way everywhere." The suggested way to do that is manual: search the measure name and compare definitions side by side. — [Measure Killer: Find duplicate DAX](https://measurekiller.com/docs/faq/find-duplicate-dax)
- Measure Killer "Semantic model similarity compares models pairwise across tables, columns, measures, relationships, and M expressions. A 100% match is a duplicate; an 80% match is a near-duplicate worth consolidating." Report similarity compares pages, visuals, filters, bookmarks, and report-level measures, with tunable weights. — [Measure Killer: Governance & monitoring](https://measurekiller.com/docs/how-tos/governance-and-monitoring)
- Measure Killer recommends searching DAX for hard-coded years (`2024`, `2025`) "to find measures that will silently return wrong results next year", and searching "variations of the same logic (e.g. different ways to calculate YTD) to identify inconsistencies across models." — [Measure Killer: Governance](https://measurekiller.com/docs/how-tos/governance-and-monitoring); [Measure Killer: DAX expressions](https://measurekiller.com/docs/how-tos/dax-expressions)
- Soterre PBI Analyzer flags duplicates only on a 100% normalized expression match (whitespace, line breaks, and casing ignored). "Measures with the same name but different expressions are not flagged by this check." It notes trivial measures like `SUM(Table[Column])` match often and should be filtered by complexity. — [Soterre: Duplicate Measures](https://help-soterre-pbi-analyzer.com/flags/duplicate-measures/)
- pbiplint's rule is exact after stripping whitespace, is **case sensitive**, and treats a comment on either copy as a difference. This shows how brittle textual matching is. — [pbiplint: avoid duplicate measures](https://pbiplint.com/rules/avoid-duplicate-measures/)
- Databricks' own internal practice: a "metric store" where metric YAML is checked into a repo and "if it finds another metric already being defined… CI actually fails", enforcing one definition per metric. The same talk reports Genie accuracy moving from 65 to 85 after encoding metrics in metric views. — [Databricks: Supercharging Genie Performance With Metric Views](https://answers.databricks.com/supercharging-genie-performance-metric-views-6rEl8md1kT8)
- Consultancy claim (vendor marketing, not independently verified): Hakkoda's copilot did "all data discovery, report metric identification, and SQL consolidation" for a $5B automotive-services firm with 4,000 Power BI reports. It "consolidated & rationalized 91.5% of all reports… down to 18 key reports", with the plan in 4 weeks versus a 10-month traditional SI estimate. — [Hakkoda: BI Rationalization & Migration with Hakkoda AI](https://hakkoda.io/3-phase-bi-rationalization-migration-with-hakkoda-ai/)

### Inferences
- **[Speculative] Three-tier drift detector for ALOFT.** (1) Deterministic: normalize DAX (case-fold, strip comments and whitespace, canonicalize table/column refs to UC lineage targets via the Scanner `datasourceUsages`), then hash. (2) Embeddings: embed `measure name + normalized DAX + upstream UC columns + filter context`, and cluster within families such as everything named like "Off-hire days" or "CII rating". (3) LLM judge: for each cluster, classify pairs as *equivalent*, *equivalent except filter/scope* (for example a client-specific vessel filter in `BV Report_GENCO`), or *conflicting*, and write a one-paragraph diff. Tier 3 output becomes the agenda for a metric-owner review that ends in one governed UC metric view.
- **[Speculative] Execution-based equivalence beats textual judgment.** For pairs the LLM calls equivalent, run both measures through `ExecuteQuery` (or the authoring server's DAX execution) over the same grain and compare results. This turns an LLM guess into an empirical check. Cost is bounded because only clustered candidates are executed.
- ALOFT-specific: per-client copies are likely "same logic + hard-coded client filter" and per-year copies are likely "same logic + hard-coded year". An LLM is well suited to extracting the *parameter* (client, year) from the diff and proposing a single parameterized metric view with `client`/`year` dimensions. This is speculative, but it is the clearest consolidation story for this estate.

### Gaps
- No published evaluation of LLM accuracy at judging DAX semantic equivalence was found.
- Hakkoda's numbers are self-reported marketing with no method detail.

---

## 3. Auto-documentation and Prep data for AI: harvest, generate, push back?

### Takeaway
Prep data for AI content (AI instructions, verified answers) is **harvestable read-only** through the MCP `GetSemanticModelSchema` call, but **cannot be written programmatically**. Microsoft's own agent skills say not to edit verified answers automatically. Model/measure/column descriptions *can* be pushed back via the Authoring MCP. Academic evidence supports LLM-generated descriptions being mostly acceptable to stewards and improving text-to-SQL, with warnings about ambiguous columns and unreliable LLM-as-judge evaluation.

### Cited Findings
- `GetSemanticModelSchema` on the Power BI remote MCP returns `CustomInstructions` (AI instructions) and `VerifiedAnswers` along with tables and relationships. A verified answer stores "the projections — the tables, columns, measures, filters used in the visual and not the DAX query of the visual." "You cannot make changes to Prep for AI programmatically, this is just retrieving the configs." — [Fabric.guru (Sandeep Pawar): Programmatically Retrieve Prep Data For AI](https://fabric.guru/programmatically-retrieve-prep-data-for-ai-configuration-of-semantic-models)
- Fabric IQ's `GetSemanticModelSchema` is documented as retrieving "table/column/measure definitions, relationships, custom AI instructions, and verified answers." — [microsoft/skills-for-fabric: fabriciq SKILL.md](https://github.com/microsoft/skills-for-fabric/blob/main/skills/fabriciq/SKILL.md)
- Verified answers: human-approved visual responses triggered by phrases; stored in the semantic model; Copilot checks for an "exact or semantically similar match" to trigger phrases first; up to three user-adjustable filters; no slicers; no relative-date filters. "CI/CD features aren't supported, including Git integration, REST APIs, and deployment pipelines." "Copilot doesn't return verified answers when Fabric IQ is enabled." — [Microsoft Learn: Verified answers](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai-verified-answers)
- Microsoft's semantic-model authoring skill: "Do not edit Verified Answers automatically. Suggest good candidates and ask the user to configure them through the Power BI 'Prep data for AI' experience." It also recommends inspecting measures to "recommend the top five questions worth setting as Verified Answers." — [microsoft/skills-for-fabric: semantic-model-ai-readiness.md](https://github.com/microsoft/skills-for-fabric/blob/main/plugins/powerbi-authoring/skills/semantic-model-authoring/references/semantic-model-ai-readiness.md)
- Unity Catalog AI-generated comments exist for catalogs, schemas, tables, views, MVs, columns, functions, models, and volumes. They are generated per object on request in Catalog Explorer, based on "object metadata, such as the table schema and column names". Databricks "strongly recommends human review" and says the model "should not be relied on for data classification tasks such as detecting columns with PII." — [Databricks docs: AI-generated comments](https://docs.databricks.com/gcp/en/comments/ai-comments)
- Databricks "Publish to Power BI Workspace" passes UC table/column comments and PK/FK constraints into the generated Power BI semantic model as descriptions and relationships. — [Databricks SA blog on Medium](https://medium.com/databrick-solutions-architect-blogs/the-best-of-databricks-loaded-straight-to-your-power-bi-models-7c271cd464ea)
- RAG few-shot description generation (retrieving existing catalog descriptions as examples) reached more than 80% ROUGE-1 F1, and "87%–88% of instances [were] accepted as is or curated with minor edits by data stewards." — [arXiv 2503.09003](https://arxiv.org/abs/2503.09003)
- LLM-generated column descriptions "significantly improve Text-to-SQL execution accuracy, especially when columns are uninformative". Models "struggle with columns that exhibit inherent ambiguity, highlighting the need for manual expert input". LLM-as-judge "does not align well with human evaluations". More verbose generated descriptions sometimes outperformed curated gold ones for text-to-SQL. — [arXiv 2408.04691](https://arxiv.org/abs/2408.04691); [HTML v2](https://arxiv.org/html/2408.04691v2)
- AutoDDG grounds descriptions in algorithmic data profiling before LLM enrichment, to avoid hallucination from raw samples. It produces both a user-focused and a search-focused (keyword-rich) description. — [arXiv 2502.01050 AutoDDG](https://arxiv.org/html/2502.01050)

### Inferences
- **Harvest direction is demonstrated.** Any AI instructions and verified answers already authored on the ~500 models are high-signal, human-written business context. They can be pulled into ALOFT (as Genie/agent instructions, synonyms, and example questions) for free. Verified answers carry the measure/column projections, so each one is effectively a labeled (question → measures + filters) pair.
- **[Speculative] Richer descriptions than UC's built-in generator.** UC AI comments use only schema and column names. ALOFT holds DAX that *uses* each column, the M steps that *derive* it, and the visuals and page titles that *display* it. Feeding that usage context (AutoDDG-style: deterministic profile first, LLM second) should give more accurate business descriptions than schema-only generation. Write them as UC comments and, through the Authoring MCP, as PBI measure descriptions. Push-back to PBI should go through TMDL/PBIP and PR review, not direct writes to production models.
- **[Speculative] Verified-answer candidates, human-applied.** Generate candidate trigger phrases and visual selections per model; a human applies them in the PBI UI. Note the conflict: if the tenant enables Fabric IQ, Copilot stops returning verified answers. Their value then is mainly as harvested training/eval data rather than as a Copilot feature.
- Use stewards' acceptance rate (the 87–88% metric from 2503.09003) as ALOFT's KPI for description quality, not LLM-judge scores, given the weak judge-human alignment in 2408.04691.

### Gaps
- Not found: whether the Authoring MCP can write the "AI data schema" (field selection) or AI instructions. Fabric.guru says Prep-for-AI is not programmatically writable, but it predates or doesn't address the Authoring MCP explicitly. Treat as unverified.
- Not found: an API to bulk-apply UC AI-generated comments; the docs describe only per-object Catalog Explorer use.

---

## 4. Reverse direction: generating BI artifacts from the governed layer, and migrating PBI reports to Databricks AI/BI

### Takeaway
Databricks now has a **first-party LLM migration path**: Genie Code `/importBI` ingests `.pbit` or `.tmdl`, proposes a plan, flags formulas with no direct match, and creates AI/BI dashboards plus **Unity Catalog metric views**. It also reuses existing UC metric views that already match. Bulk import runs in the background. The reverse (generating PBI models from UC) is covered by Databricks "Publish to Power BI" and the Authoring MCP.

### Cited Findings
- Genie Code imports Tableau (`.twb`, `.twbx`, `.tds`, `.tdsx`) and Power BI (`.pbit`, `.tmdl`). From `.pbit` it creates a dashboard and metric views; from `.tmdl` it creates metric views only. "For Power BI: Genie Code creates Unity Catalog metric views, and reuses existing Unity Catalog metric views that already match your data model." Multiple files can be imported in one request; each runs as a separate background run. — [Microsoft Learn (Azure Databricks): Import BI files using Genie Code](https://learn.microsoft.com/en-us/azure/databricks/dashboards/manage/import-bi)
- Databricks' migration playbook: export `.pbit`, store in a UC volume (required above 100 MB), run `/importBI`. Genie Code "proposes a plan — identifies fact vs. dimension tables, reviews your metric definitions, and flags any formulas with no direct match". The phases are Plan, Prepare, Import & refine (including "iterate with screenshots"), and Productionize (coverage, promote to UC, validate, permissions). It advises starting with reports that already query UC. — [Databricks Community technical blog: Migrate your Dashboards to AI/BI with Genie Code](https://community.databricks.com/t5/technical-blog/migrate-your-dashboards-to-ai-bi-with-genie-code/ba-p/164326)
- Third-party migration guide (as of September 2026): AI/BI dashboard limits are 15 pages per dashboard, 100 datasets per dashboard, and 100 widgets per page. PBI RLS becomes UC row filters, which only apply per viewer under "Individual data permissions" publish mode; the default "Share data permissions" shows every viewer the publisher's view. — [Antares: Power BI to Databricks AI/BI Migration](https://getantares.io/power-bi-to-databricks-ai-bi-migration/)
- A consultancy built a Claude Code "skills file" to migrate PBI dashboards to AI/BI and deploy via Databricks Asset Bundles. On three dashboards of rising complexity: "DAX translates to SQL, Power Query transforms become views, and most standard visual types have a Databricks equivalent". The skills file made later migrations "nearly right on the first attempt". — [CAUCHY: Migrating Power BI dashboards to Databricks AI/BI](https://cauchy.io/blog/migrating-power-bi-to-databricks-aibi/)
- Lakebridge is positioned for warehouse and ETL migration (Oracle, Teradata, Snowflake, Redshift, SQL Server), not BI reports. — [Databricks: Migration / Lakebridge](https://www.databricks.com/solutions/migration)
- Metric views are positioned as making Genie stop guessing (for example fiscal-quarter logic is predefined). — [Databricks: Supercharging Genie Performance With Metric Views](https://answers.databricks.com/supercharging-genie-performance-metric-views-6rEl8md1kT8)

### Inferences
- The "reuses existing UC metric views that already match" behavior is the hook for ALOFT. **[Speculative]** Run rationalization (section 2) *first* and publish canonical metric views. Then bulk `/importBI` of near-duplicate reports (all the `BV Report_*` variants) should converge on those shared views instead of producing one metric view per copy. Whether Genie Code's matching is robust enough is unverified; pilot on one family.
- Snowflake- and Excel-sourced models need data reachable from UC (Lakehouse Federation or volumes) before `/importBI` can work, per the playbook's "start with reports that query UC" advice.
- **[Speculative]** ALOFT could generate draft AI/BI dashboards or Genie spaces directly from harvested PBIR page/visual structure, without exporting `.pbit` by hand. For the ~500 reports, `.pbit` export is manual Desktop work, which is likely the real bottleneck.

### Gaps
- No found accuracy or coverage statistics for Genie Code `/importBI` (share of DAX converted, fidelity).
- Not verified: whether `/importBI` accepts PBIR/PBIP folders directly, or whether Genie Code import is callable via API for batch automation.

---

## 5. Agentic "answer in Databricks, verify against Power BI" reconciliation loops

### Takeaway
All building blocks are documented: Fabric IQ MCP `ValueSearch` + `ExecuteQuery` for the PBI side, Genie/ALOFT SQL for the Databricks side. No published system demonstrates the full dual-execution reconciliation loop. The design is **speculative but low-risk** if confined to user-delegated checks and treated as a disagreement detector, not a source of truth.

### Cited Findings
- Fabric IQ MCP flow: discover → metadata/schema → `ValueSearch` for exact stored values → generate DAX → `ExecuteQuery` → explain. Results respect the user's RLS/OLS and reflect only the last refresh. — [Microsoft Learn: Fabric IQ MCP](https://learn.microsoft.com/en-us/fabric/iq/connectors/fabric-iq-mcp)
- Glean prefers existing governed measures over recomputing from labels when answering from PBI. — [Glean docs](https://docs.glean.com/connectors/native/powerbi/assistant)
- UC metric views can serve as "a single source of truth"; Genie benchmarks compare result sets of generated SQL against gold SQL. — [Databricks blog: Production-ready Genie spaces](https://www.databricks.com/blog/how-build-production-ready-genie-spaces-and-build-trust-along-way); [Microsoft Learn: Test and monitor a Genie Agent](https://learn.microsoft.com/en-us/azure/databricks/genie-agents/monitor)

### Inferences
- **[Speculative] Loop design.** For a KPI question, ALOFT answers from UC (metric view). In parallel it identifies the PBI model(s) that the lineage map says compute the same KPI, runs the existing measure via `ExecuteQuery` at the same grain and filters, and compares. Agreement within tolerance shows a "matches the Power BI 'CII SDK-2025' report" badge. Disagreement triggers an LLM diagnosis (refresh lag, RLS scope, filter difference, definition difference) and logs a drift ticket to section 2's backlog.
- Expected false-alarm sources, from the documented limits: refresh lag (PBI only as fresh as last refresh), RLS differences between users, the 1,000-row cap, and per-model scope. The diagnosis step must check these before calling it a definition conflict.
- Because Fabric IQ MCP needs a signed-in user, reconciliation is naturally per-session. That also makes it a trust feature users can see, not just a backend QA job.

### Gaps
- No case study of dual-engine (DAX vs SQL) answer reconciliation for agents was found.

---

## 6. Multimodal: inferring the business questions each report answers; onboarding questions and FAQ

### Takeaway
Research shows VLMs can turn dashboard pages + schema into natural-language analytical goals (DashArena does exactly this to create tasks). LLM-generated QA candidates need heavy human filtering (ChartAct kept about 36%). *Answering* by interacting with dashboards is still weak for most agents (best 38.7% on DashboardQA). Implication: use LLMs to **write questions from PBIR + screenshots**, and answer them via the semantic layer, not by having an agent click through reports.

### Cited Findings
- DashArena uses "a VLM to observe [human-authored dashboards'] pages, data schema, and interaction features extracted from code, then express the underlying user context, analytical goals, and desired interactions as a natural-language task." — [arXiv 2608.10567 DashArena](https://arxiv.org/html/2608.10567v1)
- ChartAct: GPT-5 generated 6 candidate questions per chart (4,038 candidates). After two-level manual review, 1,440 were retained. The strongest model (Claude-Opus-4.7) averaged 84.5% success on dynamic chart QA; "most models remain below 60%." — [arXiv 2605.26994 ChartAct](https://arxiv.org/html/2605.26994)
- DashboardQA: 112 Tableau Public dashboards, 405 QA pairs generated through a human–VLM collaboration framework. The best agent (Gemini-Pro-2.5) reached only 38.69%; OpenAI CUA 22.69%. — [arXiv 2508.17398 DashboardQA](https://arxiv.org/abs/2508.17398)
- Fabric IQ `GetReportMetadata` returns report pages, visuals, filters, and workspace info. This is a structured alternative or complement to screenshots. — [skills-for-fabric fabriciq SKILL.md](https://github.com/microsoft/skills-for-fabric/blob/main/skills/fabriciq/SKILL.md)
- Genie Code's migration flow includes "iterate with screenshots", so screenshot-driven refinement is an accepted step in the vendor's own workflow. — [Databricks Community blog](https://community.databricks.com/t5/technical-blog/migrate-your-dashboards-to-ai-bi-with-genie-code/ba-p/164326)

### Inferences
- **[Speculative] "Report intent cards."** For each of the ~500 reports, combine PBIR (page titles, visual types, fields bound, filters) with an optional screenshot. Ask an LLM for: the business question each page answers, the audience, and 3–5 onboarding questions. Ground the questions in the measures the visuals actually bind so they can be answered by the semantic layer. Use the ~36% survival rate from ChartAct as a planning prior for human review effort.
- Structured PBIR is likely more reliable than pixels for field-level grounding; screenshots add layout and emphasis cues (titles, KPI cards, color coding of CII A–E ratings). This is unvalidated for PBI specifically.
- Avoid relying on GUI agents to navigate PBI reports for answers, given DashboardQA's results.

### Gaps
- No study specifically on Power BI PBIR + screenshots → question generation was found.

---

## 7. Maritime ontology induction and entity resolution

### Takeaway
Ontology induction from schemas is demonstrated in both product (Fabric IQ "Generate Ontology" from semantic models, including from multiple models, with DAX measures as metrics) and research (RIGOR, taxonomy inference, Schema.org mapping above 90%). Generated ontologies are "structurally complete and semantically mute": synonyms and business vocabulary don't survive. That is precisely where an estate-wide LLM pass over 500 models' names, descriptions, and AI instructions adds value. Entity resolution of vessel/client names had no specific sources.

### Cited Findings
- Fabric IQ Generate Ontology (preview) creates entity types from tables, properties and bindings from columns, relationship types from model relationships, and **metrics from DAX measures**. "You can also pull data into a single ontology from more than one semantic model." Manual steps remain: keys (especially multi-key), relationship bindings, time series, friendly names. Requires Read + Build permission. — [Microsoft Learn: Generate Ontology from Semantic Models](https://learn.microsoft.com/en-us/fabric/iq/ontology/how-to-generate-from-semantic-models)
- Practitioner write-up: the generated ontology is "structurally complete and semantically mute. It knows a monitor connects to a patient. It doesn't know that clinicians call it 'the monitor'… None of that was in a column, so none of it survived generation." On a measured pay-as-you-go build, "the AI meters were 71% of the bill, at roughly ₹40 a question." — [Ravi Chandu Edru: Generate a Fabric IQ ontology from a Power BI semantic model](https://ravichanduedru.me/articles/fabric-iq/generate-ontology-from-semantic-model)
- RIGOR converts relational schemas to OWL ontologies table by table, following foreign keys. It retrieves from schema docs, external domain ontologies, and the growing ontology; a Judge-LLM validates provenance-annotated fragments; it outperformed baselines on three databases. — [arXiv 2506.01232 RIGOR](https://arxiv.org/html/2506.01232v2)
- Taxonomy inference for tables: EmTT (contrastive-tuned embeddings + clustering) and GeTT (iterative GPT-4 prompting with Chain-of-Layer hierarchy) both produced taxonomies consistent with ground truth on three datasets. — [arXiv 2503.21810](https://arxiv.org/abs/2503.21810)
- A multi-agent LLM system mapping tables and columns to Schema.org terms achieved "over 90%" mapping accuracy across domains. — [arXiv 2511.06455](https://arxiv.org/html/2511.06455)
- Hamilton (HPI) generates ontology mappings (concepts, attributes, relationships, join paths) from relational schemas with LLMs, convertible to D2RQ. — [GitHub: HPI-Information-Systems/hamilton](https://github.com/HPI-Information-Systems/hamilton)
- `ValueSearch` exists to find the canonical stored spelling of an entity value before filtering. — [skills-for-fabric fabriciq SKILL.md](https://github.com/microsoft/skills-for-fabric/blob/main/skills/fabriciq/SKILL.md)

### Inferences
- **[Speculative] Estate-scale vocabulary mining.** The ~500 models are effectively 500 noisy, partially overlapping views of the same maritime domain. Clustering table/column/measure names and their DAX across models (EmTT-style) should surface canonical entities (Vessel, Voyage, Port Call, Seafarer/Crew, Client/Owner, Budget Line, Inspection/Audit finding, CII rating) plus the *synonym set* each model uses ("Ship", "Vessel Name", "VSL"). That synonym set is the business vocabulary that Fabric IQ's generator drops and that Genie/ALOFT need.
- **[Speculative] Anchor to external maritime identifiers.** IMO number is the natural join key for vessel entity resolution across Databricks, Snowflake, and Excel sources. An LLM can propose matches for free-text vessel and client names, but final linking should be deterministic on IMO or registry codes wherever present. No source was found validating this for maritime data.
- Fabric IQ ontology could be a cheap "first draft" if the team is on Fabric capacity, but the cost data point (₹40/question AI meters) argues against using it as the runtime query layer when ALOFT already answers from UC.

### Gaps
- No sources found on LLM entity resolution of vessel/client names, or on published maritime ontologies usable as RIGOR-style retrieval context. The IMO-anchoring point is domain reasoning, not sourced.

---

## 8. Impact analysis: UC column changes → which PBI measures and visuals break, plus LLM change notes

### Takeaway
The lineage plumbing exists: Scanner API exposes datasource usage, expressions, and schema; an open-source tool pushes PBI lineage into UC via BYOL external lineage; UC supports column-level impact analysis and Power BI as an external asset. Gaps: UC lineage is not preserved across renames, the open-source tool relies on naming conventions, and column-level resolution into DAX needs parsing. LLM-written change notes are speculative but cheap on top of this.

### Cited Findings
- Scanner API returns inventory, metadata, and lineage, including `datasourceUsages`, dataset `expressions` (M/parameters), RLS configuration, and refresh settings. It supports service principals and incremental scanning. — [Power BI blog: Scanner API more metadata](https://powerbi.microsoft.com/en-ca/blog/new-scanner-api-scenarios/)
- `lineage-syncer` scans PBI via the Scanner API (service principal) and pushes Report → Semantic Model → Databricks Table lineage into UC via BYOL, with dry-run support. It requires admin settings for read-only admin APIs and detailed metadata, requires promoted/curated content, and requires semantic model table naming to match UC `catalog.schema.table`. — [GitHub: JeffDenzel/lineage-syncer](https://github.com/JeffDenzel/lineage-syncer)
- UC lineage supports impact analysis "before changing or deleting a table or column", includes external downstream assets such as Power BI registered as external assets, and is column-level where possible. Limits: "Lineage is not preserved for renamed catalogs, schemas, tables, views, or columns"; data before Sep 1, 2024 is unavailable. — [Microsoft Learn: Lineage in Unity Catalog](https://learn.microsoft.com/en-us/azure/databricks/data-governance/unity-catalog/data-lineage)
- Measure Killer recommends DAX search for a current name as "impact analysis before renaming a table or column." — [Measure Killer: DAX expressions](https://measurekiller.com/docs/how-tos/dax-expressions)

### Inferences
- **[Speculative] Column → measure → visual graph.** UC column → PBI table/column (via M source parsing of Scanner `expressions`; LLMs can help resolve non-trivial Native Query/SQL in M) → DAX measures referencing that column (deterministic DAX reference parsing) → PBIR visuals binding those measures. On a UC schema change (detected from UC information_schema diffs), traverse the graph and have an LLM write a change note per affected report owner: "Your 'Fleet Strength' page, visual 'Active vessels by flag', uses `[Active Vessels]`, which reads `vessel_status`, being renamed to `operational_status` on <date>."
- Because UC lineage drops on rename, ALOFT should keep its own stable ID mapping (Scanner snapshots over time) instead of relying solely on UC lineage for PBI impact.
- `lineage-syncer`'s naming-convention requirement won't hold for Snowflake- and Excel-sourced models; LLM-assisted M parsing is a plausible gap-filler. This is unverified.

### Gaps
- No source found demonstrating LLM-authored BI change notes in production.

---

## 9. Personalization: owners/consumers → per-user default domain and suggested questions

### Takeaway
I found **no sources** in this pass documenting usage-based personalization of an analytics agent from Power BI consumption data. The idea is feasible in principle from admin metadata, but treat it as speculative.

### Cited Findings
- Measure Killer exposes access views by report and workspace type, for example filtering "Access → Reports" to personal workspaces. This suggests per-user access data is extractable at tenant level. — [Measure Killer: Governance](https://measurekiller.com/docs/how-tos/governance-and-monitoring)
- AtScale/Bluemercury used Tableau's built-in usage analytics (report views) to track adoption of governed metrics. — [AtScale: Bluemercury case study](https://www.atscale.com/resource/bluemercury-semantic-layer-case-study/)

### Inferences
- **[Speculative]** Join "user → reports viewed/owned" with "report → domain (from section 6 intent cards) → metric views (from section 2)" to give each ALOFT user a default domain (for example Technical/CII vs Crewing vs Finance/Budgeting) and seeded suggested questions taken from the verified answers and intent cards of the reports they actually use. Usage can also prioritize which near-duplicate copy becomes canonical, by preferring the most-used variant.
- Privacy and HR sensitivity: crew/seafarer and HR attrition reports imply access patterns that may themselves be sensitive. Personalization should respect existing PBI and UC permissions and not leak report existence.

### Gaps
- Not researched in this pass: Power BI Activity Events API / Fabric admin monitoring fields and retention for view-level usage. A follow-up is needed to confirm what per-user view data is available.

---

## 10. Evaluation: auto-generated benchmark sets from reports for continuous accuracy scoring

### Takeaway
Genie natively supports benchmarks (up to 500 questions, result-set comparison against gold SQL, or an LLM judge in agent mode). Practitioners add **definition hashing** to separate intentional metric changes from regressions. The novel ALOFT angle: the PBI estate is a ready-made source of gold answers, because each report visual is a (question, measures, filters, expected values) tuple.

### Cited Findings
- Genie benchmarks: up to 500 questions per agent; chat mode compares result sets against provided SQL; agent mode uses an LLM judge with optional evaluation notes; UC SQL functions can be gold answers; benchmarks are evaluation-only and not used as context. — [Microsoft Learn: Test and monitor a Genie Agent](https://learn.microsoft.com/en-us/azure/databricks/genie-agents/monitor); [Genie Agents concepts](https://learn.microsoft.com/en-us/azure/databricks/genie-agents/concepts)
- TechFabric: golden questions run as new conversations via the Conversation API, logged to MLflow. A metric-view definition hash yields PASS / REVIEW (mismatch and hash changed, so a person decides) / REGRESSION (mismatch and hash unchanged). — [TechFabric: Why Genie benchmarks miss metric definition changes](https://www.techfabric.com/blog/we-caught-a-genie-metric-change-its-own-benchmark-missed)
- Databricks internally runs nightly Genie benchmarks via the Genie spaces API and messages space authors on failures. — [Databricks: Supercharging Genie Performance With Metric Views](https://answers.databricks.com/supercharging-genie-performance-metric-views-6rEl8md1kT8)
- Verified answers encode question phrasings linked to specific measure/column/filter projections, and are retrievable via `GetSemanticModelSchema`. — [Fabric.guru](https://fabric.guru/programmatically-retrieve-prep-data-for-ai-configuration-of-semantic-models); [Microsoft Learn: Verified answers](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai-verified-answers)

### Inferences
- **[Speculative] PBI-derived golden set.** For each high-usage report visual: LLM writes a natural question (section 6), the gold answer is produced by executing the *existing PBI measure* via DAX (section 5) at the visual's grain and filters, and the question is stored with a definition hash of both the PBI measure DAX and the UC metric view. ALOFT/Genie are scored nightly. This gives three verdicts as in TechFabric, plus a fourth: **PBI–UC divergence** (UC answer is consistent over time but disagrees with PBI), which feeds the drift backlog.
- Verified answers authored by business users are the highest-quality seed questions (human-phrased, human-approved). Harvest them first.
- Freshness and RLS caveats from section 1 apply: gold values from PBI must be captured with the refresh timestamp and a fixed evaluator identity.

### Gaps
- No public example of building agent benchmarks from BI report visuals was found.

---

## 11. Published case studies (2024–2026) of LLMs applied to PBI/Tableau estates

### Takeaway
Credible public evidence is thin and mostly vendor-authored. The strongest LLM-specific claim is Hakkoda's (4,000 PBI reports rationalized to 18), but it is self-reported. Other semantic-layer consolidation case studies (Guitar Center/Omni, Bluemercury/AtScale, OTTO/Exasol) are real but not clearly LLM-driven. The Databricks/Genie Code and CAUCHY materials are tooling demonstrations, not enterprise case studies.

### Cited Findings
- Hakkoda (IBM): copilot-driven discovery, metric identification, and SQL consolidation; 4,000 Power BI reports; 91.5% consolidated/rationalized; 18 key reports; 34% runtime/consumption efficiency; 4-week plan versus 10-month SI estimate; 3-month project. Vendor claim. — [Hakkoda](https://hakkoda.io/3-phase-bi-rationalization-migration-with-hakkoda-ai/)
- phData / Guitar Center: 83 Tableau dashboards migrated to Omni in 11 weeks with a semantic layer. Later 150+ dashboards were recreated and Tableau shut down within six months; Tableau, Power BI, Excel, and MicroStrategy were unified. The AI helper "gets you 80–90% of the way there" for workbook building. AI is not described as driving the migration itself. — [phData case study](https://www.phdata.io/case-studies/phdata-helps-leading-music-retailer-migrate-83-tableau-dashboards-to-omni-in-11-weeks/); [Omni: Guitar Center](https://omni.co/blog/case-study-guitar-center)
- Bluemercury / AtScale: centralized semantic layer consumed by Power BI and Tableau; started with three KPIs (net sales, gross sales, margin); metric owners assigned; 80% of business data integrated; framed as an "AI-ready" foundation. Not an LLM-driven consolidation. — [AtScale](https://www.atscale.com/resource/bluemercury-semantic-layer-case-study/)
- OTTO / Exasol: business logic scattered across ETL, views, and BI tool configs was centralized into a virtual-schema semantic layer serving multiple BI tools. Not LLM-driven. — [Exasol](https://www.exasol.com/customer-stories/otto-semantic-layer/)
- CAUCHY: practitioner proof of concept migrating three PBI dashboards to AI/BI with Claude Code and a skills file. — [CAUCHY](https://cauchy.io/blog/migrating-power-bi-to-databricks-aibi/)

### Inferences
- The recurring success pattern in non-LLM case studies (start with a few contested KPIs, assign owners, measure adoption) is what the LLM pipeline should feed, not replace. LLMs shrink discovery and diffing time; owner decisions remain human.

### Gaps
- No independent (non-vendor) quantitative study of LLM-driven BI estate rationalization or migration was found.
- No maritime- or shipping-industry case study was found.

---

## Cross-cutting risks (sourced where possible)

- **Hallucinated or plausible-but-wrong descriptions**, especially for ambiguous columns; LLM-as-judge is unreliable for grading them. — [arXiv 2408.04691](https://arxiv.org/abs/2408.04691); [Databricks AI comments: human review, not for PII](https://docs.databricks.com/gcp/en/comments/ai-comments)
- **Write-back blast radius:** the Authoring MCP can change "hundreds of objects at once". Restrict it to TMDL/PBIP in source control with PR review, and use transactions/rollback. — [Microsoft Learn: Authoring MCP](https://learn.microsoft.com/en-us/power-bi/developer/mcp/power-bi-authoring-mcp); [GitHub tool list](https://github.com/microsoft/powerbi-modeling-mcp/)
- **Identity and RLS skew** in PBI-as-oracle and in PBI-derived gold answers; no service-principal support on Fabric IQ MCP. — [Microsoft Learn: Fabric IQ MCP](https://learn.microsoft.com/en-us/fabric/iq/connectors/fabric-iq-mcp)
- **Feature interaction:** enabling Fabric IQ disables verified answers in Copilot. — [Microsoft Learn: Verified answers](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai-verified-answers)
- **Migration RLS trap:** AI/BI default publish mode shows the publisher's data to all viewers. — [Antares](https://getantares.io/power-bi-to-databricks-ai-bi-migration/)
- **Cost:** Fabric IQ AI meters dominated a measured ontology build's bill. — [Ravi Chandu Edru](https://ravichanduedru.me/articles/fabric-iq/generate-ontology-from-semantic-model)
- **Lineage breaks on renames** in UC. — [Microsoft Learn: UC lineage](https://learn.microsoft.com/en-us/azure/databricks/data-governance/unity-catalog/data-lineage)
- **Repo rule reminder (ALOFT):** any reconciliation or execution loop against Databricks must stay read-only per workspace rules. The PBI Authoring MCP write path is a separate governance decision.
