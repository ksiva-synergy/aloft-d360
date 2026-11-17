# Power BI data: formats, sources, fields, and use in ALOFT

**Audience:** Anyone asking “what exactly do we pull from Power BI, in what shape, and where does it land?”

**Related:** [powerbi-module-layered-guide.md](./powerbi-module-layered-guide.md) · [powerbi-semantic-schema.md](./powerbi-semantic-schema.md) (offline Scanner/TMDL scripts)

---

## 1. Three channels of data

| Channel | Protocol | Format | Job | When |
|---------|----------|--------|-----|------|
| **Catalog REST** | Power BI REST `api.powerbi.com` | JSON lists | `pbi_inventory` | First and on refresh |
| **Definitions** | Fabric REST `api.fabric.microsoft.com` | **TMDL** + **PBIR** file trees (base64 parts → disk) | `pbi_definitions` | After inventory; skip if hash unchanged |
| **Numbers (oracle)** | Power BI REST `executeQueries` (+ Arrow path for some RLS) | JSON rows / Arrow | `pbi_oracle` | After translate (parity truth) |

We **do not** depend on Admin Workspace Scanner JSON in the app harvester (401 in tenant); per-model **TMDL via Fabric `getDefinition`** replaces bulk schema scan for production.

**Derived in ALOFT (not downloaded as one blob):**

- Parsed rows in Aurora (`pbi_tables`, `pbi_measures`, …) — job `pbi_parse` reads **TMDL files from raw store**
- Generated SQL — job `pbi_translate` reads **DAX + M from Aurora**
- Verified queries — job `pbi_publish` writes **`kb_verified_queries`**

---

## 2. Inventory (`pbi_inventory`) — JSON only

**How:** Service principal → `client.ts` → OAuth scope `analysis.windows.net/powerbi/api`.

| Microsoft API | Response shape (we use) | Aurora table | Columns we store |
|---------------|-------------------------|--------------|------------------|
| `GET /groups` | `{ value: [{ id, name }] }` | `pbi_workspaces` | `pbi_workspace_id`, `name`, `content_hash`, run ids |
| `GET /groups/{ws}/datasets` | `{ value: [{ id, name, description, configuredBy, isRefreshable, targetStorageMode, isEffectiveIdentityRequired, isEffectiveIdentityRolesRequired }] }` | `pbi_models` | `pbi_model_id`, `name`, `description`, `configured_by`, `is_refreshable`, `storage_mode`, **`rls_required`** (derived), `content_hash` |
| `GET /groups/{ws}/reports` | `{ value: [{ id, name, reportType, format, datasetId, webUrl }] }` | `pbi_reports` | `pbi_report_id`, `pbi_model_id`, `name`, `report_type`, **`report_format`** (`PBIR`, `PBIRLegacy`, …), **`web_url`**, link to internal `model_id` |
| `GET /groups/{ws}/datasets/{id}/datasources` | `{ value: [{ datasourceType, gatewayId, datasourceId, connectionDetails, … }] }` | `pbi_model_datasources` | `datasource_type`, `connection_server`, `connection_path`, `gateway_id`, `datasource_id`, **`is_personal_file`**, full object in **`raw` JSON** |

**Example — what inventory JSON looks like (dataset row, simplified):**

```json
{
  "id": "b7d7e779-15df-4c75-9c8a-27764fd889d2",
  "name": "Vessel Internal Audit",
  "targetStorageMode": "Abf",
  "isEffectiveIdentityRolesRequired": false
}
```

**Use in app:** Estate model list, RLS badges, “Open in Power BI” links, datasource warnings (personal OneDrive Excel), jobs scoping.

**Not in inventory:** DAX, M, table lists, measure text — those need definitions + parse.

---

## 3. Definitions (`pbi_definitions`) — TMDL & PBIR files

**How:** Fabric `POST …/getDefinition` (async 202 → poll operation → `definition.parts[]`). Each part: `{ path, payload }` where **`payload` is base64** file bytes. Written by `raw-store.ts` under `PBI_RAW_STORE_ROOT` (default `powerbi-estate/`).

### 3.1 Semantic model → **TMDL** tree

**API:**

```http
POST https://api.fabric.microsoft.com/v1/workspaces/{workspaceId}/semanticModels/{modelId}/getDefinition?format=TMDL
```

**On disk (example layout):**

```text
powerbi-estate/definitions/{pbi_model_id}/
  database.tmdl
  model.tmdl
  relationships.tmdl
  expressions.tmdl          # shared M expressions
  cultures/en-US.tmdl       # Q&A synonyms
  roles/Owner & TSI RLS.tmdl
  tables/Fact_Sales/
    Fact_Sales.tmdl           # table, columns, measures, partition source = M
  tables/Date/
    Date.tmdl
```

**TMDL is text** (Tabular Model Definition Language): indentation-based blocks like `table`, `column`, `measure`, `partition`, `relationship`.

**Example — measure block inside `tables/…/*.tmdl`:**

```text
measure 'Revenue' = SUM(Fact[Amount])
    formatString: #,0.00
    displayFolder: KPIs
    lineageTag: a1b2c3d4-…
```

**Example — partition source (Power Query M) in same file:**

```text
partition 'Fact_Sales' = m
    mode: import
    source =
        let
            Source = Databricks.Catalogs("adb-…", "catalog.schema.table")[Data],
            …
        in
            Source
```

**Metadata stored on `pbi_models.props` after fetch (not the full files):**

| `props.definition` field | Meaning |
|--------------------------|---------|
| `storage_kind` | `definitions` |
| `storage_path` | Relative path under raw root |
| `part_count` | Number of Fabric parts |
| `content_hash` | Hash of all part payloads |
| `inventory_hash` | Links to inventory `content_hash` when fetched |
| `fetched_at`, `fetch_run_id` | Audit |

**Use:** Input to `pbi_parse`; stewards can open raw TMDL on disk; graph API reads same folder for report consumers when present.

### 3.2 Report → **PBIR** or **PBIR-Legacy** tree

**API:**

```http
POST https://api.fabric.microsoft.com/v1/workspaces/{ws}/reports/{reportId}/getDefinition
POST …/getDefinition?format=PBIR-Legacy   # when report_format is legacy
```

**On disk:**

```text
powerbi-estate/report-definitions/{pbi_report_id}/     # modern PBIR
  definition/pages/…/visuals/…/visual.json
  report.json                                          # sometimes root summary

powerbi-estate/report-definitions-legacy/{id}/         # legacy
  report.json                                          # large JSON; config string inside
```

**PBIR `visual.json`:** JSON describing visual type, field wells (`Measure.Property`, columns, hierarchies), filters.

**Legacy `report.json`:** Outer JSON; inner `config` string contains escaped JSON — we scan for `"Measure": { "Property": "Measure Name" }`.

**What `pbi_parse` extracts today for reports:**

| Stored | Field | Use |
|--------|-------|-----|
| `pbi_reports.props.parse` | `page_count`, `measure_refs[]`, `parsed_at` | Graph “which reports use this measure”; priority hints |

Full visual/page filters are in raw PBIR on disk; normalized filter harvest is future work.

---

## 4. Parse (`pbi_parse`) — TMDL → Aurora columns

**How:** Walk `*.tmdl` under `props.definition.storage_path` → `tmdl-parse.ts` → Prisma.

### 4.1 File → parser → table mapping

| TMDL file | Parser | Target |
|-----------|--------|--------|
| `tables/**.tmdl` | `parseTmdlTableFile` | `pbi_tables`, `pbi_columns`, `pbi_measures`, optional `pbi_source_bindings`, `pbi_embedded_tables` |
| `relationships.tmdl` | `parseTmdlRelationshipsFile` | `pbi_relationships` |
| `roles/*.tmdl` | `parseTmdlRoleFile` | `pbi_roles` (`filter_dax`, members in `props`) |
| `model.tmdl`, `database.tmdl` | model/database parsers | `pbi_models.props.model_definition` |
| `cultures/*.tmdl` | culture parser | `pbi_models.props.synonyms` |
| `expressions.tmdl` | expressions parser | `pbi_models.props.expressions` (M snippets, capped) |

### 4.2 Key fields per entity (what we keep)

**`pbi_tables`**

| Column | From TMDL / logic |
|--------|-------------------|
| `name`, `lineage_tag` | Table block |
| `partition_kind` | `classifyPartitionSource(M)` → `warehouse_query`, `embedded_table`, `file`, `auto_date_table`, … |
| `source_m` | Full partition M text (up to 500k chars) — **Power Query lineage for compiler** |
| `hidden`, `storage_mode` | TMDL properties |
| `props.tmdl` | Extra metadata (partitions list, refresh policy fragments, etc.) |

**`pbi_columns`**

| Column | From |
|--------|------|
| `name`, `data_type`, `lineage_tag` | column block |
| `source_column` | Mapped warehouse column name when present |
| `calculated_dax` | Calculated column expression |
| `format_string`, `display_folder`, `summarize_by` | TMDL |
| `props.tmdl` | Hierarchies, variations, etc. |

**`pbi_measures`** (primary input to translation)

| Column | From |
|--------|------|
| `name`, `dax`, `dax_hash` | measure `= …` expression body |
| `lineage_tag` | Stable id across re-parse → keeps translations/oracle/VQ linked |
| `format_string`, `display_folder` | TMDL |
| `props.tmdl` | KPI, format string defs, descriptions |

**`pbi_source_bindings`** (per warehouse-backed table)

| Column | From M partition |
|--------|----------------|
| `native_sql` | `Value.NativeQuery` SQL text if present |
| `uc_full_path` | SQL table paths or `Databricks.Catalogs` navigation path |
| `connection_host` | Databricks workspace host in M |
| `connector` | `describeSourceOrigins` → databricks, snowflake, sqlserver, file, … |
| `bind_status` | `pending` until `pbi_catalog_link` matches UC |

**`pbi_models.props` after parse**

| Key | Content |
|-----|---------|
| `parse` | `parsed_at`, `definition_hash`, `table_count`, `measure_count`, `parser_version` |
| `classification.answerability` | `answerable` / `caveated` / `blocked` from RLS + partition kinds |
| `expressions`, `parameters` | Shared M |
| `synonyms` | Q&A synonym map from culture TMDL |
| `tmdl_unhandled` | Keyword counts we do not fully model yet |

**Identity rule:** Tables/measures **reconcile by `lineage_tag`**, then name — so `pbi_translations`, `pbi_oracle_results`, and `kb_verified_queries` survive re-parse.

---

## 5. Oracle (`pbi_oracle`) — scalar values from Power BI

**How:** Build DAX like `EVALUATE { [Measure Name] }` (`dax-query.ts`) → `executeDatasetQueries` (or `execute-dax.ts` for RLS-capable path).

**Response shape (REST):**

```json
{
  "results": [{
    "tables": [{
      "rows": [{ "[Measure Name]": 12345.67 }]
    }]
  }]
}
```

**Stored in `pbi_oracle_results`:**

| Field | Use |
|-------|-----|
| `measure_name`, `measure_id` | Join to `pbi_measures` |
| `value_text`, `value_kind` | Typed storage (number, text, date, blank) |
| `result_hash` | Deduplication |
| `dataset_refreshed_at` | From `GET …/refreshes` on model — freshness in parity |

**Use:** Ground truth for `pbi_parity`; never shown raw to agents.

---

## 6. Downstream: what uses which source

| Consumer | Reads |
|----------|-------|
| **Estate UI** | Aurora only (`pbi_*` + recreation from `pbi_translations`) |
| **Model graph API** | Aurora + optional raw report folder for `measure_refs` |
| **Compiler** | `pbi_measures.dax`, `pbi_columns`, `pbi_relationships`, `source_m`, bindings |
| **Catalog link** | `native_sql`, M navigation paths, `platform_context_objects` |
| **Inspector** | `kb_verified_queries` (not TMDL) |
| **Agents** | Verified SQL + provenance — **no** raw store |

---

## 7. Format cheat sheet

| Format | MIME / type | Contains | We store full copy? |
|--------|-------------|----------|---------------------|
| **TMDL** | `.tmdl` text | Tables, columns, measures, DAX, M, RLS, relationships | Yes — raw store; parsed excerpts in Postgres |
| **PBIR** | JSON parts | Pages, visuals, fields, filters | Yes — raw store; summary in `pbi_reports.props` |
| **PBIR-Legacy** | `report.json` | Entire report config as JSON string | Yes — raw store |
| **REST inventory** | JSON | ids, names, urls, flags | No files — rows only |
| **REST datasources** | JSON | Gateways, servers, paths | `pbi_model_datasources.raw` |
| **executeQueries** | JSON rows | Measure values | `pbi_oracle_results` |
| **Databricks SQL** | text | Generated, not from PBI | `pbi_translations.sql_text` |

---

## 8. Example: one measure end-to-end

```text
1. Inventory: dataset id + name → pbi_models
2. Definitions: Fabric TMDL → powerbi-estate/definitions/{id}/tables/X/X.tmdl
3. Parse: measure 'Opex YTD' = … → pbi_measures.dax + lineage_tag
4. Catalog link: partition M → pbi_source_bindings.uc_full_path = catalog.schema.fact_opex
5. Translate: DAX + graph → pbi_translations.sql_text
6. Oracle: EVALUATE { [Opex YTD] } → pbi_oracle_results
7. Parity: run SQL on Databricks → parity_verdict on translation
8. Publish: pass → kb_verified_queries (embedding + SQL)
9. Inspector: user question → run_verified_query
```

---

## 9. Security note

TMDL and legacy reports may contain **embedded tables** (emails for RLS, vessel lists). Raw store is **not** in git and is **not** exposed to agent tools; only steward UI and jobs read it.