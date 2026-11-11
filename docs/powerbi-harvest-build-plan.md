# Power BI semantic bridge: design and implementation plan

**Status:** design approved for build, 2026-11-11. Nothing is in the app yet. The offline scripts and harvested files listed in section 3 exist and were used to validate this design.

**Supersedes** the 2026-11-10 version of this file. **Builds on** [`reports/LLM Power BI semantic bridge.md`](../reports/LLM%20Power%20BI%20semantic%20bridge.md) (research), [`docs/reports/ALOFT knowledge base design.md`](reports/ALOFT%20knowledge%20base%20design.md) (knowledge stores and retrieval), and [`docs/powerbi-semantic-schema.md`](powerbi-semantic-schema.md) (scripts and API notes).

---

## 1. Summary

The Databricks catalog tells ALOFT which tables and columns exist and how they join. Power BI holds the business knowledge on top: what "Actual OPEX" or "Attained CII YTD" means, which rows are excluded, which date drives "year to date", and which filters a report applies by default. ALOFT will harvest that knowledge, translate it into Databricks SQL, prove the SQL returns the same numbers as Power BI, and let stewards approve the results. Approved results become verified queries and governed measures that Inspector and commissioned agents use.

The user should be able to ask "what was vessel OPEX last quarter against budget?" without naming a report. ALOFT finds the approved definition for the right business domain, runs the validated SQL on Databricks, and says where the definition came from and how well it matched Power BI.

### Goals

1. Capture business definitions from Power BI: measures, calculations, Power Query preparation, relationships, report filters, synonyms and glossaries.
2. Translate them into Databricks SQL and validate the translations against Power BI's own numbers.
3. Keep every definition traceable to its workspace, model, report, visual and evidence.
4. Handle many business domains (Finance, QHSE, Technical, Crewing, Procurement and others) whose definitions can legitimately differ.
5. Use the results in Inspector chat and agents without inventing a second semantic layer.

### Non-goals

- Migrating reports off Power BI or rebuilding dashboards in ALOFT.
- Writing anything back to Power BI or Databricks. All access is read-only.
- Treating every Power BI measure as correct or as an organisation-wide definition.
- Embedding every harvested object for search.

---

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Power BI is a **knowledge source and answer key**, not a migration source. | Its numbers are what the business already trusts, which makes them the best test of ALOFT's SQL. |
| D2 | **Enrich the existing semantic foundation** (`platform_sem_*`, verified queries, catalog semantics). No parallel Power BI semantic layer for agents. | One place for agents to look; avoids two competing definitions of the same KPI. |
| D3 | A **dedicated Power BI area** in the Data Estate for browsing and review, keyed by every Power BI ID (workspace, model, report, page, visual, `lineageTag`). | People need to see where a definition came from; agents need provenance. |
| D4 | **Separate harvest track.** Power BI is its own context source with its own job kinds. Linking to Catalog is an optional job that runs whenever either side changes; it is not chained after T0. | Power BI and Databricks harvests fail and refresh independently. Power BI work delivers value before Catalog coverage is complete. |
| D5 | **Catalog stays Databricks-only.** Power BI adds "used by" links to catalog objects and suggestions for unscanned paths. | Catalog is the warehouse truth; report tables are not warehouse objects. |
| D6 | **Raw files in encrypted object storage, parsed rows in Aurora `pbi_*` tables.** | The app, steward screens and org scoping live in Aurora. Raw files contain personal data and stay out of agent reach. |
| D7 | **Build in TypeScript inside the existing harvester** (`Dockerfile.harvester`, `scripts/context/orchestrator.ts`). The Python scripts stay as offline tools. | The harvester image is Node-only. Power BI REST, TMDL text and report JSON are all straightforward to handle in TypeScript; adding a Python runtime is not justified yet. |
| D8 | **Steward approval before anything reaches agents.** LLM output is always a draft. | Power BI is usually right, not always; translations can be wrong in plausible ways. |
| D9 | **Two kinds of correctness are kept apart:** "matches report X" (fidelity) and "agreed definition" (canonical). | A report can be wrong or can serve one department's purpose. |
| D10 | **Definitions are scoped by business domain.** The same metric name can have different approved definitions in different domains. | Finance and Technical can both be right about "OPEX" for their own purposes. |
| D11 | **Light pass across the whole estate, deep work only on pilot families.** | Inventory and classification are cheap and set priorities; translation and stewarding are expensive. |
| D12 | **Models with row-level or object-level security are not published to agents** until their access rules map to ALOFT's own access control. | Publishing SQL from a secured model would bypass its restrictions. |

---

## 3. Where we are

### 3.1 Done (offline, validated)

| Item | Evidence |
|---|---|
| Inventory of 3 workspaces: 503 models, 494 reports, report-to-model links, datasources, RLS flags | `scripts/harvest_powerbi_estate.py`, `powerbi-estate/20261110T122619Z/` |
| Full model definitions (TMDL) for 3 CII models | `scripts/fetch_powerbi_model_definition.py`, `powerbi-estate/definitions/` |
| Report definitions: CII SDK-2026 (modern format) and CII SDK-2025 (legacy format) | `scripts/fetch_powerbi_report_definition.py`, `powerbi-estate/report-definitions/`, `powerbi-estate/report-definitions-legacy/` |
| Power BI numbers by DAX query on models without RLS | `scripts/run_powerbi_dax_query.py` |
| Embedded table decoding (`Vessel_All_Dwts`, 778 rows) | `scripts/extract_pbi_embedded_table.py` |
| First parity check: CII model AER 2026 per vessel, 494 of 501 within 1% (98.6%) | `scripts/compare_cii_pbi_databricks.mjs`, `powerbi-estate/sql/cii_model_aer_2026_by_vessel.sql` |
| Report usage without admin APIs: service principal queried the workspace usage-metrics models (views, distinct users, dates per report; page views) | `powerbi-estate/dax/usage_*.dax`, `powerbi-estate/usage/` |
| `INFO.VIEW.TABLES()` and `INFO.VIEW.COLUMNS()` ran through `executeQueries` as the service principal. Microsoft documents `INFO` functions as unsupported on this API, so this is a convenience, not a dependency | same query files |

### 3.2 Estate facts that shape the design

| Fact | Consequence |
|---|---|
| 56 models require RLS identity; 447 do not; 237 read Databricks | Service principal can run DAX on 447 models; RLS models need another identity and are not published (D12) |
| 433 models use the `Abf` storage format (imported data) | Power BI numbers are a snapshot at last refresh; parity must compare closed periods |
| 348 reports are `PBIRLegacy`, 142 `PBIR`, 4 paginated | Two report parsers feeding one normalized shape. Legacy export with `format=PBIR-Legacy` was proven on CII SDK-2025 |
| Databricks datasources point at two workspaces (`adb-4626…` 252 entries, `adb-1194…` 3) | Catalog linking must match the Databricks host, not just the table path |
| 39 models read Excel files from personal OneDrive folders | Those definitions are caveated and never verified |
| The datasets API returns `createdDate` only, no modified date | Change detection uses refresh history and content hashes (section 8.4) |
| Authored descriptions are nearly absent (2 `///` comments across 3 models) | Descriptions are composed from names, synonyms, glossaries, report labels, LLM drafts and stewards |
| Q&A synonyms are in TMDL (`cultures/en-US.tmdl`) | No admin Scanner needed for synonyms |
| Models embed reference data and glossaries (`Vessel_All_Dwts`, `Appendix`, `Documentations`) | Embedded tables are first-class reference data |
| Admin Scanner returns 401 | Endorsement, sensitivity labels, tenant-wide lineage and usage are unavailable until IT enables admin APIs |
| Model names alone don't identify the domain: a name-pattern pass left 178 of 503 unclassified and mislabelled others | Domain assignment uses several signals (section 7.2) |
| Usage-metrics models exist in 2 of 3 workspaces. Embedded PBI Portal: 246 reports viewed, 23,642 views, but last refreshed 4 June 2026 (data 5 May – 3 June). Synergy App Central: 25 reports, 1,637 views, refreshed 10 November | Usage is a free priority signal, but these models keep about 30 days and refresh only when someone opens the usage report; each pull must record its window, and stale windows are flagged |
| CII reports in that window: CII SDK-2026 102 views, CII 100, CII - Vessel-2026 39, CII SDK-2025 23 | CII SDK-2026 and CII carry most CII traffic, which supports them as the first pilot models |
| Fetched CII models: 110 display folders, including "Unused - Placeholder" and "Titles & Scaffolding"; 605 format hints; 28 hierarchies, all automatic date hierarchies; no calculation groups, perspectives, KPI objects or dynamic format strings | Folders separate headline metrics from helpers and scaffolding (6.3); the other object types are parsed when other models contain them |

### 3.3 Not done

- Nothing stored in Aurora; no app screens; no jobs.
- `kb_verified_queries` does not exist in `prisma/schema.prisma`.
- Known app defects that block agent use: Inspector ranks governed context by connection name instead of the question (`src/lib/semantic/context-builder.ts`); the compiler does not quote identifiers (`src/lib/semantic/compiler.ts`); T3 semantic cards shadow T2 cards.
- Refresh history, refresh schedule, dataflow definitions and the admin Scanner are not harvested. Report usage was pulled once by hand, not on a schedule.

---

## 4. Concepts the design depends on

| Concept | Meaning | Why it matters here |
|---|---|---|
| Report vs semantic model | A report is the presentation layer; the model holds tables, measures and relationships. Several reports can share one model. | Business rules live in both. Report filters can change what a measure means on screen. |
| Power Query (M) | Transformation language that prepares data at refresh: filters, renames, merges, added columns. | SQL must repeat these steps (CII: vessel renames, fuel swaps, embedded DWT override). |
| DAX | Formula language for measures, calculated columns and calculated tables. | The business logic to translate. |
| Measure | Named DAX calculation evaluated at query time under the current filters. | The main unit of business definition. |
| Calculated column | DAX evaluated per row at refresh. | Translates to a SQL expression on the row, not an aggregate. |
| Filter context | The set of filters active when a measure is evaluated: visual axes, slicers, page and report filters, `CALCULATE` arguments, relationships. | The same measure returns different numbers in different contexts. SQL must reproduce the context, not just the formula. |
| Relationships | Joins with cardinality, filter direction, active or inactive. | Join logic; inactive relationships signal alternate date roles. |
| Import, DirectQuery, Direct Lake | Where data is read at query time. | Determines whether Power BI numbers are a snapshot or live. |
| RLS and OLS | Row-level and object-level security. | Governs who may see results (D12). |
| TMDL, PBIR, REST, XMLA | Text model definition, report definition, discovery APIs, query endpoint. | How metadata is extracted. |

---

## 5. Knowledge captured

Each item names its source, whether we have it, where it is stored and what ALOFT uses it for. "Fetched models" means the three CII model definitions already downloaded.

### 5.1 Inventory (REST)

| Item | Source | Have it | Store | Used for |
|---|---|---|---|---|
| Workspace id, name | `GET groups` | Yes | `pbi_workspaces` | Scope, display |
| Capacity, dedicated flag | `GET groups` | Not stored | `pbi_workspaces` | Whether XMLA / `executeDaxQueries` are possible |
| Model id, name, configured by, created date, URL | `GET datasets` | Yes | `pbi_models` | Identity, link back |
| RLS identity flags | same | Yes | `pbi_models.rls_required` | Oracle identity, publish block |
| Storage format, refreshable, gateway required | same | Yes | `pbi_models` | Freshness policy, gateway dependency |
| Datasources: kind, host, warehouse, URL, `gatewayId`, `datasourceId` | `GET datasets/{id}/datasources` | Yes | `pbi_model_datasources` | Connector mix, host matching, personal-file detection |
| Refresh history, schedule | `GET datasets/{id}/refreshes`, `/refreshSchedule` | **No** | `pbi_refreshes`, `pbi_models.last_refresh_at` | Every oracle value carries its refresh time; change detection |
| Report id, name, format (`PBIR`/`PBIRLegacy`/paginated), model id, URL | `GET groups/{ws}/reports` | Yes | `pbi_reports` | Parser choice, provenance |
| Dashboards and pinned tiles | `GET groups/{ws}/dashboards` | No | `pbi_dashboards` (later) | "This KPI matters" signal |
| Dataflow definitions | `GET groups/{ws}/dataflows/{id}` | No | `pbi_dataflows` | Classify dataflow-sourced tables |
| Endorsement (promoted, certified), sensitivity, tenant lineage | Admin Scanner | **Blocked** | `pbi_models.endorsement`, `.sensitivity` | Ranking, label enforcement |
| Report usage: views, distinct users, first and last date per report; page views per page (`SectionId`); last refresh of the usage model | Workspace usage-metrics model ("Usage Metrics Report") queried by DAX; counts only, no user ids stored | **Yes, 2 of 3 workspaces** (manual pull) | `pbi_usage` with window start, window end, source model | Priority order, report summaries, domain wave scoring |
| Usage for workspaces without a usage model, or older than 30 days | Admin activity events | **Blocked** | `pbi_usage` | Fill gaps, history |

### 5.2 Semantic model (TMDL)

| Item | TMDL location | Store | Used for |
|---|---|---|---|
| Model options, `PBI_QueryOrder`, culture | `model.tmdl` | `pbi_models.props` | M evaluation order for nested queries |
| Tables: hidden, description, `lineageTag` | `tables/*.tmdl` | `pbi_tables` | Structure; hidden tables rank low |
| Partition source and kind; storage mode per partition | `partition … = m / calculated` | `pbi_tables.partition_kind`, `.storage_mode`, `pbi_source_bindings` | Classifier (section 8.5), freshness |
| Native SQL, catalog navigation, M steps | partition M | `pbi_source_bindings` | Catalog link and SQL base |
| Columns: type, source column, format, data category, sort-by, summarize-by, folder, hidden | `column` blocks | `pbi_columns` | Units, formats, default aggregation, rename tracing |
| Calculated columns | `column X = <DAX>` | `pbi_columns.dax` | Row-level SQL expressions; business classifications promoted as dimensions |
| Measures: DAX, format, folder, description, `lineageTag` | `measure` blocks (often in a measure table such as `CII_Measures`) | `pbi_measures` | Main translation target |
| Display folders | `displayFolder` on measures and columns (110 in fetched models) | `pbi_measures.folder`, `pbi_columns.folder` | Metric role (headline, building block, scaffolding — 6.3), topic grouping in the Power BI area, domain signal |
| Format strings and format hints | `formatString`, `PBI_FormatHint` annotation (605 in fetched models) | `pbi_measures.format`, `pbi_columns.format` | Presentation: percentage, decimals, currency, thousands |
| Dynamic format strings | `formatStringDefinition` (none in fetched models) | `pbi_measures.format_dax` | Currency or unit chosen at query time; finance |
| KPI objects | `kpi` on a measure: target, status and trend expressions (none in fetched models) | `pbi_measures.kpi` | Targets and thresholds on metric cards |
| Detail rows | `detailRowsDefinition` (none in fetched models) | `pbi_measures.detail_rows_dax` | Drill-to-detail query for "show me the rows behind this" |
| Perspectives | `perspective` blocks (none in fetched models) | `pbi_perspectives` | Audience subsets of a model; domain signal |
| Calculated tables | `= calculated` | `pbi_tables` | Usually DAX-only parity |
| Relationships: columns, cardinality, direction, active | `relationships.tmdl` | `pbi_relationships` | Joins; date roles |
| Hierarchies | `hierarchy` blocks (all 28 in fetched models are automatic date hierarchies) | `pbi_hierarchies` with ordered levels | User-defined hierarchies become drill levels on promoted dimensions and inform allowed grains; automatic date hierarchies are skipped |
| Auto date tables | `LocalDateTable_*`, `DateTableTemplate_*` | Flag and skip | Noise |
| Q&A synonyms | `cultures/en-US.tmdl` | `pbi_synonyms` | Retrieval language |
| Parameters and shared expressions | `expressions.tmdl` | `pbi_models.parameters` | Year switches, server parameters |
| RLS roles and filters; OLS | `roles/*.tmdl` | `pbi_roles` (DAX text only, no members) | Security policy (section 12) |
| Calculation groups | `calculationGroup` blocks (none in fetched models) | `pbi_calculation_groups` | Items such as YTD, MTD and YoY become shared time-intelligence templates (9.1); other items are human-tier |
| Embedded tables | `Table.FromRows(…Binary.FromText…)` in M | `pbi_embedded_tables` | Reference data; glossaries |
| In-model glossary and document links | Embedded tables such as `Appendix`, `Documentations` | `pbi_embedded_tables` → glossary and document sources | Business definitions |
| Annotations | everywhere (fetched models: mostly tooling keys such as `SummarizationSetBy`, `PBI_FormatHint`, `PBI_NavigationStepName`, plus two unrecognized hex-named keys) | raw `props`; recognized keys extracted | Known tooling keys feed formats and M step names; any team-defined keys (owner, certified, steward) are mapped once observed |

### 5.3 Report (PBIR and legacy)

Both formats carry the same information; the legacy format stores it as JSON strings inside one `report.json`.

| Item | Modern PBIR | Legacy | Store | Used for |
|---|---|---|---|---|
| Model link | `definition.pbir` | `definition.pbir` | `pbi_reports.model_id` | Provenance |
| Pages | `pages/*/page.json` | `sections[]` | `pbi_report_pages` | Navigation, drillthrough |
| Visual type, title, fields by role | `visuals/*/visual.json` (`queryState`) | `visualContainers[].config` (`prototypeQuery`, `projections`, `vcObjects.title`) | `pbi_visuals`, `pbi_visual_fields` | Question shapes, measure usage, grain |
| Display names | `displayName`, `nativeQueryRef` | `NativeReferenceName`, `columnProperties` | `pbi_visual_fields.display_name` | Business vocabulary |
| Filters: report, page, visual | `filterConfig` | `filters` strings | `pbi_report_filters` | Report-only rules (CII: vessel exclusions) |
| Bookmarks and slicer state | `bookmarks/*.json` | `config.bookmarks` | `pbi_report_filters` scope `bookmark` | Default context |
| Cross-visual interactions | `visualInteractions` | section `config.relationships` | `pbi_visuals.interactions` | Which visuals filter which |
| Drillthrough parameters | page settings | `pods[]` | `pbi_report_pages.drillthrough` | Detail questions |
| Report-level measures | `reportExtensions.json` | — | `pbi_measures` scope `report` | Measures outside the model |
| Formula and help images | `StaticResources` | `StaticResources` | `pbi_report_resources` | Formula documentation |
| Layout and theme | yes | yes | not stored | — |
| Compressed visual query | — | `queryBinary` | ignored when `prototypeQuery` exists | — |

### 5.4 Runtime

| Item | Source | Store | Used for |
|---|---|---|---|
| DAX results | `executeQueries` (service principal, models without RLS) | `pbi_oracle_results` with grain, refresh time, identity, result hash | Answer key |
| DAX results for RLS models | Delegated user or monitoring identity | same | Oracle only, not publish |
| Engine metadata | DAX `INFO.VIEW.*` functions via `executeQueries` (worked as service principal on a model without RLS, but documented as unsupported) | Cross-check of parsed TMDL | Catch parser gaps; never the only source |
| Engine dependency graph (to test) | DAX `INFO.CALCDEPENDENCY()` via `executeQueries` (same caveat) or XMLA | `pbi_measures.references` | Cross-check of the DAX reference parser, which remains the primary source |

---

## 6. Data model

### 6.1 Raw layer

Exact API responses go to an encrypted S3 prefix `pbi-raw/{org}/{runId}/{itemId}/` with a manifest of item ids and sha256 hashes. Local development uses `powerbi-estate/`, which is gitignored. Raw files contain personal data (owner emails, RLS member tables) and are never indexed or shown to agents.

### 6.2 Normalized tables (Aurora)

Every table has `org_id`, the Power BI id or `lineageTag`, `content_hash`, `first_seen_run`, `last_seen_run` and `lifecycle` (`active`, `changed`, `removed`). Changed objects get a new version row, as T1 and T2 do today. Migration is additive and applied manually, following `prisma/migrations/*`.

| Table | One row per | Key fields |
|---|---|---|
| `pbi_workspaces` | workspace | capacity, domain hint |
| `pbi_models` | model | rls_required, ols, storage format, last refresh, schedule, family_id, domain_id, canonical flag, freshness policy, definition hash |
| `pbi_model_datasources` | datasource | connector, host, warehouse, gateway, `is_personal_file` |
| `pbi_refreshes` | refresh | status, start, end |
| `pbi_tables` | model table | partition_kind, storage_mode, hidden, source_m |
| `pbi_columns` | column | type, source column, calculated DAX, format, category, sort-by, summarize-by, folder |
| `pbi_measures` | measure | DAX, hash, references, format, format DAX, folder, role, KPI, detail-rows DAX, description, scope (model or report) |
| `pbi_hierarchies` | hierarchy | table, ordered levels, automatic flag |
| `pbi_perspectives` | perspective | included tables, columns and measures |
| `pbi_relationships` | relationship | from/to columns, cardinality, direction, active |
| `pbi_roles` | RLS/OLS role | filter DAX, object permissions |
| `pbi_calculation_groups` | calculation group | items |
| `pbi_synonyms` | Q&A term | term, bound object, authored or generated, weight |
| `pbi_embedded_tables` | embedded table | columns, row count, sha256, rows or S3 pointer, `pii_checked` |
| `pbi_source_bindings` | warehouse partition | connector, host, native SQL, M steps, `uc_full_path`, `databricks_source_id`, `context_object_id`, bind_status |
| `pbi_column_bindings` | model column | `pbi_column_id`, `context_column_id`, transform (rename, expression, M step), bind_status |
| `pbi_reports` | report | format, model id, summary text |
| `pbi_report_pages` | page | name, hidden, drillthrough |
| `pbi_visuals` | visual | type, title, interactions |
| `pbi_visual_fields` | field on a visual | role, table, column or measure, aggregation, display name |
| `pbi_report_filters` | filter | scope, field, operator, values |
| `pbi_families` | group of near-duplicate models | varying parameter, per-member constants |
| `pbi_domains` | business domain | name, steward group, sensitivity, rollout wave |
| `pbi_metric_cards` | metric definition | section 6.3 |
| `pbi_oracle_results` | DAX run | query, grain, result hash, rows, refresh time, identity |
| `pbi_translations` | translation attempt | SQL, tier, model and prompt version, parity verdict |
| `pbi_conflicts` | definition conflict | metric names, models, domains, difference, resolution |
| `pbi_usage` | report or page per usage window | views, distinct users (count only), first and last view date, window start and end, source usage model, usage model refresh time |
| `pbi_time_templates` | time-intelligence pattern | name (YTD, MTD, QTD, YoY, rolling N), DAX pattern, SQL template, required date semantics |

`pbi_source_bindings.context_object_id` and `pbi_column_bindings.context_column_id` are the only links into Catalog. `platform_context_object_links` is not used, because both of its ends must be catalog objects.

### 6.3 Metric card

The metric card is the single record a steward reviews and that promotion reads. One card per metric per scope.

`role` comes from the display folder and usage on visuals: measures shown on visuals or in folders like "CII Measures" are `headline`; measures used only inside other measures (folders like "CII Engine") are `building_block`; folders like "Unused - Placeholder" and "Titles & Scaffolding", and measures that return text for titles, are `scaffolding` and never become cards. Stewards can override.

```text
metric_card
  id, org_id, version
  domain_id, scope: org_canonical | domain_canonical | report_specific
  key: "<domain>.<metric_slug>"            e.g. finance.actual_opex, qhse.attained_cii_ytd
  names: { canonical, display_names[], synonyms[] }
  role: headline | building_block | scaffolding
  source: { workspace_id, model_id, model_name, report_ids[], visual_ids[], measure_lineage_tag, family_id, display_folder }
  usage: { views_30d, users_30d, window_end }
  targets: { kpi_target, status_thresholds }               from KPI objects when present
  time_variants: [ytd, mtd, yoy]                           applicable templates from 9.1
  meaning: { one_line, long, status: draft | approved, approved_by, approved_at }
  expression: { dax, dax_hash, depends_on_measures[], depends_on_columns[], calculated_columns[] }
  data: { uc_paths[], databricks_source_id, m_steps_summary, embedded_refs[], caveats[] }
  query_context: see 6.4
  presentation: { format, unit, currency, decimals }
  validation: { status, verdict, parity_pct, row_coverage, grains_tested[], periods_tested[], last_oracle_at, model_refresh_at }
  governance: { steward_group, evidence[], conflicts[], supersedes, superseded_by }
  publish: { verified_query_ids[], platform_sem_measure_id, answer_mode: databricks_sql | powerbi_dax }
```

### 6.4 Query context

Stored on each metric card and each verified query. This is how filter context becomes explicit.

```text
query_context
  grain: { allowed: [vessel, vessel+month, fleet+month], default }
  additivity: additive | semi_additive | non_additive
  implicit_filters: [{ table, column, op, values, from: measure_dax }]
  report_filters: [{ scope, field, op, values, from: visual_id | page | bookmark }]
  slicer_defaults: [{ field, values, from: bookmark_id }]
  date_semantics: { date_table, date_column, relationship, period_basis: calendar | fiscal | posting | accounting }
  relationship_overrides: [USERELATIONSHIP …]
  blank_handling: blank_is_null | blank_is_zero | exclude
  currency: { column, conversion_rule, rate_date }      finance
  freshness: snapshot_at_refresh | live | hybrid
```

| Field | Filled by | Confirmed by |
|---|---|---|
| grain | Visual roles (category, axis, rows) | Steward |
| additivity | Heuristic on DAX (`MAX`, `MIN`, `DISTINCTCOUNT`, ratios) | Steward |
| implicit_filters | DAX parser: `CALCULATE`, `FILTER`, `REMOVEFILTERS`, `ALL` arguments | Translation review |
| report_filters, slicer_defaults | Report parser | Steward chooses which belong to the definition |
| date_semantics | Relationships to date tables, time-intelligence functions, visual date fields | Steward |
| blank_handling | DAX patterns (`DIVIDE`, `COALESCE`), oracle comparison | Parity results |
| currency | Column names, format strings, finance glossary | Finance steward |
| freshness | Storage mode per partition | Automatic |

Agents enforce the allowed grains. A question at a grain the card does not allow is refused or answered with an explicit re-aggregation note.

### 6.5 Verified queries and existing stores

| Store | Status | Holds | Written by |
|---|---|---|---|
| `kb_verified_queries` | **New** (this plan ships a minimal version if knowledge base phase 2 has not) | question, alt phrasings, SQL, params, tables used, schema hash, status, origin `powerbi`, provenance props, query_context | `pbi_publish` |
| `platform_sem_measures` / `platform_sem_dimensions` | Exists | Promoted building-block measures; dimensions from calculated columns and user-defined hierarchies (with drill levels) | `pbi_publish` |
| `platform_nl_intent_embeddings` | Exists | Intent vectors for governed measures | Existing `intent-embed` path after promotion |
| `platform_context_semantics` (T2 cards) | Exists | Column and table semantics | Suggestions from Power BI with status `assumed` |
| Glossary / instructions | Planned in knowledge base design | Synonyms and in-model glossaries | `pbi_publish` after review |
| `knowledge_sources` documents | Exists | Linked documents (CII, SEEMP) | Document connector, later |

---

## 7. Multiple business domains

The estate spans Finance, QHSE and environment, Technical and fleet, Crewing and HR, Procurement, Commercial and IT reports. Each domain has its own vocabulary, owners, sensitivity and sometimes its own definition of a shared term.

### 7.1 Domain registry

`pbi_domains` holds the organisation's domain list, aligned with the vocabulary already used on catalog objects (`platform_context_objects.domain_keywords`). Each domain has a steward group, a sensitivity level, an access group for answers, and a rollout wave.

### 7.2 Assigning models to domains

A model's domain is scored from several signals; a steward confirms or overrides.

| Signal | Strength | Source |
|---|---|---|
| Domain of bound catalog objects | Strongest | `pbi_source_bindings` → `platform_context_objects.domain_keywords` and `entity_tags` |
| Workspace | Medium | `pbi_workspaces` domain hint |
| Table and measure names against the domain lexicon | Medium | TMDL |
| Display folders and perspectives | Medium | TMDL |
| Model and report names | Weak (name-only grouping left 178 of 503 unclassified) | Inventory |
| Steward decision | Final | Review queue |

Families (year or client copies) share one domain. A model can carry a secondary domain when it mixes subjects.

### 7.3 Same name, different meaning

- **Metric identity is `(domain, metric key)`.** `finance.actual_opex` and `technical.actual_opex` can both exist.
- **Scope levels:** `org_canonical` (one definition for everyone), `domain_canonical` (the domain's approved definition), `report_specific` (true only for that report).
- **Conflict detection:** `pbi_families` and the parser compare metrics with the same normalized name or synonym. Different DAX hash, filters, date basis or source tables create a `pbi_conflicts` row.
- **Resolution by stewards:** keep both and qualify display names ("Actual OPEX (Finance)"), merge into one canonical definition, or deprecate one. Each decision is recorded with evidence.

### 7.4 Runtime routing

1. Infer the domain from the question (terms, synonyms, intent match), the user's team and access, the commissioned agent's bound domains, and the conversation so far.
2. Restrict retrieval to that domain's approved metrics and verified queries, plus `org_canonical` ones.
3. If two domains match with similar confidence, ask which one is meant, or show both results labelled by domain. Never silently mix definitions.
4. Answers cite the domain, the metric key, and the source model and report.

### 7.5 Cross-domain metrics

Some metrics combine domains, for example "OPEX per vessel day" (Finance OPEX divided by Technical vessel days). These are composed metric cards that reference other cards by key. The requesting domain owns them, and they validate only when every input card is validated.

### 7.6 Stewardship and rollout by domain

- Each domain's review queue is filtered to its steward group, with a weekly capacity budget.
- Domains roll out in waves ordered by: report usage × share of Databricks-sourced models × share without RLS × steward availability.
- **Wave 1: QHSE / environment (CII family).** Already piloted; embedded data and year families.
- **Wave 2: Finance (OPEX, budget, cost).** Tests currency, period basis, category exclusions and budget sources.
- **Later waves:** Technical, Procurement, Crewing, Commercial, ordered by the score above.

### 7.7 Finance checklist

| Topic | What to capture |
|---|---|
| Actual vs budget | Separate sources and measures; budgets often come from Excel (for example, `Budgeting Report - SOMI` reads two files in personal OneDrive folders) → caveated unless the budget lands in Unity Catalog |
| Status and category rules | `CALCULATE` filters such as posted-only and capital excluded → `implicit_filters` |
| Period basis | Posting date, accounting period or fiscal calendar → `date_semantics.period_basis` |
| Currency | Transaction vs reporting currency, conversion rule and rate date |
| Sign conventions | Credits and debits, reversals |
| Account and category mappings | Often embedded or SharePoint tables → reference data with an owner |
| Ownership and entity filters | Owner, company, vessel management filters from slicers and RLS |
| Sensitivity | Finance answers restricted to the Finance access group |
| Time intelligence | YTD, MTD, QTD and year-over-year on the fiscal or posting calendar → shared templates (9.1), not one translation per measure |
| Dynamic formats | `formatStringDefinition` that picks the currency symbol at query time → `presentation.currency` rule |

---

## 8. Harvest pipeline

### 8.1 Source and job kinds

Power BI is registered as a `platform_context_sources` row with `connection_kind = 'powerbi'`, the tenant reference in `connection_ref`, and workspace ids in `scope_include`. Credentials live in Secrets Manager like Databricks credentials; locally they come from `PBI_TENANT_ID`, `PBI_CLIENT_ID` and `PBI_CLIENT_SECRET`.

| Job kind | Does | Runs when | Incremental rule |
|---|---|---|---|
| `pbi_inventory` | Workspaces, models, reports, datasources, refresh history and schedule; report and page usage from each workspace's usage-metrics model (counts only) | Daily | Full; cheap. Usage rows keyed by window, so overlapping 30-day windows do not double count |
| `pbi_definitions` | TMDL per model, report definition per report (format chosen per report) | After inventory | Models refreshed or flagged since the last fetch, plus a weekly hash sweep |
| `pbi_parse` | Raw files → `pbi_*` rows; classifier; embedded decode; synonyms; filters; draft metric cards | After definitions | Only items whose file hash changed |
| `pbi_catalog_link` | Bind partitions and columns to catalog objects; flag unscanned paths | After `pbi_parse`, and after any T0 run on a bound schema | Only unbound or changed bindings |
| `pbi_domains` | Score domains; detect families and conflicts | After parse | Changed models |
| `pbi_oracle` | Run DAX at agreed grains and periods | After a model refresh, for pilot metrics | Changed metrics or refreshed models |
| `pbi_translate` | Rule tier, then LLM tier; drafts to the review queue | After parse and link | Changed metrics |
| `pbi_parity` | Compare SQL to oracle; record verdict | After translate; nightly for published items | Changed or published |
| `pbi_publish` | Write approved items to `kb_verified_queries`, `platform_sem_*`, glossary; embed | Steward action | Approved items |

These appear on the existing Jobs screen as a "Power BI" job group with the same health, run history and controls. Only platform admins can launch them, matching current estate rules.

### 8.2 Light pass and deep pass

| Pass | Scope | Jobs |
|---|---|---|
| Light | All 503 models and 494 reports | `pbi_inventory`, `pbi_definitions` (models), `pbi_parse` (tables, partitions, bindings, synonyms), `pbi_catalog_link`, `pbi_domains` |
| Deep | Pilot families, then by wave | Report definitions, metric cards, `pbi_oracle`, `pbi_translate`, `pbi_parity`, `pbi_publish` |

The light pass yields the estate map: every model classified as answerable, caveated or blocked, with its domain and catalog links.

### 8.3 API limits and pacing

`getDefinition` took about 30 to 40 seconds per item in our runs, so a full serial model pass is about 4 to 5 hours. Run several workers in parallel within Fabric throttling, back off on HTTP 429, and resume from the last completed item. `executeQueries` has documented row, value and request-rate limits; measure them during the pilot and size oracle queries to fit.

### 8.4 Change detection

The API has no model modified date. Re-fetch a model when its refresh history shows a new successful refresh after a failure-free period, when its report list changes, or on a weekly sweep; compare content hashes and re-parse only on change. When the admin Scanner is enabled, use its modified timestamps instead.

### 8.5 Partition classifier

| Kind | Recognized by | Handling |
|---|---|---|
| Warehouse query | `Databricks.Catalogs`, `Value.NativeQuery`, `Sql.Database`, `Snowflake.Databases` | Extract host, catalog, schema, table and native SQL; bind to Catalog |
| Embedded table | `Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText(…))))` | Decode (base64 + deflate); store; PII check; glossaries to the knowledge layer; raise "move to Unity Catalog" finding |
| Join of other queries | `Table.NestedJoin`, `Table.ExpandTableColumn` | Resolve in `PBI_QueryOrder` order |
| Dataflow | `PowerBI.Dataflows` | Fetch dataflow definition, classify again |
| Calculated table | `= calculated` | DAX-only parity |
| Personal file | `-my.sharepoint.com/personal/` URLs | Caveated; never verified |
| Other file, web, SharePoint list | `Excel.Workbook`, `Web.Contents`, `SharePoint.Tables` | Caveated unless the data also exists in Unity Catalog |
| Auto date table | `LocalDateTable_*`, `DateTableTemplate_*` | Skip |

### 8.6 Parsers (TypeScript)

| Parser | Approach |
|---|---|
| TMDL | Indentation-based reader into objects (model, table, column, measure, partition, relationship, role, culture). Multi-line DAX and M blocks kept verbatim. |
| M | Pattern extraction for connectors, navigation steps (`[Name="…",Kind="…"]`), native SQL, and step names; embedded blob decode with Node `zlib`. |
| Native SQL | Extract three-part table names from `FROM`/`JOIN`; evaluate `node-sql-parser` for Spark SQL; unresolved cases are `ambiguous` for review. |
| DAX references | Tokenizer for `'Table'[Column]`, `[Measure]`, function names and `CALCULATE` filter arguments. Cross-check with `INFO.CALCDEPENDENCY()` where the service principal can run it. |
| Report | One normalizer with two readers: PBIR folder files and legacy `report.json` (parse nested `config` and `filters` strings, resolve `From` aliases to entities). Output: pages, visuals, visual fields, filters, bookmarks, interactions. |

### 8.7 Catalog link

For each binding, match `(databricks host → ALOFT Databricks source, catalog.schema.table)` to `platform_context_objects`. Results: `matched`, `unscanned` (suggest a focused T0 scan), `ambiguous` (steward), `non_uc` (other connector or file). Column bindings trace M renames and added columns back to source columns. Catalog object pages then show "used by N Power BI models".

---

## 9. Translation and verification

### 9.1 Translation tiers

1. **Rule tier:** `SUM`, `COUNT`, `DISTINCTCOUNT`, `DIVIDE`, `CALCULATE` with column filters, simple calculated columns.
2. **LLM tier:** iterators, time intelligence, variables, nested measures. Input: DAX, references, bound SQL, M steps, query context, glossary. Output: SQL plus stated grain, assumptions and a short explanation. Uses the harvest LLM client (`src/lib/context/harvest-llm.ts`); model and prompt version are recorded.
3. **Human tier:** context transition, calculation group items that are not time patterns, anything that fails parity twice.
4. **DAX fallback:** when SQL cannot be validated and the business still needs the answer, a card can use `answer_mode = powerbi_dax` with the stored DAX template, run under an identity that is allowed to see the data. Labelled "from Power BI" in answers.

Families: year and client copies become one parameterized query with per-member constants (for example the CII required reduction and rating boundaries per year), checked against every member.

**Time-intelligence templates.** YTD, MTD, QTD, year-over-year and rolling-window logic is translated once per pattern, not once per measure. Sources are calculation group items and measures that use `TOTALYTD`, `DATESYTD`, `DATESMTD`, `SAMEPERIODLASTYEAR`, `DATEADD` or `DATESINPERIOD`. Each template in `pbi_time_templates` takes a base measure's SQL and the card's `date_semantics` (date column, calendar or fiscal basis) and wraps it. A template is validated once against the oracle on two or more base measures. After that it applies to any additive card that has confirmed date semantics; its parity is still checked per card at publish. Non-additive cards are excluded unless the template is proven for them.

### 9.2 Parity method

| Rule | Detail |
|---|---|
| Periods | Compare only periods that closed before the model's last refresh |
| Grains | The visual's own grain, the total, and at least one coarser grain; non-additive metrics must fail or refuse correctly at disallowed grains |
| Row coverage | Rows present on both sides, reported separately in each direction |
| Cell tolerance | Relative 1% or absolute 0.05 by default; set per metric where units demand |
| Blank, null, zero | Explicit rule from `query_context.blank_handling` |
| Hold-out | Some periods and grains are never shown to the translation loop and are used for final grading |
| Record | SQL hash, DAX hash, refresh time, identity, grains, periods, row coverage, pass rate |

### 9.3 Verdicts and truth policy

| Verdict | Meaning | Action |
|---|---|---|
| `pass` | Matches at all tested grains and periods | Steward can approve |
| `fail_translation` | SQL differs and the Power BI definition looks right | Fix translation |
| `fail_stale` | Difference explained by refresh lag | Re-run on closed periods |
| `disagree` | SQL matches the agreed source (for example the master list) but Power BI differs | Steward decides: follow the report (`report_specific`) or the agreed definition (`domain_canonical`), and records why |
| `not_comparable` | Different filters, currency or access | Fix context before comparing |

Answers say "matches Power BI model X as of {refresh}" for fidelity, or "agreed {domain} definition; differs from report X" when stewards chose canonical. Published items are re-checked nightly; a failing check or a changed model demotes the verified query to `candidate`.

---

## 10. Descriptions, embeddings and retrieval

### 10.1 Descriptions

| Object | How the text is produced | Who approves |
|---|---|---|
| Measure one-line meaning | Template from names, format and synonyms; then an LLM draft from DAX, references, glossary and visual usage | Steward publishes; agents only see approved text |
| Verified query | Question from the visual (title + fields + filters) plus 5 to 7 alternative phrasings from synonyms and steward edits | Steward |
| Report summary | Template: model, format, page names, top visuals, top measures, notable filters, datasources | None needed; for people, not agents |
| Columns | Power BI names, formats and synonyms become **suggestions on catalog T2 cards** with status `assumed` | Steward on the catalog object |
| Model-only calculated columns | Description on `pbi_columns` until promoted as a dimension | Steward |

### 10.2 Embeddings

| Embedded | Text | Store |
|---|---|---|
| Verified queries (approved only) | Question, alternative phrasings, one-line answer meaning, measure display names, report and page titles, grain, domain. **SQL is not embedded**; it is loaded by id after a match | `kb_verified_queries` search vector (v1); `kb_index` kind `verified_query` (v1.1) |
| Promoted building-block measures | Steward question, synonyms, one-line meaning | `platform_nl_intent_embeddings` via the existing path |
| Glossary terms | Term and definition | `kb_index` kind `instruction` (v1.1) |
| Catalog tables and columns | Existing T2 text | `platform_context_embeddings` (unchanged) |
| Not embedded | Raw TMDL, DAX, M, report JSON, every measure, every report, every column, embedded rows | — |

Vectors use the existing Titan v2 1024-dimension path (`embedQuery` in `src/lib/context/embed.ts`).

### 10.3 Retrieval order in Inspector (v1)

1. Domain inference (section 7.4).
2. Verified-query match within the domain: vector plus keyword on questions and titles; above threshold, run the stored SQL with parameters and cite provenance.
3. `matchIntents` on governed measures (`src/lib/semantic/intent-match.ts`).
4. Catalog context (existing search).
5. Compiler or LLM SQL, labelled as a draft.

Full `kb_index` with rank fusion arrives in v1.1, per the knowledge base design; v1 does not wait for it.

---

## 11. App surfaces

| Surface | What changes |
|---|---|
| **Data Estate → Power BI** (new tab in `src/lib/estate/nav-items.ts`) | Workspaces → models → tables, measures, relationship diagram, roles, embedded tables, catalog links → reports → pages → visuals. Every view shows Power BI ids and a link back to Power BI, plus views and users for the latest usage window. Measures are grouped by display folder. |
| **Power BI review queue** | Filtered by domain. Metric card with DAX, M summary, SQL, diff, parity verdict, conflicts; actions approve, reject, set scope, mark canonical, edit meaning |
| **Catalog** | "Used by N Power BI models" panel on object pages; unscanned-path suggestions; search boost for objects Power BI uses |
| **Entities** | Promoted measures with synonyms, domain and a "matches Power BI" badge |
| **Lineage** | Report → model → table → catalog object; verified query → model |
| **Jobs** | "Power BI" job group with the nine job kinds |
| **Inspector and agents** | Retrieval order in 10.3; answers cite domain, metric key, model, report, parity and refresh |
| **Evaluation** | Held-out oracle results as benchmark; nightly report of pass, fail, regression and disagree by domain |

---

## 12. Security and data handling

- All Databricks and Power BI access is read-only. Parity runs `SELECT` only; no `DROP`, `DELETE`, `INSERT` or other writes.
- Fabric `getDefinition` requires read and write permission on the item, so the app needs at least the **Contributor** workspace role on each workspace in scope. It already has that on all three current workspaces: definitions downloaded from each on 2026-11-11. Only workspaces found later, for example through the Scanner, need a new grant. ALOFT calls only read endpoints; the gap between the role granted and the access used is recorded for security review.
- Secrets stay in Secrets Manager or `.env`; never printed, logged or committed.
- Raw files stay in encrypted storage or gitignored local folders and are never indexed.
- RLS member tables and owner emails are not stored in normalized tables shown to agents; RLS and OLS rules are stored as DAX text only.
- Models with RLS or OLS: oracle allowed with an authorized identity; publishing blocked until access rules map to ALOFT access grants.
- **Path to permission-aware answers (later phase).** Each RLS role filter is classified:
  - *Identity lookup*, for example CII SDK-2026's `RLS_ID[Email] = USERPRINCIPALNAME()` joined to owners. ALOFT applies the same filter at query time: it matches the signed-in user's email against the same mapping table, which must be in Unity Catalog or a steward-owned reference table rather than embedded in the model.
  - *Static filter*, a fixed value list. This becomes a row filter on the verified query.
  - *Complex DAX*. Publishing stays blocked.

  OLS hides objects, so hidden tables and columns are excluded from cards for users outside the role. A model moves from blocked to publishable only after a steward confirms the mapping and a test shows that two users with different roles get the same rows as in Power BI.
- Embedded tables pass a PII check before use as reference data.
- Verified queries and metric cards carry the domain's access group; retrieval filters on the user's access.
- Personal-file sources are caveated and never verified.

---

## 13. Implementation plan

### 13.1 Workstreams and code locations

| Workstream | Files |
|---|---|
| Schema | `prisma/schema.prisma`; additive migration `prisma/migrations/<date>_powerbi_bridge/migration.sql`; minimal `kb_verified_queries` migration if knowledge base phase 2 has not shipped it |
| Power BI client | `src/lib/powerbi/client.ts` (tokens for Power BI and Fabric scopes, paging, long-running operations, 429 back-off), `src/lib/powerbi/credentials.ts` |
| Inventory and definitions | `src/lib/powerbi/inventory.ts`, `src/lib/powerbi/definitions.ts`, `src/lib/powerbi/raw-store.ts` |
| Parsers | `src/lib/powerbi/tmdl-parse.ts`, `m-classify.ts`, `native-sql.ts`, `dax-refs.ts`, `report-parse.ts` (PBIR and legacy readers) |
| Catalog link and domains | `src/lib/powerbi/catalog-link.ts`, `src/lib/powerbi/domains.ts`, `src/lib/powerbi/families.ts` |
| Oracle, translation, parity | `src/lib/powerbi/oracle.ts`, `translate.ts` (rule tier + `harvest-llm.ts`), `parity.ts` (read-only execution via `src/lib/databricks/execute.ts`) |
| Publish | `src/lib/powerbi/publish.ts` → `kb_verified_queries`, `platform_sem_*`, existing intent embedding |
| Jobs | `src/lib/context/queue.ts` (`JobKind` union), `scripts/context/orchestrator.ts` (new cases), `src/lib/estate/job-ui.ts` (labels, group, upstream/downstream), `src/lib/estate/launch-kinds.ts` |
| Source registration | `src/app/api/agent-lab/context/sources/route.ts` (accept `powerbi`) |
| Read APIs | `src/app/api/agent-lab/powerbi/**` (workspaces, models, reports, metric cards, review actions), section access via `src/lib/sections` |
| UI | `src/views/agent-lab/estate/powerbi/*`, review queue, catalog object panel in `src/views/agent-lab/estate/object.tsx` |
| Inspector | `src/lib/semantic/context-builder.ts` (question-based ranking, verified-query first), `src/lib/semantic/compiler.ts` (identifier quoting) |
| Tests | Unit tests per parser using the harvested CII files as fixtures (with personal data removed); route coverage tests for new routes |

Next.js code follows `node_modules/next/dist/docs/` per `AGENTS.md`. Every change is logged in `docs/CHANGELOG.md` and `docs/jobs/session-log.md`; `docs/jobs/current-status.md` is updated when job behavior changes.

### 13.2 Phases

| Phase | Delivers | Depends on | Exit gate |
|---|---|---|---|
| **0. Unblock and baseline** | IT request for admin Scanner and an oracle identity for RLS models; add refresh history to inventory; test `INFO.CALCDEPENDENCY()`; ask workspace owners to open the Embedded PBI Portal usage report so its usage model refreshes, and to add a usage model to the third workspace; write 50–100 questions from top CII visuals and 20 Finance questions; score current ALOFT | IT, domain stewards named | Baseline score per domain; steward named per pilot domain; blocked items listed |
| **1. Store and light pass** | Schema; client; `pbi_inventory`, `pbi_definitions`, `pbi_parse`; both report readers; classifier; embedded decode; Power BI tab (browse only) | Sources API accepts `powerbi` | 100% of models classified answerable, caveated or blocked; parse failures under 5% of fetched items; CII reports identical in normalized form whether PBIR or legacy |
| **2. Catalog link and domains** | `pbi_catalog_link`, column bindings, host matching, `pbi_domains`, families, conflicts; Catalog "used by" panel; lineage | Databricks T0 on bound schemas (not required to start) | At least 90% of Databricks partitions in pilot models bound to scanned objects; every model has a confirmed or proposed domain |
| **3. QHSE pilot (CII)** | Metric cards with query context; oracle; translation tiers; parity method; review queue; `kb_verified_queries`; publish; Inspector retrieval order; compiler and ranking fixes | Phase 1–2; knowledge base phase-1 fixes | At least 15 verified queries passing parity at all tested grains and periods; benchmark gain over baseline measured; steward minutes per approved item recorded |
| **4. Finance pilot** | Finance metric cards (Actual OPEX, budget, variance, cost per vessel) with currency, period basis and category rules; budget-source caveats; domain access groups; conflict handling with any Technical OPEX | Phase 3 | 3–5 Finance metrics validated and approved; at least one cross-domain conflict resolved and recorded |
| **5. Scale by wave** | Domain waves by score; nightly parity; demotion on drift; usage-based ordering; value index from slicers | Usage data | Benchmark above 80% per domain before user testing in that domain |
| **6. Runtime trust** | Domain-aware routing and clarifying questions; "matches Power BI" badge; disagreement alerts; DAX fallback for approved cards | Phases 3–5 | Fewer escalations; adoption by domain |
| **7. Secured models** | RLS role classifier; identity-lookup and static filters applied at query time; OLS object hiding | ALOFT access grants; mapping tables in Unity Catalog | Two-user test matches Power BI rows for each published secured model |

Phases 1 and 2 cover the whole estate cheaply. Phases 3 onward go one domain at a time, paced by steward capacity.

---

## 14. Risks and open questions

| Risk or question | Mitigation or how to answer |
|---|---|
| Steward capacity is the bottleneck | Measure minutes per item in the CII pilot; size waves from that; LLM drafts reduce writing, not review |
| Translation automation is partial (an external case reported 40%) | Plan for human tier; prioritise by usage |
| Admin APIs stay blocked | Design works without them; usage comes from workspace usage-metrics models; endorsement and labels arrive later |
| Usage-metrics models go stale or cover only 30 days | Record each pull's window and the usage model's refresh time; flag windows older than 45 days; keep history by storing every window |
| No unattended identity for RLS models | Delegated user runs for oracle only; no publishing |
| `lineageTag` stability across republish is unproven | Re-fetch CII after its next publish and compare |
| "Prep data for AI" content location is unknown | Fetch a model where it is configured and inspect parts |
| Embedded tables act as shadow master data | Raise a "move to Unity Catalog" finding with an owner |
| Budgets and mappings live in personal Excel files | Caveat; push to Unity Catalog through the data team |
| Which CII model is official | QHSE owner decision, recorded on the metric cards |
| Domain disputes over shared terms | Conflict records, scope levels, and qualified names |

---

## 15. Appendix

### 15.1 Harvested files on disk (gitignored)

| Path | Contents |
|---|---|
| `powerbi-estate/20261110T122619Z/` | Inventory: `manifest.json`, `semantic_models.csv`, `report_semantic_links.csv`, per-workspace `reports.json` and `semantic_models_list.json`, per-model JSON with detail and datasources |
| `powerbi-estate/definitions/{modelId}/` | TMDL for CII (`ee56d7f5…`), CII SDK-2026 (`3ba1095b…`), CII SDK-2025 (`1e76560b…`) |
| `powerbi-estate/report-definitions/820023a2…/` | CII SDK-2026 report, modern format |
| `powerbi-estate/report-definitions-legacy/cf0ce134…/` | CII SDK-2025 report, legacy format |
| `powerbi-estate/dax/`, `sql/`, `lookups/` | Pilot DAX queries and results, SQL translation, decoded `Vessel_All_Dwts`, parity summary |
| `powerbi-estate/no_rls_models.csv` | Models without RLS |
| `powerbi-estate/usage/` | Views per report from the two usage-metrics models (counts only); queries in `powerbi-estate/dax/usage_*.dax` |

### 15.2 Glossary

| Term | Meaning |
|---|---|
| Oracle | Power BI's own result for a DAX query, used as the answer key |
| Parity | Agreement between ALOFT SQL and the oracle under the rules in 9.2 |
| Metric card | The reviewed record of one metric definition (6.3) |
| Query context | Grain, filters, dates, blanks, currency and freshness that define how a metric is evaluated (6.4) |
| Family | Near-duplicate models that differ by year or client |
| Fidelity / canonical | Matches a report / agreed definition (D9) |
| Light pass / deep pass | Estate-wide cheap harvest / per-domain translation and review (D11) |
