# All-reports lineage and stored snapshots

For the complete inventory of Power BI/Fabric API endpoints, callers, purposes, and retained fields, see [Power BI and Fabric API Usage](../powerbi-api-usage.md).

## Deploy first

Apply `prisma/migrations/20261116_pbi_report_lineage/migration.sql` through the approved database migration process, regenerate the Prisma client, and restart/redeploy web and workers. This session adds the migration but does not apply it or run a live pipeline. Local client generation produced the model types but encountered a Windows query-engine DLL lock; repeat generation after stopping the owning dev process when convenient.

The all-reports launch API checks for the snapshot table before enqueueing work. If it is absent, it returns `LINEAGE_STORAGE_NOT_READY` instead of starting a partially deployable run.

## Verify locally

In VS Code, choose **Tasks: Run Task > Verify Power BI report lineage**. The retained task in `.vscode/tasks.json` runs focused tests, focused ESLint, and the full TypeScript check in sequence. Its child tasks invoke Node directly as processes, avoiding PowerShell quoting of inline JavaScript. These checks do not migrate or write to a live database.

For provider access, run **Tasks: Run Task > Check Power BI definition access**. It lists accessible workspaces and requests one existing model/report export, following Fabric's asynchronous operation through completion. It prints only completion/error metadata and part counts, without saving definition contents or writing DB metadata. HTTP 202 alone is not a completed download. On 2026-11-17 at 00:04 UTC the sample completed with 16 model parts and 7 report parts; other items can still fail independently.

## Run from the UI

As a platform admin, open **Data Estate > Report lineage**, choose **Run lineage for all reports**, confirm the scope, then choose **Run all reports**.

The server enforces this sequential chain:

```text
pbi_inventory -> pbi_definitions -> pbi_parse -> pbi_catalog_link
                                                        |
                                             persist report snapshots
```

The explicit all-reports scope inventories every workspace accessible to the configured Power BI identity, without the source workspace allowlist. Definitions and Parse visit the full active estate, without their ordinary 25/50 success caps. Existing per-model runs retain their normal filtering and limits. Reports are processed serially inside the existing workers; failures remain visible in coverage rather than counting as full coverage. The Power BI handlers operate org-wide, so the launch uses one active Power BI source rather than duplicating the same estate run per source.

Translate, Oracle, Parity, and Publish are not included. Permissions and available definitions still bound coverage. Lineage includes report -> measure -> dependent semantic tables -> original data sources, with optional Unity Catalog mappings. It is not complete per-page, per-visual, or per-field lineage.

## Reading lineage in the UI

**Data Estate > Report lineage** (all reports) shows how far the pipeline got (definitions, parses, stored snapshots, with the drop at each stage) and the stored status split. *Common questions* filter the list on stored snapshot facts (`GET /api/agent-lab/powerbi/reports?filter=file|unbound|unknown|blocked`): reports that read files, have warehouse tables without a Unity Catalog mapping, have untraced sources, or are blocked/failed. Each row shows the report's source mix by kind and its Unity Catalog coverage.

**One report** draws four fixed lanes, left to right as data flows: original sources → model tables → measures on the report → the report.

- Click any box to trace everything upstream and downstream; the rest fades. Press `/` to find, `Esc` to clear.
- Line colour is the kind of source the line carries: Databricks, other databases, files/sites/feeds, defined in the model, unknown.
- A solid line is a detected use. A dashed line is model-wide: the table is in the model but no detected report measure reads it. A red dotted line is a measure the model does not have.
- With nothing selected, the side panel lists what keeps the report from ready (untraced sources, missing measures, unmapped warehouse tables), each with **Show** to highlight it. Selecting a box shows its connector, location, navigation steps, native query and binding, with copy buttons.
- The **Table** lens has one row per measure × table × source and copies as TSV.

The header pill is computed live from the current harvest; the stored snapshot's status, time and run are shown beside it.

**Source impact** (`/agent-lab/estate/powerbi/source-impact`) browses original sources by each system's own hierarchy and shows every model table, measure and report that depends on the selected level:

| System | Levels |
| --- | --- |
| Databricks | Workspace → Catalog → Schema → Table |
| Microsoft Fabric | Workspace → Item → Schema → Table |
| Snowflake | Account → Database → Schema → Table |
| SQL Server, Oracle, PostgreSQL, other databases | Server → Database → Schema → Table |
| SharePoint, OneDrive | Site → Folder → File → Sheet |
| File path, folder | Folder → File → Sheet |
| Web, OData | Host → File / feed |
| Power BI dataflow | Workspace → Dataflow → Entity |

Levels come only from parsed origin fields (`location`, `database`, `object`, `folder`, `file`, `items`); a level the harvest did not record is skipped, and a missing server or site is shown as "not recorded". Any node can be selected: a schema or site shows everything under it ("Changing anything in schema gold…"), with a clickable path and the levels inside it. The API is `GET /api/agent-lab/powerbi/sources/impact` (the tree with counts; `?node=` for a level's impact; `?key=` for one original source, used by "Which other reports use this source?" on a report page). The same file read by several models is one source; in-model and untraced origins are excluded. The flow draws up to 40 sources and counts the rest. Results are as current as each report's latest Catalog Link snapshot.

## Original data sources

The report explorer and API include source information without requiring a UC binding:

- `sources`: parsed model tables, original source origins, source locations, database/catalog, object/table, file/folder, file format, sheets/items, native queries, helper queries, storage/partition metadata, available navigation selectors (including Fabric workspace/lakehouse IDs), and optional binding details.
- `measures[].sources`: source tables reached by that detected measure's DAX dependencies.
- `sources[].referenced_by_measures`: detected report measures that reference the model table. Empty means **model-wide**, not proof that the report uses that table. Model-wide entries remain visible for reports with no explicit measures.
- `source_connections`: model-level inventory connections, including recorded server, database, path, connector, datasource/gateway IDs, and selected noncredential connection details. These connections are not guessed to belong to individual model tables.

Fabric SQL endpoints and Direct Lake storage are identified where explicit evidence exists. Schema/entity and navigation paths are included only when present in the harvested material. File paths and sheet names remain visible independently of warehouse bindings. Unsupported or absent table sources are marked unknown/not harvested; unknown original sources make a stored snapshot partial.

Credential-like URL/connection-string parameters are redacted; raw connection credential properties are not copied to the report payload. No source credentials or `.env` values are exposed. The shared SQL compiler and source-origin parser are unchanged by this report-only enrichment.

This payload extension needs no additional schema migration: the `pbi_report_lineage.lineage` JSONB column retains the expanded payload after Catalog Link. Existing snapshot rows are not automatically backfilled and may lack `sources` or `source_connections` until refreshed. The read-only lineage API resolves current harvested metadata immediately; a provider outage still prevents harvesting missing definitions.

The hub refreshes coverage every 15 seconds and links to Jobs. Report definitions recorded, current report/model parses, unresolved warehouse paths, missing models, and stored snapshots are separate counts. A report can legitimately have no explicit measures.

## Stored table

`pbi_report_lineage` stores the latest snapshot per report, not a history of every run. Catalog Link refreshes snapshots after binding, for its report/model scope (all active reports in an all-reports run). Read-only lineage GET requests continue resolving current harvested data and never write snapshots.

| Column | Meaning |
| --- | --- |
| `org_id`, `report_id`, `model_id` | Organization and internal report/model keys |
| `run_id`, `generated_at` | Producing Catalog Link job and snapshot time |
| `status` | `ready`, `partial`, `blocked`, or `failed` |
| `measure_count`, `uc_paths` | Resolved measure count and distinct UC paths |
| `lineage` | JSONB payload with report, harvest evidence, measures, original table sources, inventory connections, optional UC mappings, and resolver warnings |
| `warnings` | JSONB resolver, missing-input, and failure warnings |

`ready` means the current parsed inputs support the implemented lineage scope, with no unresolved model warehouse paths, unknown original table sources, or unknown referenced measures. It is not proof of page/visual/field completeness or parity. `partial` records unknown sources, unresolved bindings, or unknown measure names; `blocked` records missing/stale parses or no active model; `failed` records a resolution error. Non-warehouse sources can have complete source lineage without a UC path. Snapshot data can become stale after subsequent harvest changes until Catalog Link runs again. Join active reports when querying current estate coverage.

### Query reports and paths

Replace the organization placeholder with the organization being inspected.

```sql
SELECT r.name AS report_name,
       m.name AS model_name,
       l.status,
       l.measure_count,
       l.uc_paths,
       l.warnings,
       l.run_id,
       l.generated_at
FROM pbi_report_lineage l
JOIN pbi_reports r ON r.id = l.report_id AND r.org_id = l.org_id
LEFT JOIN pbi_models m ON m.id = l.model_id AND m.org_id = l.org_id
WHERE l.org_id = '<organization-id>' AND r.lifecycle = 'active'
ORDER BY r.name;
```

### Query measure-level dependency rows

```sql
SELECT r.name AS report_name,
       measure->>'name' AS measure_name,
       measure->>'measure_table' AS measure_home_table,
       measure->'tables_involved' AS dependent_model_tables,
       measure->'uc_paths' AS unity_catalog_paths,
       measure->>'found_in_model' AS found_in_model,
       l.generated_at
FROM pbi_report_lineage l
JOIN pbi_reports r ON r.id = l.report_id AND r.org_id = l.org_id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.lineage->'measures', '[]'::jsonb)) AS measure
WHERE l.org_id = '<organization-id>' AND r.lifecycle = 'active'
ORDER BY r.name, measure->>'name';
```

The second query has no rows for zero-measure or blocked reports; use the first query to retain those reports and their warnings.

### Query original source locations and table/file paths

```sql
SELECT r.name AS report_name,
       source_table->>'table' AS model_table,
       origin->>'system' AS source_system,
       origin->>'connector' AS connector,
       origin->>'location' AS server_site_or_path,
       origin->>'database' AS database_or_catalog,
       origin->>'object' AS source_table_or_object,
       origin->>'folder' AS folder,
       origin->>'file' AS file_name,
       origin->'items' AS sheets_or_items,
       source_table->'navigation' AS source_navigation,
       source_table->'referenced_by_measures' AS detected_measure_references,
       source_table->>'uc_full_path' AS optional_uc_mapping,
       l.generated_at
FROM pbi_report_lineage l
JOIN pbi_reports r ON r.id = l.report_id AND r.org_id = l.org_id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.lineage->'sources', '[]'::jsonb)) AS source_table
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(source_table->'origins', '[]'::jsonb)) AS origin
WHERE l.org_id = '<organization-id>' AND r.lifecycle = 'active'
ORDER BY r.name, source_table->>'table';
```

For model inventory connections, query `lineage->'source_connections'`. Empty `detected_measure_references` identifies model-wide source context, not a confirmed report/visual dependency.