# Vendor LLM tooling that builds, enriches, migrates, or bridges semantic layers (state as of Nov 2026)

Scope note: this covers vendor features and third-party tools where an LLM (or a deterministic translator that an LLM pipeline could reuse) works on semantic models, or connects BI tools to warehouses. ALOFT context: semantic layer on Databricks Unity Catalog (UC); about 500 Power BI semantic models, many on Databricks SQL warehouses, some on Snowflake or Excel/SharePoint. Status labels (GA, Public Preview, Beta) come from the cited page at the time it was fetched. "Vendor claim" means the number comes from the vendor. "Independent" means a third party produced it.

## Databricks: Genie, metric views, AI comments, Power BI integration, and migration

### Takeaway
Databricks now has a first-party, LLM-driven Power BI-to-metric-view migrator: the Genie Code `/importBI` skill. It reached GA in Aug 2026 and accepts `.pbit`, `.tmdl`, and PBIR (Beta), with bulk import of up to 100 files. Practitioners report it works for simple models and breaks down on calculation groups, field parameters, cross-fact measures, and time intelligence. At query time, Genie's knowledge store, metric-view agent metadata (YAML 1.1 synonyms and display names), trusted assets, and benchmarks are the levers that map most directly to ALOFT's NL-to-SQL needs.

### Cited Findings
**Genie knowledge store, example SQL, trusted assets, benchmarks**
- The knowledge store is "a collection of curated semantic definitions." It holds agent-level table and column descriptions, synonyms, focused datasets, prompt matching (format assistance and entity matching), join relationships, and SQL expressions (measures, filters, dimensions). — [Databricks: Tune Genie Agent quality](https://docs.databricks.com/aws/en/genie-agents/tune-quality)
- Limit: 200 knowledge-store snippets per Genie Agent. Table descriptions, join relationships, and SQL expressions count toward it. Text instructions, example SQL, SQL functions, column descriptions, and prompt-matching settings do not. — [Databricks: Tune Genie Agent quality](https://docs.databricks.com/aws/en/genie-agents/tune-quality)
- Knowledge-store configuration is scoped to the agent and does not change UC metadata. — [Databricks: Genie Agents concepts](https://docs.databricks.com/aws/en/genie-agents/concepts)
- Trusted assets are parameterized example SQL queries and UC SQL functions. When Genie answers with one, the response is labeled verified or "Trusted". Users need `EXECUTE` on the functions. — [Databricks: Tune Genie Agent quality](https://docs.databricks.com/aws/en/genie-agents/tune-quality); [Azure Databricks: Add SQL examples and instructions](https://learn.microsoft.com/en-us/azure/databricks/genie/add-instructions)
- Recommended order of curation: SQL expressions for business terms, then example SQL for complex questions. Text instructions come "only as a last resort." — [Azure Databricks: Curate an effective Genie Agent](https://learn.microsoft.com/en-us/azure/databricks/genie-agents/best-practices)
- Benchmarks are evaluation-only: "Genie does not use benchmark questions or SQL to improve its context." — [Databricks: Genie Agents concepts](https://docs.databricks.com/aws/en/genie-agents/concepts)
- Benchmark timeline: Benchmark APIs reached Beta in Mar 2026. Agent-mode benchmarks with an optional "evaluation note to guide LLM-based grading" arrived in May 2026. Benchmark questions run in parallel as of Nov 2026. — [Databricks AI/BI & Genie One release notes 2026](https://docs.databricks.com/gcp/pt/ai-bi/release-notes/2026)
- Each Genie Agent supports up to 50 tables, views, or metric views, up from 30 (Sep 2026). — [Release notes 2026](https://docs.databricks.com/gcp/pt/ai-bi/release-notes/2026)
- "Export context as metric view": a Genie Agent's context can be exported as a metric view (May 2026), with Genie Code refining the definition. — [Release notes 2026](https://docs.databricks.com/gcp/pt/ai-bi/release-notes/2026)

**Genie Ontology, Genie One MCP, and business-term Pages**
- Genie Ontology (Public Preview since Jun 2026, enabled by default since Aug 2026) "automatically builds and maintains a map of your business by extracting and ranking knowledge from sources such as dashboards, notebooks, and pipelines." — [Release notes 2026](https://docs.databricks.com/gcp/pt/ai-bi/release-notes/2026)
- In Oct 2026, Genie Ontology began extracting snippets "from queries that external tools, such as dbt, run on Databricks." — [Release notes 2026](https://docs.databricks.com/gcp/pt/ai-bi/release-notes/2026)
- Genie One MCP server (`system.ai.genie_one_mcp`) is GA. A Genie Agent MCP endpoint is in Public Preview. Pages (Beta) are governed definitions of business terms that Genie One prioritizes and cites. The `system.certification_status` tag marks assets certified or deprecated, which steers Genie One. — [Databricks answers: give AI agents the right business definitions](https://answers.databricks.com/give-ai-agents-right-business-definitions-metrics) (vendor explainer page)

**Metric views and agent metadata**
- YAML spec 1.1 adds `display_name` (up to 255 characters), `format`, and `synonyms` (up to 10 per field or measure, 255 characters each), plus an optional `comment`. It requires DBR 17.3+. "Synonyms help LLM tools, such as Genie, discover fields... and measures." — [Databricks: Agent metadata in metric views](https://docs.databricks.com/aws/en/uc-semantics/agent-metadata); [Metric view YAML reference](https://docs.databricks.com/aws/en/uc-semantics/metric-views/yaml-reference)
- Gotcha: when a metric view is created or altered under spec 1.1, YAML `#` comments are stripped. Use the `comment` field instead. — [Databricks: Agent metadata in metric views](https://docs.databricks.com/aws/en/uc-semantics/agent-metadata)
- Genie Agents import metric-view synonyms automatically. — [Databricks answers](https://answers.databricks.com/give-ai-agents-right-business-definitions-metrics). An Aug 2026 bug fix addressed metric-view synonyms "not used as context for the agent." — [Release notes 2026](https://docs.databricks.com/gcp/pt/ai-bi/release-notes/2026)
- All measure evaluation must use `MEASURE()` (or the `AGG` alias on DBR 18.1+). Metric views reject `SELECT *`. — [Azure Databricks: Use metric views with external BI tools](https://learn.microsoft.com/en-us/azure/databricks/uc-semantics/metric-views/bi-tools)
- Metric views are a Spark SQL feature: Apache Spark 4.2.0 added `CREATE VIEW ... WITH METRICS`. — [Databricks answers](https://answers.databricks.com/give-ai-agents-right-business-definitions-metrics)

**AI-generated comments**
- An LLM generates comments for catalogs, schemas, tables, views, materialized views, columns, functions, and models. Its input is "object metadata, such as the table schema and column names." Generation is per object, on request in Catalog Explorer, with an accept-or-edit review step. There is no workspace-level toggle. — [Azure Databricks: AI-generated comments](https://learn.microsoft.com/en-us/azure/databricks/comments/ai-comments)
- Limits: "comments must be reviewed prior to saving," and the model "should not be relied on for data classification tasks such as detecting columns with PII." — [Azure Databricks: AI-generated comments](https://learn.microsoft.com/en-us/azure/databricks/comments/ai-comments)

**Power BI integration (Databricks to Power BI)**
- Publish to Power BI service: Catalog Explorer can publish UC tables or schemas as a Power BI semantic model (DirectQuery or Import). It requires Premium, PPU, or Fabric capacity, XMLA read-write, and UC (no Hive metastore). Publishing into an existing dataset appends and does not overwrite. — [Databricks: Publish to Power BI service](https://docs.databricks.com/aws/en/partners/bi/power-bi/service)
- Publishing carries PK/FK relationships ("synchronizes entire schemas, including table relationships") and copies UC column comments into Power BI column descriptions. — [Databricks blog: GA Publish to Power BI](https://www.databricks.com/blog/announcing-general-availability-publish-microsoft-power-bi-service-unity-catalog); [Databricks SA Medium post](https://medium.com/databrick-solutions-architect-blogs/the-best-of-databricks-loaded-straight-to-your-power-bi-models-7c271cd464ea)
- Microsoft has removed the "Metric View BI Compatibility Mode" option from the Databricks Power BI connector, and "reports that use it no longer function." The supported path is Native query plus `MEASURE()` in DirectQuery, or a wrapper view with one view per dimension combination. — [Databricks: Power BI with Databricks](https://docs.databricks.com/aws/en/partners/bi/power-bi/); [Azure Databricks: metric views with BI tools](https://learn.microsoft.com/en-us/azure/databricks/uc-semantics/metric-views/bi-tools)

**Migration: Genie Code `/importBI`**
- Inputs: `.twb`, `.twbx`, `.tds`, `.tdsx`, `.pbit`, `.tmdl`, uploaded to chat (100 MB cap) or referenced from a UC volume. A `.pbit` produces an AI/BI dashboard plus metric views. A `.tmdl` produces metric views only. — [Databricks: Import BI files using Genie Code](https://docs.databricks.com/aws/en/dashboards/manage/import-bi)
- For Power BI, it creates UC metric views and "reuses existing Unity Catalog metric views that already match your data model." Tableau defaults to local (dashboard-scoped) metric views. — [Databricks: Import BI files](https://docs.databricks.com/aws/en/dashboards/manage/import-bi)
- Bulk import takes 2–100 files from a UC volume, with one background run per file. It requires partner-powered AI features at both account and workspace level. — [Databricks: Import BI files](https://docs.databricks.com/aws/en/dashboards/manage/import-bi)
- Timeline: Beta in May 2026, Public Preview in Jul 2026, GA in Aug 2026. PBIR support (Beta) came in Jun 2026, `.tmdl` import and 100-file bulk import in Oct 2026. Ranked table calculations and dashboard relationships detected from source files were also added during 2026. — [Release notes 2026](https://docs.databricks.com/gcp/pt/ai-bi/release-notes/2026)
- Human review happens through a plan-then-approve workflow. Genie unpacks the model and visuals, writes a plan listing what it will omit, and builds metric views and then dashboards after approval. — [Databricks Community: How good is /importBI?](https://community.databricks.com/t5/genie-hub/how-good-is-the-new-importbi-genie-skill/td-p/162083) (independent practitioner)
- Failure modes, from the same independent source:
  - Calculation groups have no metric-view equivalent; the workaround is static YTD/QTD/MTD measures per metric.
  - Field parameters are omitted.
  - Cross-fact measures are not possible.
  - `USERPRINCIPALNAME()` is not handled.
  - Some measures landed on the wrong fact table.
  - Its verdict: "For anything production-grade... expect a significant amount of manual work." — [Databricks Community](https://community.databricks.com/t5/genie-hub/how-good-is-the-new-importbi-genie-skill/td-p/162083)
- DAX-to-metric-view pattern mapping from a third-party migration guide:
  - Plain aggregates and `DIVIDE` convert directly.
  - `CALCULATE` with a filter maps to `FILTER (WHERE ...)`, with review. CALCULATE replaces filters, while SQL FILTER intersects with them.
  - `ALL`/`REMOVEFILTERS` maps to `AGGREGATE OVER (PARTITION BY * EXCEPT ...)`.
  - Time intelligence needs a date dimension.
  - Calculation groups require a redesign. — [Antares: Power BI to Databricks AI/BI migration](https://getantares.io/power-bi-to-databricks-ai-bi-migration/) (consultancy/vendor content)

**Databricks Labs and SA-built deterministic migrators**
- `databrickslabs/kasal` includes a Power BI-to-UC Metric View toolkit. The pipeline runs an M-Query parser, then a DAX translator ("14+ patterns"), a topological sort of measure dependencies (Kahn's algorithm), a join detector, and YAML and SQL emitters. It claims to be "deterministic, validated, 70-93% automated." — [kasal migration story](https://github.com/databrickslabs/kasal/blob/main/src/docs/powerbi/02-simple-migration-story.md); [kasal tool-86](https://github.com/databrickslabs/kasal/blob/main/src/docs/powerbi/tool-86-uc-metric-view-generator.md)

### Inferences
- `/importBI` takes files (`.pbit`, `.tmdl`) but not Scanner API JSON. To use it for ALOFT's ~500 models, the team would need to export TMDL or PBIT per model, for example with the Power BI Authoring MCP `database_operations` TMDL export. Alternatively, they can feed Scanner output into their own translator.
- With BI Compatibility Mode removed, Power BI models cannot transparently consume UC metric views. A "migrate DAX into metric views" strategy therefore either replaces Power BI for those reports or leaves Power BI issuing native-query SQL. Running both semantic layers in parallel will likely last a long time.
- Genie Ontology mining queries from external tools (dbt is named) suggests that Power BI DirectQuery SQL hitting Databricks warehouses could become mined context too. Databricks does not document Power BI by name.
- The Genie knowledge-store shape (descriptions, synonyms, joins, SQL expressions, example SQL, benchmarks) is a reusable target schema for whatever ALOFT extracts from Power BI. DAX measures become candidate SQL expressions, report visuals become candidate example SQL, and verified answers become candidate benchmarks.

### Gaps
- I found no published Databricks accuracy figures for Genie, the knowledge store, or `/importBI` conversion rates. The 70–93% figure is kasal's own claim, and its methodology was not checked.
- I found no documentation on whether `/importBI` uses Power Query M to resolve which Databricks tables back a model, or how it handles Snowflake- or Excel-sourced Power BI models.
- I found no official Databricks roadmap for direct Power BI semantic-model sync (metric view to Power BI measures) beyond "Publish to Power BI", which handles tables, relationships, and comments.

## Microsoft: Power BI Copilot, Fabric data agents, Prep data for AI, semantic link, and MCP servers

### Takeaway
Microsoft keeps NL-to-query grounding inside the semantic model. Prep data for AI (AI data schema, verified answers, AI instructions, plus descriptions) is stored on the model and is the only guidance the DAX generator sees; Fabric data-agent instructions are ignored for DAX. On the integration side, the Fabric IQ MCP server provides read-only schema, value search, and DAX, but only with delegated user auth. The Power BI Authoring MCP server (local GA, hosted preview) exposes full read/write TMDL-level model access to agents.

### Cited Findings
**Prep data for AI (labeled Preview on the Learn page title)**
- The four tooling features are: AI data schema (a subset of tables, fields, and measures), verified answers (visual plus trigger phrases), AI instructions (model-level business context and term mappings), and descriptions. "Copilot uses descriptions only in DAX queries and search capabilities." — [Power BI: Prep data for AI FAQ](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai-faq); [Prep data for AI (Preview)](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai)
- AI data schema limits:
  - Report-page creation, data search, and DAX query mode use the entire model and ignore the AI data schema.
  - Copilot still follows relationships to fields outside the schema.
  - Hidden fields are excluded from the initial selection by default.
  - Consumers can't see or disable the schema. — [Power BI: AI data schemas](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai-data-schema)
- Verified answers: "Copilot first checks for an exact or semantically similar match to any trigger phrase." On a match it returns the stored visual instead of generating a new answer. Verified answers are model-level and work across every report on the model. Authoring them requires a Copilot-enabled workspace and build or author permission. — [Power BI: Verified answers](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai-verified-answers)
- AI instructions example from the docs: an instruction defining "busy season" as June to August. — [Prep data for AI FAQ](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai-faq)

**Fabric data agents over semantic models**
- "The DAX generation tool used by data agent relies solely on the semantic model's metadata and Prep for AI configurations. The DAX generation tool ignores any instructions you add at the data agent level." Data agents also don't support data-source instructions or descriptions for semantic models. — [Fabric: Semantic model best practices for data agent](https://learn.microsoft.com/en-us/fabric/data-science/semantic-model-best-practices)
- Recommended workflow:
  1. Optimize the model, using Best Practice Analyzer and Memory Analyzer in notebooks.
  2. Set the AI data schema.
  3. Add verified answers, triggered by "complete, robust questions."
  4. Validate, then add AI instructions.
  5. Prepare report visuals, including hidden ones. — [Fabric: Semantic model best practices](https://learn.microsoft.com/en-us/fabric/data-science/semantic-model-best-practices)
- A checklist notebook exists in `microsoft/fabric-toolbox` (for example: exclude duplicate measures, don't hide fields that verified answers use). — [fabric-toolbox checklist](https://github.com/microsoft/fabric-toolbox/blob/main/samples/data_agent_checklist_notebooks/Semantic%20Model%20Data%20Agent%20Checklist.md)
- Practitioner guidance: source-routing rules go at the agent level, and term-to-measure mappings ("Revenue" means `Net Sales Amount`) go in Prep for AI. — [James Serra blog, Oct 2026](https://www.jamesserra.com/archive/2026/10/prep-data-for-ai-vs-fabric-data-agent-instructions-what-goes-where/)
- Microsoft's `skills-for-fabric` repo has an AI-readiness reference for agents authoring models. It notes "Implicit aggregations are not reliably accessible to Copilot" and recommends explicit measures. — [skills-for-fabric AI readiness](https://github.com/microsoft/skills-for-fabric/blob/main/plugins/powerbi-authoring/skills/semantic-model-authoring/references/semantic-model-ai-readiness.md)

**Fabric semantic link (SemPy)**
- `sempy.fabric` exposes `list_datasets()`, `list_measures(dataset)`, `evaluate_measure(dataset, measure=..., groupby_columns=..., filters=...)`, and `read_table()`. It uses the Power BI REST APIs by default, or XMLA with `use_xmla=True`. It runs in Fabric notebooks. — [Fabric tutorial: extract and calculate Power BI measures](https://learn.microsoft.com/en-us/fabric/data-science/tutorial-power-bi-measures); [Read/write semantic models with Python](https://learn.microsoft.com/en-us/fabric/data-science/read-write-power-bi-python)

**MCP servers**
- **Fabric IQ MCP** (remote, `https://fabriciq.svc.cloud.microsoft/v1/mcp/fabriciq`) is Microsoft's primary consumption server. It is read-only, with these tools: `DiscoverArtifacts`, `ResolveFabricItem`, `GetReportMetadata`, `GetSemanticModelSchema`, `ValueSearch`, `ExecuteQuery` (DAX). — [Fabric IQ MCP](https://learn.microsoft.com/en-us/fabric/iq/connectors/fabric-iq-mcp)
- Fabric IQ MCP limits: "Service-principal authentication isn't supported," and app-only auth isn't either. Each `ExecuteQuery` targets one model with no cross-model joins, and returns 250 rows by default with CSV for larger results. RLS and OLS apply per user. It is unavailable in Power BI-only regions and sovereign clouds, and does not cover dashboards, paginated reports, apps, ontologies, or data agents. — [Fabric IQ MCP](https://learn.microsoft.com/en-us/fabric/iq/connectors/fabric-iq-mcp)
- **Power BI Consumption MCP** is the earlier endpoint, still in preview. Microsoft now points users to Fabric IQ instead. Its tools are Execute Query, Get Semantic Model Schema, Get Report Metadata, and Generate Query.
  - Get Semantic Model Schema returns tables, columns, measures, relationships, hierarchies, and "Copilot tooling metadata, when configured."
  - Generate Query uses "the same DAX generation engine as Copilot for Power BI." — [Power BI Consumption MCP](https://learn.microsoft.com/en-us/power-bi/developer/mcp/remote-mcp-server-get-started)
- **Power BI Authoring MCP** (formerly "Modeling MCP"; repo `microsoft/powerbi-modeling-mcp`, npm `@microsoft/powerbi-modeling-mcp`) comes in two forms:
  - Local over stdio, GA. It works with Power BI Desktop, PBIP/TMDL on disk, and Fabric workspaces, and supports service principals, transactions, and AS traces.
  - Hosted at `https://api.fabric.microsoft.com/v1/mcp/powerbi/authoring`, in preview. It supports Fabric workspaces only, with Entra user auth.
  - Its tools cover connections, database operations (including TMDL import and export), tables, columns, measures, relationships, DAX query, partitions, calculation groups, RLS roles, perspectives, named expressions and Power Query parameters, DAX UDFs, translations, calendars, and query groups. — [Power BI Authoring MCP](https://learn.microsoft.com/en-us/power-bi/developer/mcp/power-bi-authoring-mcp); [GitHub: microsoft/powerbi-modeling-mcp](https://github.com/microsoft/powerbi-modeling-mcp/)
- Third-party summary: the local server was released in Nov 2025, and the remote preview was announced in the Power BI Sep 2026 feature summary. PBIP is GA and PBIR is the default report format. — [Solv: Power BI Authoring MCP explained](https://solv-systems.com/resources/power-bi-modeling-mcp-server)

### Inferences
- For ALOFT, Prep for AI artifacts (AI instructions, verified-answer trigger phrases, AI data schema selections) are the highest-signal human-authored NL hints in the Power BI estate. They are stored on the model and should be harvested alongside DAX. Their exposure through the Scanner API was not verified (see Gaps). The Consumption MCP's `Get Semantic Model Schema` does return them ("Copilot tooling metadata").
- Fabric IQ MCP rejects service principals, so a backend batch harvester like ALOFT's cannot use it. It suits per-user, interactive live bridging (an ALOFT agent calling Power BI DAX on a user's behalf). For batch extraction, the local Authoring MCP with a service principal, the Scanner API, XMLA, and SemPy are the viable paths.
- The local Authoring MCP's TMDL export plus `dax_query_operations` gives a programmatic way to produce the `.tmdl` inputs that Databricks `/importBI` and Snowflake Autopilot expect, and to check translated measures by running the original DAX for ground-truth values.

### Gaps
- I did not confirm whether the Admin Scanner API (`getInfo` with `datasetSchema`/`datasetExpressions`) returns Prep for AI artifacts (AI instructions, verified answers, AI data schema). This needs direct testing against the tenant.
- I found no published Microsoft accuracy numbers for Copilot or data-agent DAX generation.
- I found no Microsoft tool that translates DAX to SQL or exports Power BI semantics to another semantic layer.

## Snowflake: Cortex Analyst, semantic views, Autopilot, and Power BI/Tableau ingestion

### Takeaway
Snowflake has the most mature Power BI-to-warehouse semantic migration path. Semantic View Autopilot ingests `.pbit`/`.pbix` (GA Aug 18, 2026) and Tableau files, then turns DAX measures into semantic-view metrics. It then runs an evaluation-and-"Improve" loop based on verified queries, with an LLM judge and query-history mining. This loop is the most directly reusable pattern for ALOFT.

### Cited Findings
- Power BI ingestion is GA as of Aug 18, 2026. It preserves "DAX measures, table relationships, and column descriptions." Report-level measures and time intelligence (`PREVIOUSMONTH`, `SAMEPERIODLASTYEAR`, `TOTALYTD`) are "not yet fully supported." — [Snowflake release note 2026-08-18](https://docs.snowflake.com/en/release-notes/2026/other/2026-08-18-semantic-views-power-bi-ingestion-ga)
- How the mapping works:
  - Tables and columns are matched to Snowflake tables and columns.
  - Relationships are kept unless a semantic view can't represent them; dropped ones are "named in the response."
  - Single-table, cross-table, and derived DAX measures become metrics.
  - Single-table calculated columns become dimensions.
  - `Table.RenameColumns` renames in M are honored.
  - Primary keys, including composite keys, are auto-detected. — [Snowflake: Power BI ingestion feature support](https://docs.snowflake.com/en/user-guide/views-semantic/power-bi-ingestion)
- What doesn't convert: report-saved measures, time intelligence, statistical aggregates, and anything that depends on reader selection. A converted measure "can also convert and still be rejected as a metric." Files must be under 250 MB, and users need read access to the underlying tables. — [Snowflake: Power BI ingestion](https://docs.snowflake.com/en/user-guide/views-semantic/power-bi-ingestion)
- Tableau ingestion (`.twb`, `.twbx`, `.tds`, `.tdsx`) requires a direct Snowflake connection and does not support LOD calculations or virtual connections. Custom SQL becomes a regular Snowflake view, which needs CREATE VIEW. — [Snowflake: Tableau ingestion](https://docs.snowflake.com/en/user-guide/views-semantic/tableau-ingestion)
- Autopilot "covers creation", while refinement and deployment happen in Semantic Studio. Developer-guide tips: give 2–5 gold SQL queries (used to infer relationships and possibly added as verified queries), keep to about 50 columns or fewer, and enable sample values and AI-generated descriptions. — [Snowflake: Semantic View Autopilot](https://docs.snowflake.com/en/user-guide/views-semantic/autopilot); [Snowflake guide: How to ingest Power BI semantic models](https://www.snowflake.com/en/developers/guides/how-to-ingest-power-bi-semantic-models/)
- Optimization from verified queries: Cortex Analyst infers generalizable concepts from them. For example, a verified "active users" query yields an `is_active` filter. Each verified query may run up to 4 times, and a run can take hours. — [Snowflake: Optimize with verified queries](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/analyst-optimization)
- Evaluations: verified queries serve as ground truth. Cortex Analyst builds a temporary semantic view without the evaluated queries, which prevents leakage. It reports accuracy, regressions, latency, and expected versus generated SQL. Limits: one semantic view per run, no multi-turn, and "No auto-generated evaluation datasets." — [Snowflake: Cortex Analyst evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst-evaluations)
- "Agentic Optimize" compares generated SQL against known-correct queries, scores with an LLM judge, and applies targeted fixes. It analyzes up to 50 verified queries into "a single comprehensive diff" of descriptions, metrics, filters, synonyms, and custom instructions, and shows before and after scores. — [Snowflake engineering: Using AI to improve AI](https://www.snowflake.com/en/blog/engineering/using-ai-improving-ai/)
- Query-history mining extracts verified queries, metrics and facts (where analysts converge on the same formula), filters, and relationships from account query history. — [Snowflake engineering: Query history mining](https://www.snowflake.com/en/blog/engineering/mining-query-history-to-build-better-semantic-models-for-ai/)
- **Vendor claim:** on 4 BIRD subsets, accuracy was 57% for vanilla Claude 3.5 Sonnet versus 78% for Cortex Analyst with the agent-improved semantic model. That is +21 points on average; per-subset gains ranged from +10 to +31. The architecture is an orchestrator with relationship, semantic-model-editor, and evaluator agents. — [Snowflake engineering: Agentic semantic model improvement](https://www.snowflake.com/en/blog/engineering/agentic-semantic-model-text-to-sql/)

### Inferences
- The Power BI table-matching step (Power BI tables mapped to Snowflake tables) and the Tableau "Snowflake connections only" rule suggest Snowflake ingestion is only useful for ALOFT's Snowflake-backed Power BI models, not the Databricks-backed ones.
- The pipeline of verified queries, evaluation with a held-out temporary model, an LLM-judge diff, and human acceptance is a well-documented blueprint ALOFT can copy on Databricks. The equivalents are Genie benchmarks (evaluation-only), example SQL and SQL expressions (context), and Genie's benchmark APIs.

### Gaps
- No published per-measure conversion rate for Power BI ingestion on real enterprise models.
- The BIRD benchmark result is a vendor claim from an older model (Claude 3.5 Sonnet), and I found no independent replication.

## dbt, AtScale, Cube, Looker, Tableau, ThoughtSpot: LLM generation and translation of semantic definitions

### Takeaway
Every semantic-layer vendor now ships an LLM "modeling agent" that drafts models or metrics from warehouse schema plus a natural-language goal, with human review and a validator. Translation from other BI formats is rarer. The documented cases are AtScale's open-source Power BI→SML converter, Cube's LookML→Cube conversion, ThoughtSpot's import from Snowflake and dbt, and the emerging Apache Ossie interchange format. Only Looker has independent accuracy evidence that a semantic layer beats direct SQL.

### Cited Findings
**dbt Semantic Layer / MetricFlow**
- In dbt v1.12+, semantic models are metadata on dbt models in YAML. They can also be defined as Apache Ossie documents. The docs tip says "Use dbt Wizard to generate semantic models." — [dbt: Semantic models](https://docs.getdbt.com/docs/build/semantic-models)
- A third-party comparison says dbt Copilot generates semantic-model YAML on Starter and higher plans, but "does not yet generate semantic models in the latest YAML spec." This conflicts with, or predates, the docs' "dbt Wizard" naming; the current product name is unclear. — [Galaxy: Automated semantic modeling tools (Oct 2026)](https://www.getgalaxy.io/articles/automated-semantic-modeling-tools-evaluation)
- dbt's official agent skill sets a validation gate: run `dbt parse`, then `dbt sl validate` or `mf validate-configs`. "Do not consider work complete until both validations pass." — [dbt-labs/dbt-agent-skills](https://github.com/dbt-labs/dbt-agent-skills/blob/main/skills/dbt/skills/building-dbt-semantic-layer/SKILL.md)
- dbt MCP Semantic Layer tools: `list_metrics`, `get_dimensions`, `get_entities`, `get_dimension_values`, `get_metrics_compiled_sql`, `query_metrics`, `list_saved_queries`. The local server adds codegen and dbt commands. "Remote MCP tools can change without notice." — [dbt: MCP available tools](https://docs.getdbt.com/docs/dbt-ai/mcp-available-tools)
- MetricFlow is Apache 2.0. "The Open Semantic Interchange became Apache Ossie in July 2026." — [Galaxy](https://www.getgalaxy.io/articles/automated-semantic-modeling-tools-evaluation) (third-party; the Ossie claim is corroborated by dbt docs and ThoughtSpot referencing Ossie)

**AtScale**
- AtScale has open-sourced converters: Power BI→SML, dbt→SML, and SML→Snowflake Semantic Views. SML (Semantic Modeling Language) is positioned as a vendor-neutral standard. — [AtScale blog](https://snowflake.atscale.com/blog/atscale-launches-power-bi-dbt-snowflake/); [GitHub: semanticdatalayer/sml-converters](https://github.com/semanticdatalayer/sml-converters)
- The `dbt-to-sml` CLI accepts `--dbType bigquery|snowflake|postgresql|databricks|iris`. — [sml-converters](https://github.com/semanticdatalayer/sml-converters)

**Cube**
- The Semantic Model Agent "can bootstrap data models from scratch based on tables in your cloud data warehouse, convert existing projects (like LookML files) into Cube data models," and add measures, dimensions, joins, and views. D3 was folded into "Cube". — [Cube: Agentic Analytics](https://cube.dev/blog/cube-agentic-analytics)
- Jan 2026: AI onboarding generates a starter model from warehouse schema. "Before finalizing the model, the agent verifies the updated definitions by querying the updated semantic model," and then shows a change summary. — [Cube: Jan 2026 updates](https://cube.dev/blog/whats-new-in-cube-january-2026-product-updates)

**Looker (LookML + Gemini)**
- The LookML Assistant ("Help me code") generates dimensions, dimension groups, and measures from prompts in the Looker IDE. It works with no memory across prompts, and the user must preview and insert, run the LookML Validator, and test in an Explore. — [Looker: Write LookML with Gemini](https://docs.cloud.google.com/looker/docs/write-lookml-gemini)
- Conversational Analytics inputs are Explore schema (fields, labels, descriptions, synonyms), sampled and fuzzy-searched distinct values, and agent configuration. Best practices: human-readable labels, hiding technical fields, centralizing calculations, and `suggestions`/`suggest_dimension`. — [Looker: Conversational Analytics best practices](https://docs.cloud.google.com/looker/docs/conversational-analytics-looker-best-practices)
- **Vendor claim:** Looker's semantic layer "reduces data errors in gen AI natural language queries by as much as two thirds" in internal tests. — [Google Cloud blog: Gemini in Looker deep dive](https://cloud.google.com/blog/products/data-analytics/gemini-in-looker-deep-dive)
- **Independent (third-party site):** on 44 questions over 3 runs (Apr 30, 2026), NL→LookML averaged 97% answer correctness versus 80% for NL→SQL on BigQuery, even after the SQL side was optimized with structured context. Failures were non-deterministic, with no question failing in all 3 runs. — [lkr.dev benchmark](https://www.lkr.dev/articles/benchmarking-semantic-layer-conversational-analytics/)

**Tableau (Tableau Next / Tableau Semantics)**
- Tableau Semantics is GA for Tableau Next (Tableau+ SKU) and Data 360 customers. It offers NL-generated semantic models, auto-calculated fields that check existing fields first to avoid duplicates, and relationship suggestions. — [Salesforce: Tableau Semantics](https://www.salesforce.com/analytics/tableau-semantics/)
- Agentforce for Analytics subagents include "Data Pro – Semantic Model Creation" (Create Calculated Field and Create Semantic Data Model actions). Semantics AI settings: Semantic Built-In AI, plus three Betas: Semantic Model AI Optimization, Semantic Description Generator ("review and edit suggestions before saving"), and Q&A Calibration (test and calibrate Concierge answers). — [Tableau Next setup: Enable AI features](https://help.tableau.com/current/tableau-next/en-us/tableau_next_setup_guide_enable_tua_ai.htm)
- Three build paths: NL with Tableau Agent, "Generate from existing data" (CRM Analytics or Tableau Cloud datasets), and extending a verified model. The model is exposed to "any third-party agent via MCP." — [Salesforce blog: Tableau Semantics best practices](https://www.salesforce.com/blog/tableau-semantics-best-practices-performant-semantic-model/)
- "Draft with Einstein" produces a calculated field with formula and properties, and "Always review the drafted content carefully." — [Trailhead: Tableau Semantics calculated fields](https://trailhead.salesforce.com/content/learn/modules/tableau-semantics/create-calculated-fields-and-metrics)

**ThoughtSpot**
- SpotterModel autonomous model generation is in Beta. It produces a "Model Requirement Document" for approval, then picks tables (with a confidence percentage and rationale), joins, columns, and formulas. It auto-generates AI Context on save. Limit: it doesn't support sweeping changes such as improving column names or generating descriptions in bulk. — [ThoughtSpot docs 26.11: SpotterModel](https://docs.thoughtspot.com/cloud/26.11.0.cl/spotter-model-create)
- Spotter Semantics "compile[s] agent intent into deterministic SQL." It is exposed through the ThoughtSpot MCP Server, works with "tools compatible with Apache Ossie," and supports importing semantic models from Snowflake and dbt MetricFlow. — [ThoughtSpot: Spotter Semantics](https://www.thoughtspot.com/product/spotter-semantics); [ThoughtSpot docs: Semantic layer](https://docs.thoughtspot.com/cloud/26.10.0.cl/semantic-layer)
- A Sep 2026 customer deck lists "PowerBI to ThoughtSpot Migration" under analytics modernization, with no mechanics given. — [ThoughtSpot Insights Hour Sep 2026 PDF](https://media.thoughtspot.com/35707/1790299789-thoughtspot-customer-insights-hour-september-2026.pdf)

### Inferences
- Across vendors, the shared review pattern has three parts. The agent proposes a plan or requirements document, a deterministic validator or test query checks the output, and a human accepts a diff. ALOFT should copy this rather than auto-publishing translated measures.
- Apache Ossie is emerging as a cross-vendor interchange. dbt reads it, ThoughtSpot speaks it, and `dax-sql` reads Ossie models with DAX or SQL metrics. An Ossie intermediate representation is a plausible neutral target for "Power BI knowledge" before emitting UC metric-view YAML.

### Gaps
- I found nothing on Tableau Pulse's specific LLM mechanics for metric definitions, or on Tableau calculation-to-SQL translation for non-Snowflake targets.
- AtScale's Power BI→SML converter: I could not confirm whether it is LLM-based or deterministic, or how much DAX it handles.
- Published accuracy numbers for ThoughtSpot, Cube, Tableau, dbt, and AtScale NLQ over semantic layers: none found from primary sources.

## Third-party tools that translate DAX or Power BI models to SQL or other semantic layers

### Takeaway
Several open-source converters exist, and most are deterministic rather than LLM-based. `dax-sql` compiles DAX queries to SQL and is tested against Power BI's own answers. `pbi-metrics-migration-tool` and `databrickslabs/kasal` translate DAX measures to UC metric-view YAML through multi-pass rule pipelines with confidence scores, overrides, and audit reports. Tabular Editor 3's AI Assistant is the leading LLM tool inside the Power BI modeling workflow.

### Cited Findings
- `djouallah/dax-sql` is a DAX-to-SQL compiler with no dependencies, installed via `npm install dax-sql`.
  - Input: a TMSL `model.bim` or Apache Ossie model plus a DAX query. Output: one SQL `SELECT` plus its columns, as DuckDB SQL by default or T-SQL for Fabric.
  - Errors are reported as `SYNTAX`, `SEMANTIC`, or `UNSUPPORTED`, and it is "Tested on DuckDB against Power BI's own answers."
  - It documents departures from DAX, for example case-sensitive grouping and `IFERROR` returning its first argument. — [GitHub: djouallah/dax-sql](https://github.com/djouallah/dax-sql)
- `suryasai87/pbi-metrics-migration-tool` extracts semantic models via the Scanner API or DAX INFO queries over MSAL, or from TMDL/BIM ZIP upload.
  - Translation: a 14-pass pipeline covering 30+ DAX functions (CALCULATE, FILTER/ALL, VAR/RETURN, time intelligence, iterators).
  - Controls: an `overrides.yaml` (table and column maps, extra joins, hand-written SQL), per-measure confidence scores, and residual-DAX detection.
  - Output and deploy: Metric View YAML v1.1, deployed via the Statement Execution API with rollback. It also extracts PBI report layout (pages, visuals, field bindings) to auto-generate AI/BI dashboards. — [GitHub: pbi-metrics-migration-tool](https://github.com/suryasai87/pbi-metrics-migration-tool)
- `databrickslabs/kasal` follows the same deterministic pattern: M-Query parsing to find fact tables and source SQL, a DAX translator, dependency topological sort, join detection from DAX references and relationships, and YAML and SQL emitters with a migration report. It claims 70–93% automation. — [kasal tool-86](https://github.com/databrickslabs/kasal/blob/main/src/docs/powerbi/tool-86-uc-metric-view-generator.md)
- Tabular Editor 3 AI Assistant (Mar 2026 release):
  - Capabilities: model-metadata exploration, writing and running DAX, generating C# scripts for model changes (snapshot plus side-by-side diff, undo, reusable as macros), BPA, VertiPaq stats, and an error-aware view of open documents.
  - Model access: bring-your-own API key, so any provider including local or organizational LLMs. Permission settings control what is sent to the provider.
  - Limits: it can't call external MCP servers, search the web, or connect to a different model. Tabular Editor 3 separately offers an MCP server for external agents.
  - A CLI for agents was announced for April 2026. — [Tabular Editor docs: AI Assistant](https://docs.tabulareditor.com/en/features/ai-assistant.html); [Tabular Editor blog: agentic development](https://tabulareditor.com/blog/how-tabular-editor-supports-agentic-development-for-semantic-models); [TE3 March 2026 release](https://tabulareditor.com/blog/tabular-editor-3-march-2026-release)

### Inferences
- A hybrid design is a good fit for ALOFT. First, a deterministic translator handles the easy majority of DAX (plain aggregates, simple CALCULATE filters, DIVIDE, measure references), with explicit `UNSUPPORTED` flags. Second, an LLM handles the residue with a plan and a diff. Third, a validator checks the output: run the original DAX via XMLA, SemPy, or the Authoring MCP, run the translated `MEASURE()` SQL on the Databricks warehouse, and compare results. None of the tools above chains all three, but each piece exists.
- Report-layout extraction (visual to fields) in `pbi-metrics-migration-tool` matches ALOFT's planned PBIR harvest. Visual field bindings can become candidate example questions and SQL.

### Gaps
- None of the open-source tools publishes accuracy on a real enterprise corpus; the confidence scores are self-reported.
- I did not evaluate consultancy migration accelerators (for example from SIs or Databricks partners) beyond Antares' guide, so no sourced findings on them.

## Cross-cutting: what the LLM sees, what it outputs, human review, accuracy evidence, and limits

### Takeaway
All vendors converge on the same inputs: schema, descriptions, synonyms, joins, sample values, and gold question–SQL pairs. Outputs are always a reviewable semantic artifact (YAML, TMDL or C#, a diff) rather than a silent change. The independent accuracy evidence is thin. The lkr.dev Looker benchmark (97% vs 80%) is the only third-party number found. Snowflake's +21-point BIRD result and Google's "two-thirds fewer errors" are vendor claims.

### Cited Findings
| Product | LLM inputs | LLM output | Human review | Accuracy evidence | Status |
|---|---|---|---|---|---|
| Databricks `/importBI` | `.pbit`/`.tmdl`/PBIR, optional images, source/target catalog | UC metric views + AI/BI dashboard | Plan approval, then edit | None published | GA Aug 2026 ([release notes](https://docs.databricks.com/gcp/pt/ai-bi/release-notes/2026)) |
| Databricks AI comments | Schema, column names | UC comments | Accept or edit per object | None | GA ([docs](https://learn.microsoft.com/en-us/azure/databricks/comments/ai-comments)) |
| Genie knowledge store/benchmarks | Descriptions, synonyms, joins, SQL expressions, example SQL | SQL answers; benchmark scores | Author curation; LLM-graded agent benchmarks | None published | GA; benchmark APIs Beta ([docs](https://docs.databricks.com/aws/en/genie-agents/tune-quality)) |
| Power BI Copilot / Fabric data agent | Model metadata + Prep for AI | DAX | Verified answers, AI instructions | None published | Prep for AI Preview ([docs](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai)) |
| Snowflake Autopilot (PBI) | `.pbit`/`.pbix`, tables, gold SQL | Semantic view | Semantic Studio, evaluations | Vendor: 57%→78% on BIRD subsets ([blog](https://www.snowflake.com/en/blog/engineering/agentic-semantic-model-text-to-sql/)) | GA Aug 2026 ([note](https://docs.snowflake.com/en/release-notes/2026/other/2026-08-18-semantic-views-power-bi-ingestion-ga)) |
| Looker Gemini | Prompt + view file; Explore schema | LookML; semantic query JSON | LookML Validator, Explore | Independent: 97% vs 80% ([lkr.dev](https://www.lkr.dev/articles/benchmarking-semantic-layer-conversational-analytics/)) | GA |
| ThoughtSpot SpotterModel | Connection + purpose + questions | Model (tables, joins, columns, formulas) | Requirement doc approval; confidence % | None | Beta ([docs](https://docs.thoughtspot.com/cloud/26.11.0.cl/spotter-model-create)) |
| Tabular Editor AI Assistant | Model metadata, DAX results, BPA | DAX, C# scripts | Diff, undo | None | Released Mar 2026 ([docs](https://docs.tabulareditor.com/en/features/ai-assistant.html)) |

- Common limits across vendors:
  - Every vendor tells users to review AI-generated descriptions. Databricks says not to rely on them for PII classification ([Databricks](https://learn.microsoft.com/en-us/azure/databricks/comments/ai-comments)), and Tableau says "review and edit suggestions before saving" ([Tableau](https://help.tableau.com/current/tableau-next/en-us/tableau_next_setup_guide_enable_tua_ai.htm)).
  - Time intelligence and filter-context DAX don't migrate cleanly into Snowflake ([Snowflake](https://docs.snowflake.com/en/user-guide/views-semantic/power-bi-ingestion)) or Databricks ([Databricks Community](https://community.databricks.com/t5/genie-hub/how-good-is-the-new-importbi-genie-skill/td-p/162083); [Antares](https://getantares.io/power-bi-to-databricks-ai-bi-migration/)).

### Inferences
- The most reusable cross-vendor pattern for ALOFT has five steps:
  1. Harvest Power BI semantics: Scanner API for DAX, M, and descriptions; PBIR for visual field bindings; Prep for AI artifacts if reachable.
  2. Resolve each model's physical tables through its M sources into UC tables.
  3. Translate deterministically to metric-view YAML 1.1, carrying `display_name`, `synonyms`, and `comment`, and send the residue to an LLM.
  4. Turn verified answers and visuals into Genie example SQL and benchmark questions.
  5. Run held-out evaluation in the Snowflake style before promotion.
- Because Snowflake and Databricks both reject time intelligence and calculation groups in automated migration, ALOFT should expect those DAX measures (often the most-used ones in finance and operations reports) to need human-authored SQL or Genie example queries.

### Gaps
- No independent, cross-vendor benchmark compares Power BI-semantic-model-grounded NL-to-SQL against raw-warehouse NL-to-SQL on the same data.
- No sourced information on how any vendor handles Excel- or SharePoint-sourced Power BI models during migration. All documented paths assume warehouse-backed tables.
