# Architecture, lineage, and governance for a Power BI → Unity Catalog semantic bridge with LLMs in the loop

Scope: concrete architectures, lineage standards, and governance / human-in-the-loop (HITL) practices for harvesting ~500 Power BI semantic models (sources: Databricks SQL, Snowflake, Excel/SharePoint), building a Power BI → Unity Catalog (UC) crosswalk, having an LLM propose mappings and metric SQL, steward approval, and publishing to a semantic layer that NL-to-SQL agents execute on Databricks. Research date: 2026-11-10. Preview/Beta status is marked where the source states it.

## 1. How lineage from Power BI to Databricks works today

### Takeaway
No product auto-stitches Power BI lineage into Unity Catalog. UC offers a write API ("external lineage") that you populate yourself (or via a third party such as Measure Killer). Purview scans both sides but does not join them for Databricks sources. Catalog vendors (DataHub, Alation) get table lineage by parsing Power Query M navigation chains and column lineage only when native SQL is embedded or by extracting DAX references. ALOFT will have to build its own M/DAX parser + UC external-lineage writer, or buy one.

### Cited Findings
**Unity Catalog external lineage**
- UC captures runtime lineage only for queries run on Databricks; "external lineage" lets you add metadata for systems outside Databricks (e.g. last-mile BI such as Power BI/Tableau) manually via Catalog Explorer, the External Metadata and External Lineage APIs, or the Python SDK. Lakeflow Connect managed ingestion records source lineage automatically. Page last updated Oct 7, 2026. — [Databricks: External lineage](https://docs.databricks.com/aws/en/data-governance/unity-catalog/external-lineage)
- Workflow: (1) create an *external metadata* securable object (name, system type, entity type such as "dashboard"); (2) create a lineage relationship between it and a UC table, model, path, or another external metadata object; it then shows in the lineage graph. — [Databricks: External lineage](https://docs.databricks.com/aws/en/data-governance/unity-catalog/external-lineage)
- Privileges: `CREATE EXTERNAL METADATA` on the metastore; `MODIFY` on the external metadata object; read privileges (e.g. `SELECT`) on a UC object to declare it *upstream of* (i.e. a downstream relationship to) the external object; write privileges (`MODIFY`) on a UC object to declare an external object *upstream of* it. — [Databricks: External lineage](https://docs.databricks.com/aws/en/data-governance/unity-catalog/external-lineage)
- Limitations: external lineage is **not** recorded in `system.access.table_lineage` / `system.access.column_lineage`; max 10,000 external metadata objects and 100,000 external lineage relationships per metastore. — [Databricks: External lineage](https://docs.databricks.com/aws/en/data-governance/unity-catalog/external-lineage)
- API: `POST /api/2.0/lineage-tracking/external-metadata` with required `name`, `system_type` (enum includes `POWER_BI`, `MICROSOFT_FABRIC`, `SNOWFLAKE`, `OTHER`, …), `entity_type`; optional `url`, `description`, `columns` (array), `properties` (map), `owner`. Creation **grants BROWSE to all account users by default**. — [Databricks API: Create external metadata](https://docs.databricks.com/api/uc-external-metadata/v1/create-external-metadata-v2.md); also exposed as `databricks external-metadata create-external-metadata NAME SYSTEM_TYPE ENTITY_TYPE` — [Databricks CLI reference](https://docs.databricks.com/aws/en/dev-tools/cli/reference/external-metadata-commands)
- External lineage relationships can carry column mappings. — [Databricks API: UC External Lineage](https://docs.databricks.com/api/uc-external-lineage/v1/uc-external-lineage)
- Third-party reference implementation (Measure Killer, doc updated Nov 6, 2026): after a tenant scan it writes each Power BI/Fabric item as a UC external metadata object — semantic model (`POWER_BI`/`semantic_model`), report, report page, visual, paginated report, Gen1/Gen2 dataflow (`MICROSOFT_FABRIC`/`dataflow`), and Excel files connected to a model (`OTHER`/`excel_file`) — plus lineage relationships with column-level mappings. Every object carries `"generated_by": "Measure Killer"` and `mk_workspace_id`, and each scheduled run "reconciles against what it wrote previously, so renamed and deleted items don't leave orphans behind." It notes UC "does not capture Power BI lineage on its own." — [Measure Killer: Power BI lineage in Databricks UC](https://measurekiller.com/docs/how-tos/databricks-unity-catalog-lineage)

**Microsoft Purview**
- Purview captures lineage among Power BI artifacts (Dataflow → Dataset → Report → Dashboard) and to external assets, but external-source lineage is supported only for Azure SQL Database, Azure Blob, ADLS Gen1/Gen2; column-level (sub-artifact) lineage and in-dataset transformations only when the source is Azure SQL Database. Lineage is not captured with dynamic M query parameters (e.g. server/database passed as parameters). Some measures (e.g. `COUNTROWS`) are not shown in sub-artifact lineage. Purview uses the Scanner API under the hood. — [Microsoft Learn: Power BI lineage in Purview](https://learn.microsoft.com/en-us/purview/data-map-lineage-power-bi)
- Purview's Azure Databricks UC scan extracts metastore/catalog/schema/table/view/column metadata and UC tags (as properties), and lineage from notebook runs; it connects through a running SQL warehouse with a **Personal Access Token** and reads `system.access.table_lineage` / `column_lineage` (needs `USE CATALOG system`, `USE SCHEMA system.access`, `SELECT`). External tables: metadata yes, lineage no. — [Microsoft Learn: Purview + Azure Databricks UC](https://learn.microsoft.com/en-us/purview/register-scan-azure-databricks-unity-catalog)
- Microsoft Q&A answers (2026) state Purview "doesn't automatically join the two into one end-to-end chain" for Databricks → Power BI; manual asset-level lineage is the workaround. — [Microsoft Q&A 5770323](https://learn.microsoft.com/en-us/answers/questions/5770323/end-to-end-lineage-between-azure-databricks-and-po); [Microsoft Q&A 5773525](https://learn.microsoft.com/en-us/answers/questions/5773525/end-to-end-lineage-not-visible-between-azure-datab)
- Purview Power BI "scope your scan" (select workspaces) is **Preview**; UI selection limited to <5,000 workspaces. The tenant setting "Allow service principals to use read-only Power BI admin APIs" is labelled **(Preview)** in the setup steps. — [Microsoft Learn: Purview Power BI tenant (same tenant)](https://learn.microsoft.com/en-us/purview/register-scan-power-bi-tenant)

**Power BI Scanner API (the harvest primitive)**
- `POST /v1.0/myorg/admin/workspaces/getInfo?lineage=true&datasourceDetails=true&datasetSchema=true&datasetExpressions=true&getArtifactUsers=true`; `datasetSchema` returns tables/columns/measures and `datasetExpressions` returns DAX and Mashup (M) queries, both only if metadata-scanning tenant settings are fully enabled. 1–100 workspace IDs per call. — [Microsoft Learn: PostWorkspaceInfo](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-post-workspace-info)
- Scan results include `endorsementDetails` (e.g. "Certified") and `sensitivityLabel` per artifact. — [Microsoft Learn: GetScanResult](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-get-scan-result)
- Coverage caveats: models never refreshed/republished return no sub-artifacts or expressions; DirectQuery-only models return sub-artifacts only after some activity (report built/viewed); real-time datasets, models with object-level security, live connections to AAS/SSAS, and Excel full-fidelity datasets return `schemaRetrievalError`; no sub-artifacts for >1 GB models in shared (non-Premium) workspaces. No special license needed. — [Microsoft Learn: Run metadata scanning](https://learn.microsoft.com/en-us/fabric/governance/metadata-scanning-run)

**Catalog vendor parsing of M and DAX**
- DataHub: table lineage by parsing M expressions plus API data source info; supported platforms MySQL, Databricks, BigQuery, SQL Server, PostgreSQL, Oracle, Snowflake. Native SQL (`Value.NativeQuery`) parsing documented for Snowflake and Redshift. Column-level lineage is **off by default** (`extract_column_level_lineage`) and "works only for M-Query where native SQL is used" (requires `native_query_parsing`, `enable_advance_lineage_sql_construct`, `extract_lineage`). Nested item-selector patterns inside `Table.Combine` are not supported. There is an `m_query_parse_timeout`. — [DataHub: PowerBI source](https://docs.datahub.com/docs/generated/ingestion/sources/powerbi/)
- DataHub Databricks fixes show how brittle M parsing is: three valid M shapes "silently produced no lineage" (redundant parentheses around a navigation step; navigation step without `Kind=`; `Value.NativeQuery` on plain `Databricks.Catalogs`). Databricks navigation chains are catalog → schema → table by position. — [DataHub PR #19364](https://github.com/datahub-project/datahub/pull/19364); native-query multi-hop source argument also lost lineage on Snowflake/Redshift/MSSQL/Postgres/BigQuery — [DataHub PR #19368](https://github.com/datahub-project/datahub/pull/19368); `DatabricksMultiCloud.Catalogs` native query support — [DataHub PR #11756](https://github.com/datahub-project/datahub/pull/11756)
- Two distinct M patterns need different handling: (A) navigation `{[Name=…,Kind=…]}` chains (table-level only, needs an M parser); (B) `Value.NativeQuery` with embedded SQL that needs `#(lf)` and `""` unescaping before a dialect SQL parser can yield column lineage. (Source is a vendor maintainer of General SQL Parser promoting an Apache-2.0 sidecar; treat as vendor commentary.) — [DataHub issue #15327](https://github.com/datahub-project/datahub/issues/15327)
- Alation Power BI Scanner OCF connector ≥2.14.0 parses DAX measures and emits column-level edges from each measure to referenced columns/measures (qualified `Sales[Amount]`, quoted-table, unqualified `[X]` resolved home-table first), inside any function incl. `CALCULATE`, `FILTER`, `TOTALYTD`, `RELATED`, `VAR…RETURN`; ignores comments/strings. It "does not interpret DAX function semantics" (only extracts references), and cross-dataset references (e.g. `TREATAS`) are not resolved. Cross-system lineage supports Azure Databricks, Databricks on AWS, Databricks UC, Snowflake, etc., configured via `host:port` matching. — [Alation: Configure Lineage](https://docs.alation.com/en/latest/OpenConnectorFramework/BIConnectors/PowerBIScannerOCFConnector/PowerBIScannerConnectorConfigLineage.html)
- Alation extracts report fields/pages/visuals from exported PBIX or PBIR (PBIR from connector 2.16.0); Microsoft disabled report export for XMLA-modified datasets, so report-field lineage is unavailable for them. — [Alation: Power BI Scanner overview](https://docs.alation.com/en/latest/OpenConnectorFramework/BIConnectors/PowerBIScannerOCFConnector/PowerBIScannerConnectorOverview.html)

**OpenLineage**
- `ColumnLineageDatasetFacet` maps output fields to `inputFields` with `transformations` {`type`: DIRECT|INDIRECT, `subtype`: IDENTITY/TRANSFORMATION/AGGREGATION or JOIN/GROUP_BY/FILTER/SORT/WINDOW/CONDITIONAL, `description`, `masking`}. — [OpenLineage spec: column lineage facet](https://github.com/OpenLineage/OpenLineage/blob/main/website/docs/spec/facets/dataset-facets/column_lineage_facet.md)
- OpenLineage's Spark integration needed specific fixes for Databricks UC (catalog/storage/symlink facets missing because UC uses LogicalRelations, `UnityCatalogV2Proxy`). — [OpenLineage PR #4057](https://github.com/OpenLineage/OpenLineage/pull/4057); maintainers earlier said nothing UC-specific was done — [OpenLineage issue #2121](https://github.com/OpenLineage/OpenLineage/issues/2121)

### Inferences
- The OpenLineage column facet is a good *internal* edge schema for the ALOFT crosswalk (DAX `SUM` → AGGREGATION, `FILTER`/`CALCULATE` filter args → INDIRECT/FILTER, relationships → INDIRECT/JOIN), then project to UC external lineage for display. Nothing found shows Power BI or UC natively emitting/consuming OpenLineage events.
- 500 models × (model + tables + reports + pages) could approach the 10k external-metadata-object cap; registering at semantic-model + table granularity (with columns in the `columns` array) rather than visual-level is safer.
- Because external lineage is absent from lineage system tables, ALOFT must keep its own edge table (Delta) as source of truth for agents and drift checks; UC external lineage is a projection for humans.
- Default BROWSE-to-all-account-users means Power BI model names/columns become discoverable estate-wide; check whether that leaks sensitive model names.
- Parser coverage must be measured (DataHub's silent failures): emit a "parse status" per M expression and route unparsed ones to an LLM-assisted or steward queue.

### Gaps
- Could not confirm whether UC external lineage is GA or Preview (the fetched snippet did not show a label).
- Did not retrieve Atlan's or Collibra's Power BI connector docs on M/DAX parsing depth; only DataHub and Alation are sourced.
- Did not verify Fabric item-definition APIs (`getDefinition` for TMDL/PBIR) details or limits in this pass.

## 2. Knowledge-graph approaches for semantic layers and LLM use over them

### Takeaway
The converging pattern is a graph that links physical schema ↔ business glossary/ontology ↔ governed metrics ↔ query-history joins, retrieved by hybrid search + graph traversal, with human-asserted definitions ranked above inferred ones. Databricks now ships this natively (UC Metric Views + Pages + Domains + Genie Ontology), so ALOFT's crosswalk can target those objects rather than a separate graph store.

### Cited Findings
- Databricks "Unity Catalog Semantics combine Metric Views, Pages, and Domains"; Genie Ontology adds inferred context from tables, queries, dashboards, notebooks, ranks by authority and relevance, applies permissions, and is reachable by external agents via MCP. Advice: "model the head and let Genie Ontology infer the tail." — [Databricks blog: Operationalizing Genie Ontology](https://www.databricks.com/blog/operationalizing-genie-ontology-your-data-stack)
- Metric Views carry display names, synonyms, format patterns, and example queries that flow into the ontology; Pages capture business terms and list authoritative assets; "because they are human-asserted and reviewed, they carry more authority than inferred context"; certification raises authority and deprecation steers agents away. — [Databricks blog: Operationalizing Genie Ontology](https://www.databricks.com/blog/operationalizing-genie-ontology-your-data-stack)
- Neo4j semantic layer stores schema, FKs/indexes, sample values, business glossary/taxonomy, and joins mined from transaction logs; agents fetch only the relevant subgraph via semantic search + shortest-path traversal; vendor demo claims ~+10 points accuracy on complex multi-table queries. — [Neo4j blog](https://neo4j.com/blog/agentic-ai/how-a-neo4j-semantic-layer-makes-your-text-to-sql-agent-smarter-and-cheaper/)
- neo4j-labs `neocarta` builds that graph (schema, glossary, governed metrics, query history) and serves it to agents via an MCP server with full-text/vector/hybrid search tools; only metadata leaves the source. — [GitHub: neo4j-labs/neocarta](https://github.com/neo4j-labs/neocarta)
- Google Cloud pattern: business glossary with synonyms plus custom catalog "Aspects" holding a `SQL_Mapping_Ruleset` string contract that the agent injects verbatim; if missing, the agent asks for clarification. The page claims "100% precision" — a vendor marketing claim, not a measured result. — [Google Cloud: Anchoring agents in structured business reality](https://googlecloudplatform.github.io/cloud-solutions/beyond-the-chatbot/phase2_anchoring_agents_in_structured_business_reality/)
- Practitioner builds: OWL ontology → Neo4j graph mapping concepts to physical tables, then retrieve tables before SQL generation — [IWConnect](https://iwconnect.com/how-we-built-a-knowledge-graph-powered-nl2sql-agent/); five layers (schema, concepts, rules, aliases, blessed join patterns) with confidence and reasoning trace recorded — [Jai Ganesh](https://jaig.bio/architecture/text-to-sql-knowledge-graph)

### Inferences
- Power BI already *is* a curated ontology fragment: measures (governed metrics), relationships (blessed joins), display folders/descriptions (glossary), synonyms (Q&A linguistic schema, if present). The crosswalk should convert these into Metric View measures/joins/synonyms and Pages, keeping the Power BI object ID as provenance.
- Certified/Promoted endorsement from the Scanner (`endorsementDetails`) is a natural prior for authority ranking when 500 models define conflicting versions of the same KPI.

### Gaps
- No independent benchmark found comparing GraphRAG-over-metadata vs. flat retrieval for text-to-SQL; cited accuracy numbers are vendor demos.
- Did not find Power BI linguistic schema (Q&A synonyms) exposure via Scanner API.

## 3. HITL stewardship for LLM-generated metadata

### Takeaway
Industry practice is "AI proposes, a named person accepts, the system records who/when," with unreviewed AI output visibly marked. Mature designs add triage (full review only for uncertain proposals), evidence/citations per proposal, a persisted governance record, and drift detection tied to incremental scans.

### Cited Findings
- UC AI-generated comments: generated per object on request; must be reviewed and accepted or edited before saving; "should not be relied on for data classification tasks such as detecting columns with PII." — [Databricks: AI-generated comments](https://docs.databricks.com/aws/en/comments/ai-comments)
- Atlan AI: accept, reject, edit, or regenerate-and-compare suggestions; admins can add org context used for all enrichment. — [Atlan docs](https://docs.atlan.com/product/capabilities/atlan-ai/how-tos/use-atlan-ai-for-documentation)
- Collibra AI: descriptions are "always considered suggestions," accepted only by saving; enabling it does not overwrite existing descriptions; consumes Collibra Units (metered). — [Collibra docs](https://productresources.collibra.com/docs/collibra/latest/Content/CollibraAI/co_auto-descr.htm)
- Rules of thumb: separate *parsed* outputs (lineage from logs — near-deterministic) from *generated* outputs (descriptions/meaning — "guesses that read like facts"); keep an accept/reject trail; mark unreviewed machine text visibly; define what happens to unreviewed suggestions (auto-publish, expire, or queue). — [Decube: What is an AI data catalog](https://www.decube.io/post/what-is-ai-data-catalog) (vendor blog)
- "Contestable governance" (arXiv, Oct 2026): specialist agents produce scored, cited arguments; steward can accept/reject/modify/add before commit; a triage path reserves full argumentation for uncertain proposals; the governance record stores evidence, interventions, outcome so an auditor can recompute without rerunning a model; a gate controls which verified decisions become precedent; a versioned glossary feeds agents. — [arXiv 2610.31553](https://arxiv.org/html/2610.31553)
- Databricks `/importBI` (Genie Code) uses a plan-then-approve flow: it analyzes a `.pbit`/`.tmdl`, proposes a plan (fact vs. dimension tables, metrics, formulas without direct match), the user approves, then it builds UC metric views; it reuses existing UC metric views that match. — [Databricks: Import BI files using Genie Code](https://docs.databricks.com/aws/en/dashboards/manage/import-bi); [Databricks community blog](https://community.databricks.com/t5/technical-blog/migrate-your-dashboards-to-ai-bi-with-genie-code/ba-p/164326)
- Practitioner review of `/importBI`: parses M into catalog.schema.table, one metric view per fact, simple and measure-on-measure measures correct, "includes the original DAX expression as a comment … ensuring traceability"; fails on calculation groups, field parameters, cross-fact measures, `USERPRINCIPALNAME()`; placed some measures on wrong facts. — [Databricks Community: How good is /importBI](https://community.databricks.com/t5/genie-hub/how-good-is-the-new-importbi-genie-skill/td-p/162083)
- Drift: Databricks recommends owners and review cadence per domain; drift occurs in definitions, KPI logic, joins, dashboards, agent instructions; rerun Genie Agent benchmark suites after substantive changes. — [Databricks blog: Operationalizing Genie Ontology](https://www.databricks.com/blog/operationalizing-genie-ontology-your-data-stack)
- Change detection input: `GET /admin/workspaces/modified?modifiedSince=` returns changed workspace IDs; `modifiedSince` must be 30 min–30 days ago; max 30 requests/hour; Microsoft recommends a full scan then incremental scans keyed on last scan start time. — [Microsoft Learn: GetModifiedWorkspaces](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-get-modified-workspaces); [Microsoft Learn: Run metadata scanning](https://learn.microsoft.com/en-us/fabric/governance/metadata-scanning-run)

### Inferences
- Concrete queue design for ALOFT: per proposal store {source PBI object ID + expression hash, proposed UC target, proposed SQL, model/prompt version, evidence (M parse result, column name/type match, sample-value overlap, reconciliation result), confidence}; auto-accept only deterministic parsed edges; route generated mappings/metric SQL to stewards; re-open approved items when the source expression hash changes on an incremental scan.
- Confidence should come from verifiable signals (parse success, exact name match, reconciliation pass) rather than LLM self-reported probability; the arXiv triage pattern supports this.
- Keep the original DAX alongside generated SQL (as `/importBI` does) for steward diffing.

### Gaps
- No source gave numeric confidence thresholds used in production for auto-accepting LLM metadata.
- Could not confirm `/importBI` preview/GA status or bulk API access (it is a chat skill; unclear if callable from a batch pipeline).

## 4. Excel/SharePoint-sourced Power BI tables

### Takeaway
Databricks can ingest SharePoint Excel files via the managed Lakeflow Connect SharePoint connector or via `read_files`/Auto Loader/`spark.read.format("excel")`, but structured ingestion is append-only and does not pick up edits to already-ingested files. For mutable spreadsheets, either use full refreshes/custom pipelines or mark the Power BI table "non-SQL-answerable" until a governed copy exists.

### Cited Findings
- Two options: managed SharePoint connector (recommended for most cases) or SQL/Spark APIs (`read_files`, `spark.read`, `COPY INTO`, Auto Loader) with UC governance. Requirements: UC workspace, `CREATE CONNECTION` (or `USE CONNECTION`/`MANAGE CONNECTION` by access mode), DBR 17.3 LTS+, OAuth with `Sites.Read.All` or `Sites.Selected`. Excel read supports `headerRows` and `dataAddress` (e.g. `"Sheet1!A1:M20"`). — [Microsoft Learn: Ingest files from SharePoint](https://learn.microsoft.com/en-us/azure/databricks/ingestion/sharepoint)
- Managed connector: `entity_type: FILE` with `file_ingestion_options.format: EXCEL` (also CSV/JSON/XML/PARQUET/AVRO/ORC/BINARYFILE), `file_filters` (glob, `modified_before/after`), `schema_evolution_mode` (default `ADD_NEW_COLUMNS_WITH_TYPE_WIDENING`), `schema_hints`. `FILE_METADATA` entity captures metadata only. SharePoint **LIST** ingestion is **Beta**. — [Databricks: SharePoint connector reference](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/sharepoint-reference)
- Structured files are ingested once; "It doesn't pick up edits to a file it already ingested. To ingest changed data, add it as a new file or run a full refresh." Structured mode is `APPEND_ONLY`; SCD2 not supported. — [Databricks: SharePoint connector FAQ](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/sharepoint-faq)
- Lakeflow Connect managed pipelines record source lineage into UC automatically. — [Databricks: External lineage](https://docs.databricks.com/aws/en/data-governance/unity-catalog/external-lineage)
- Power BI inherits Purview sensitivity labels from Excel files on OneDrive/SharePoint (one of only three supported source types). — [Microsoft Learn: label inheritance from data sources](https://learn.microsoft.com/en-us/fabric/governance/service-security-sensitivity-label-inheritance-from-data-sources)
- Scanner API does not return sub-artifact metadata for "Excel full fidelity datasets." — [Microsoft Learn: Run metadata scanning](https://learn.microsoft.com/en-us/fabric/governance/metadata-scanning-run)

### Inferences
- Governance risks: (a) silent staleness when an analyst edits a workbook in place (append-only connector); (b) label loss — Excel's Purview label propagates into Power BI but there is no sourced path into UC tags, so the Delta copy may be less protected than the Power BI model; (c) no row-level security in the file; (d) ownership is personal, not a data team.
- Practical policy: classify each Power BI table by source type from M (`Excel.Workbook(Web.Contents(...sharepoint...))`, `SharePoint.Files`) → tier "ingestible + owner identified" vs. "answer-in-Power-BI-only"; agents should refuse or caveat metrics depending on non-ingested tables.

### Gaps
- Did not confirm GA status of the managed SharePoint connector for files (only LIST was explicitly Beta in the fetched reference).
- No source on mapping Purview labels on SharePoint files to UC governed tags automatically.

## 5. Security: Power BI RLS vs UC row filters/column masks; agent identity; sensitivity labels

### Takeaway
Single enforcement in UC only works when Power BI uses DirectQuery with Entra ID SSO; Import-mode models carry their own DAX RLS that does not exist in Databricks, so an agent answering via Databricks will **not** inherit it unless the rules are re-implemented as UC row filters/ABAC. Agents must run queries as the end user (or a role mapped to them), not a broad service principal, and labels do not flow between Power BI and UC.

### Cited Findings
- Entra ID SSO from Power BI to Databricks via an account-level federation policy (issuer `https://sts.windows.net/<tenant>/`, audience `2ff814a6-3304-4ab8-85cb-cd0e6f879c1d`, subject claim `email` or `upn`); requires Power BI Desktop May 2026+ and the ADBC driver; enable "Report viewers can only access this data source with their own Power BI identities using DirectQuery"; otherwise only the publisher's identity reaches Databricks. — [Databricks: Entra ID SSO for Power BI](https://docs.databricks.com/aws/en/partners/bi/power-bi/fed-sso)
- Microsoft Entra SSO is DirectQuery-only (not refresh) for gateway sources incl. Azure Databricks and Snowflake. — [Microsoft Learn: gateway SSO overview](https://learn.microsoft.com/en-us/power-bi/connect-data/service-gateway-sso-overview)
- Import mode requires RLS in Power BI, creating dual access control; DirectQuery + SSO can rely on UC ACLs. — [Databricks Community technical blog](https://community.databricks.com/t5/technical-blog/seamlessly-integrate-databricks-on-aws-with-power-bi-sso-using/ba-p/78196)
- UC row-filter pattern: function joins a provisioning table on `session_user()`; ABAC policies use governed tags to target tables/columns. If a user assumes a role, `session_user()` returns the role name and `is_member()` evaluates the role's groups, so a username-keyed provisioning table returns no rows. — [Databricks: RBAC with ABAC](https://docs.databricks.com/gcp/en/security/auth/rbac/abac-interaction)
- Practitioner: platform-enforced RLS via UC row filters + DirectQuery SSO gives one enforcement point for Power BI, notebooks and pipelines; the access mapping table still needs ownership, validation and change history. — [Nextlytics blog](https://www.nextlytics.com/blog/row-level-security-for-power-bi-on-databricks-enforce-and-keep-current)
- Genie Ontology respects UC permissions; "unauthorized content does not participate in retrieval, so it cannot influence an answer indirectly." — [Databricks blog: Operationalizing Genie Ontology](https://www.databricks.com/blog/operationalizing-genie-ontology-your-data-stack)
- `/importBI` does not translate `USERPRINCIPALNAME()`-based logic. — [Databricks Community](https://community.databricks.com/t5/genie-hub/how-good-is-the-new-importbi-genie-skill/td-p/162083)
- Labels: Power BI inherits labels only from Excel on OneDrive/SharePoint, Azure Synapse, Azure SQL DB; most-restrictive wins; never overwrites manual labels. — [Microsoft Learn: label inheritance from sources](https://learn.microsoft.com/en-us/fabric/governance/service-security-sensitivity-label-inheritance-from-data-sources). Downstream inheritance is capped at 80 items. — [Microsoft Learn: downstream inheritance](https://learn.microsoft.com/en-us/fabric/governance/service-security-sensitivity-label-downstream-inheritance)
- Purview cannot write its sensitivity labels back as UC tags; the two systems keep separate classification constructs (Microsoft Q&A answer). — [Microsoft Q&A 5828903](https://learn.microsoft.com/en-ca/answers/questions/5828903/is-auto-labeling-of-unity-catalog-data-available-i)
- UC governed tags: account-level with tag policies (allowed values, who can assign); inherit from catalog/schema to children but **not to columns**; assignment needs `APPLY TAG` + `ASSIGN` on the governed tag. — [Microsoft Learn: Governed tags](https://learn.microsoft.com/en-us/azure/databricks/admin/governed-tags/); [Microsoft Learn: UC tags](https://learn.microsoft.com/en-us/azure/databricks/database-objects/tags)
- Scanner returns `sensitivityLabel` per artifact. — [Microsoft Learn: GetScanResult](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-get-scan-result)

### Inferences
- Harvest each model's RLS roles/filters (DAX) and treat any model with RLS + Import mode as "security-divergent": block publishing its metrics to agents until an equivalent UC row filter/ABAC policy exists and a test proves parity.
- Map Power BI `sensitivityLabel` from the Scanner to a UC governed tag on the corresponding metric view/table (custom sync; no native path found).
- Using the app service principal for agent SQL would bypass per-user row filters; use on-behalf-of user tokens, or the SP must be constrained by row filters keyed on a passed identity (riskier).

### Gaps
- Scanner API documentation fetched did not confirm whether RLS role definitions/DAX filter expressions are returned in `datasetSchema`; verify (TMDL via Fabric definitions would include them).
- No source on automated translation of DAX RLS (`USERPRINCIPALNAME()`, `LOOKUPVALUE`) into UC row-filter SQL.

## 6. Reconciliation: Databricks metric vs. Power BI number as continuous testing

### Takeaway
Run the same metric at the same grain on both sides: DAX via `executeDaxQueries` (capacity-only, Arrow) or `executeQueries` (JSON), and SQL via the UC metric view's `MEASURE()`; compare per slice with tolerance. Identity is the main friction: service principals cannot query RLS/SSO models via `executeQueries`, and impersonation needs workspace admin.

### Cited Findings
- `executeQueries`: requires tenant setting "Dataset Execute Queries REST API" and Read+Build; one query/one table per call; max 100k rows or 1M values, 15 MB; 120 requests/min/user; service principals "aren't supported for datasets with RLS … or datasets with SSO enabled"; DAX only. — [Microsoft Learn: Execute Queries](https://learn.microsoft.com/en-us/rest/api/power-bi/datasets/execute-queries)
- `executeDaxQueries`: one query per call but multiple `EVALUATE`s; 120/min/user globally, 40/min/user for Pro/PPU; DAX and INFO functions; params `effectiveUsername` (workspace admins only), `roles`, `customData` (for dynamic RLS), `queryTimeout`, `resultSetRowCountLimit` (default 1M); service principals cannot be role members and can use `roles` only as workspace admin. — [Microsoft Learn: Execute DAX Queries](https://learn.microsoft.com/en-us/rest/api/power-bi/datasets/execute-dax-queries)
- Execute DAX Queries works only on models on Premium/Fabric/Embedded capacity; returns Arrow for pandas/Polars/Spark; least-privilege guidance (Build+Read on specific models, avoid admin roles, careful use of `effectiveUsername`). — [Microsoft Learn: Execute DAX Queries best practices](https://learn.microsoft.com/en-us/power-bi/developer/execute-dax-queries-arrow/best-practices)
- Community: a model with an RLS role defined (even with no members) blocked SP `executeQueries`; workaround was a dedicated monitoring role with no filters containing only the SP. — [Fabric Community thread](https://community.fabric.microsoft.com/discussions/power-bi-designer/automated-data-quality-checks-on-power-bi-semantic-models-using-service-principa/5282027) (note: conflicts with docs stating SPs can't be role members for executeDaxQueries; treat as anecdotal)
- Databricks side: metric views queried as `SELECT dim, MEASURE(m) FROM mv GROUP BY ALL`; no `SELECT *`. — [Microsoft Learn: metric views with BI tools](https://learn.microsoft.com/en-us/azure/databricks/uc-semantics/metric-views/bi-tools)
- Non-additive measures (distinct counts, ratios, medians) must be computed at each grain, not summed — the root cause of wrong Power BI totals over metric views. — [Databricks Community article](https://community.databricks.com/t5/community-articles/power-bi-on-metric-views-why-the-totals-go-wrong-and-a-live/td-p/175719)
- Genie Agent Benchmarks can compare answers against validated SQL (Chat mode) or LLM-judge (Agent mode). — [Databricks blog: Operationalizing Genie Ontology](https://www.databricks.com/blog/operationalizing-genie-ontology-your-data-stack)

### Inferences
- Reconciliation harness: for each approved metric, generate paired queries (DAX `SUMMARIZECOLUMNS` by 1–2 dimensions + time filter; SQL `MEASURE()` at same grain), compare totals and per-slice values, store pass/fail + delta as an evidence field on the crosswalk item; fail → re-open for steward. Include grand-total checks for non-additive measures.
- Import-mode models lag on refresh; compare against the model's last refresh time window, not "now."
- Rate limits (120/min) are ample for nightly tests on a curated metric set but not for exhaustive slicing across 500 models.

### Gaps
- No published case study found of continuous Power BI ↔ Databricks metric reconciliation in production.

## 7. Cost/throughput for batch LLM enrichment over hundreds of models

### Takeaway
Harvest incrementally (modified workspaces only), hash expressions to skip unchanged objects, and run enrichment as a single `ai_query` batch over a Delta table of pending items using batch-optimized `system.ai` models; avoid provisioned throughput unless you need guarantees.

### Cited Findings
- Scanner limits: `getInfo` ≤100 workspaces/call, 500 req/hr, 16 simultaneous; `scanResult` 500 req/hr, results retained 24 h; `modified` 30 req/hr; poll status every 30–60 s. — [Microsoft Learn: PostWorkspaceInfo](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-post-workspace-info); [GetScanResult](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-get-scan-result); [GetModifiedWorkspaces](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-get-modified-workspaces); [Run metadata scanning](https://learn.microsoft.com/en-us/fabric/governance/metadata-scanning-run)
- `ai_query` best practices: use `system.ai` Databricks-hosted models, pick batch-optimized models, submit the full dataset in one query (manual micro-batching reduces throughput), set `failOnError => false`; DBR 15.4 LTS+ (moving to 17.3 LTS+). Batch-optimized list includes GPT-5.x, Gemini 3.x, Claude (Databricks-hosted) Opus/Sonnet/Haiku 5.x, Llama 4 Maverick, Qwen, gpt-oss. — [Databricks: Use ai_query](https://docs.databricks.com/aws/en/large-language-models/ai-query)
- AI Functions are serverless with no endpoint setup; Databricks claims >10x, up to 100x faster batch jobs. — [Databricks blog: Serverless Batch Inference](https://www.databricks.com/blog/introducing-serverless-batch-inference) (vendor claim)
- Pricing: batch inference billed in DBU/hour per model (e.g. GPT-OSS-120B 71.429 DBU/h, Llama 3.3 70B 85.714 DBU/h, Llama 3.1 8B 53.571 DBU/h); provisioned throughput sold in model units, throughput depends on input/output tokens and cache hit rate. — [Databricks pricing: Foundation Model Serving](https://www.databricks.com/product/pricing/foundation-model-serving)
- Provisioned throughput is for performance guarantees/fine-tuned models/compliance; on-demand or 1/3-month reserved; otherwise Databricks recommends priority pay-per-token. — [Databricks: Foundation Model APIs](https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/); [On-demand provisioned throughput](https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/deploy-prov-throughput-foundation-model-apis)
- Collibra AI suggestions consume metered Collibra Units (cost model of vendor alternatives). — [Collibra docs](https://productresources.collibra.com/docs/collibra/latest/Content/CollibraAI/co_auto-descr.htm)

### Inferences
- 500 models fit in ≤5 `getInfo` calls for a full scan; incremental runs will typically be far smaller. The bottleneck is LLM tokens per measure/column, not the Scanner.
- Cache by `(object_id, sha256(expression + candidate UC schema snapshot), model_version, prompt_version)`; re-enrich only on hash change. Deterministic steps (M parse, name/type matching, DAX reference extraction) should run before the LLM to shrink candidate sets and prompt size.
- Use a cheaper model for descriptions/classification and a stronger model only for DAX→SQL translation of non-trivial measures (time intelligence, `CALCULATE` filter context).

### Gaps
- No sourced per-token cost or tokens-per-measure figures for DAX→SQL translation workloads; estimate from a pilot.
- No source quantifying prompt-caching discounts for `ai_query` batch.

## Cross-cutting: Power BI consumption of UC metric views (affects "publish" target)

### Takeaway
If ALOFT publishes to UC metric views, Power BI can no longer consume them through BI compatibility mode (removed April 2026); only native-query `MEASURE()` in DirectQuery or wrapper views remain. This matters only if the semantic layer must also serve Power BI; agents on Databricks are unaffected.

### Cited Findings
- Microsoft removed the Metric View BI Compatibility Mode option from the Databricks Power BI connector; reports using it no longer function; use Native query + `MEASURE()` in DirectQuery or AI/BI dashboards. — [Databricks: Power BI with Databricks](https://docs.databricks.com/aws/en/partners/bi/power-bi/); [Microsoft Learn: metric views with BI tools](https://learn.microsoft.com/en-us/azure/databricks/uc-semantics/metric-views/bi-tools)
- Removal date given as 17 April 2026; COUNT DISTINCT/MEDIAN were problematic even before. — [Databricks Community article](https://community.databricks.com/t5/community-articles/power-bi-on-metric-views-why-the-totals-go-wrong-and-a-live/td-p/175719)
- Wrapper views: a standard view that applies `MEASURE()` at a fixed set of dimensions; one per dimension combination. — [Microsoft Learn: metric views with BI tools](https://learn.microsoft.com/en-us/azure/databricks/uc-semantics/metric-views/bi-tools)
- Metric views are marketed as "Unity Catalog Business Semantics"; Atlan, Collibra, Monte Carlo sync metric-view metadata (secondary source). — [Upsolve blog](https://upsolve.ai/blog/databricks-semantic-layer)

### Inferences
- For Snowflake-sourced models, the crosswalk target must be a UC object; without Lakehouse Federation or ingestion those tables are not SQL-answerable on Databricks.

### Gaps
- Did not research Lakehouse Federation for Snowflake (query federation / catalog federation) in this pass; needed to decide whether Snowflake-sourced models can be answered on Databricks.
