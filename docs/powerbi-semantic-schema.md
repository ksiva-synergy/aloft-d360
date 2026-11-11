# Power BI semantic schema (DAX, Power Query, tables)

Catalog harvest (`harvest_powerbi_estate.py`) does **not** include the tabular model. For **tables, columns, measures, DAX, and Mashup (M)** you need the **Admin Scanner** (Workspace Info API).

## What each layer gives you

| Layer | Script | Content |
|-------|--------|---------|
| Catalog | `harvest_powerbi_estate.py` | Dataset id/name, datasources, reports |
| **Schema** | `harvest_powerbi_schema.py` | Tables, columns, measures, relationships (when returned), **DAX** and **M** when `datasetExpressions=true` |

Scanner docs: [Run metadata scanning](https://learn.microsoft.com/en-us/fabric/governance/metadata-scanning-run), [PostWorkspaceInfo](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-post-workspace-info).

## Tenant settings (IT)

1. **Service principals can use Fabric APIs** (formerly "Allow service principals to use Power BI APIs") — include your app. Already on: inventory and `getDefinition` work.
2. **Service principals can access read-only admin APIs** — enabled for a security group that contains the app. The app does not need the Fabric administrator role.
3. **Enhance admin APIs responses with detailed metadata**.
4. **Enhance admin APIs responses with DAX and mashup expressions** — required for DAX/M in scan results.

Entra: an app that calls read-only admin APIs **must not** have any admin-consent-required Power BI permissions of type Application ([Microsoft docs](https://learn.microsoft.com/en-us/fabric/admin/enable-service-principal-admin-apis#how-to-check-if-your-app-has-admin-consent-required-permissions)). This app has `Tenant.Read.All` with admin consent, which is a likely cause of the 401 together with setting 2. Either remove it from this app or use a separate app for the Scanner. Delegated `Dataset.*` permissions do **not** apply to client-credentials scripts.

## Run

```bash
python scripts/harvest_powerbi_schema.py --output-dir ./powerbi-estate
```

Output example: `powerbi-estate/20261110T123000Z-schema/semantic_schema/{workspaceId}/{Model}_{id}.schema.json`

Each file includes:

- `tables[]` — `columns`, `measures` (measure `expression` is DAX when expressions are enabled)
- `expressions[]` — dataset-level DAX/M when enabled
- `relationships[]` — may be empty (known API limitation)

## If you get HTTP 401

Admin Scanner is not enabled for your SP yet. Catalog + datasources still work; schema harvest will fail until IT completes the checklist above.

## Per-model TMDL via Fabric `getDefinition` (works without Scanner)

```bash
python scripts/fetch_powerbi_model_definition.py --workspace-id <ws> --model-id <model>
```

Calls `POST https://api.fabric.microsoft.com/v1/workspaces/{ws}/semanticModels/{id}/getDefinition?format=TMDL` with the same service principal (Fabric token scope). Works today on workspaces the SP can reach, even though the admin Scanner returns 401. Output goes to `powerbi-estate/definitions/{modelId}/` and contains every table, column, measure (DAX), partition source (Power Query M, including `Databricks.Catalogs` + native SQL), relationships, and RLS roles.

Embedded tables in M can contain personal data (for example owner email lists for RLS); keep output out of git.

## Per-report visuals via Fabric `getDefinition` (PBIR)

```bash
python scripts/fetch_powerbi_report_definition.py --workspace-id <ws> --report-id <report>
```

Calls `POST https://api.fabric.microsoft.com/v1/workspaces/{ws}/reports/{id}/getDefinition`. Output goes to `powerbi-estate/report-definitions/{reportId}/`. For PBIR reports, each `definition/pages/{page}/visuals/{visual}/visual.json` holds the visual type, the fields it uses (measures, grouping columns, date hierarchy level), and its filters. Visual and page filters can carry business logic that is not in the model, such as an extra vessel exclusion list.

Verified on `CII SDK-2026` (report `820023a2-…`): 136 parts, 17 pages.

## Power BI numbers via Execute Queries (DAX)

```bash
python scripts/run_powerbi_dax_query.py --workspace-id <ws> --model-id <model> --query "EVALUATE {1}"
```

Calls `POST https://api.powerbi.com/v1.0/myorg/groups/{ws}/datasets/{id}/executeQueries`. The script only accepts queries that start with `EVALUATE` or `DEFINE`. On PowerShell, avoid double quotes inside the DAX or escape them.

Tested with the existing service principal:

| Model | RLS roles | Result |
|-------|-----------|--------|
| Available Data Sources (`32b49837-…`) | none | Works |
| CII SDK-2026 (`3ba1095b-…`) | `Owner & TSI RLS` | HTTP 401 `PowerBINotAuthorizedException` |
| CII SDK-2025 (`1e76560b-…`) | `Owner & TSI RLS` | HTTP 401 `PowerBINotAuthorizedException` |

The 401 on both CII models fits the documented limit that a service principal cannot query a model with RLS through this API. For those models, parity numbers need a user identity or values exported from the report.

### Models without RLS

The harvested model detail has `isEffectiveIdentityRolesRequired`. Of 503 models, 56 have RLS and 447 do not; 211 of the 447 read from Databricks. List: `powerbi-estate/no_rls_models.csv` (Databricks first, then by report count).

The service principal can query the no-RLS ones. Example: model **CII** (`ee56d7f5-b4fe-4c11-a6b7-403d6c6d0c66`, Embedded PBI Portal) is a separate CII implementation from CII SDK-2026. It reads `REPORTING_LAYER.EMS.CONSUMPTION_LOG` (not the Enerva table) and computes `AER 2026 = SUM(Co2)·10^6 / (MAX(DWT) · SUM(distance))`. `powerbi-estate/dax/cii_model_2026_by_vessel.dax` returned 784 vessel rows, 502 with an AER. Note: 273 vessels with no 2026 data still get rating "E", because the DAX falls through to "E" when the value is blank.

### User identity (RLS models)

Workspace admins, members and contributors are not filtered by RLS. Ways to query as a user, as tried on 2026-11-10:

| Method | Result |
|--------|--------|
| Azure CLI token (`az account get-access-token --resource https://analysis.windows.net/powerbi/api`) | HTTP 401 with empty body, even on `GET datasets/{id}`. The token's only scope is `user_impersonation`; the Power BI REST API needs scopes like `Dataset.Read.All`. Not usable. |
| `run_powerbi_dax_query.py --auth device` (MSAL device code on `PBI_CLIENT_ID`) | Code issued, sign-in not completed. Also needs "Allow public client flows" on the app registration. |
| `scripts/run_powerbi_dax_query_user.ps1` (`MicrosoftPowerBIMgmt.Profile`, browser sign-in) | Needs a terminal with a window. Run it from your own terminal, not an agent shell (agent shell fails with "A window handle must be configured"). |

```powershell
Install-Module MicrosoftPowerBIMgmt.Profile -Scope CurrentUser
.\scripts\run_powerbi_dax_query_user.ps1 -WorkspaceId <ws> -ModelId <model> `
    -QueryFile .\powerbi-estate\dax\cii_2026_vessel_month.dax -Output .\powerbi-estate\dax\cii_2026_vessel_month.json
```

Query files and outputs go under `powerbi-estate/dax/` (gitignored; may hold vessel-level business data).

### Parity harness (CII model, no RLS)

```bash
node scripts/compare_cii_pbi_databricks.mjs
```

Uses `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`, `DATABRICKS_HOST`, and `DATABRICKS_HTTP_PATH` from `.env` (same pattern as `scripts/test-databricks-creds.mjs`). SQL: `powerbi-estate/sql/cii_model_aer_2026_by_vessel.sql`. Oracle: `powerbi-estate/dax/cii_model_2026_by_vessel.json`. Summary: `powerbi-estate/dax/cii_model_2026_parity_summary.json`.

Decode embedded lookups from TMDL:

```bash
python scripts/extract_pbi_embedded_table.py powerbi-estate/definitions/ee56d7f5-.../tables/Vessel_All_Dwts.tmdl \
  --output powerbi-estate/lookups/cii_vessel_all_dwts.csv
```

`compare_cii_pbi_databricks.mjs` injects that CSV into the SQL as a `VALUES` CTE (`COALESCE(Vessel_All_Dwts, IMO_MASTER_LIST)` DWT, same as **Vessel Details - Final**).

Parity (2026-11-10): with embedded DWT, **494 / 501 (98.6%)** vessel-level AER 2026 values matched within ~1% / 0.05 abs (502 Power BI rows with AER; 548 SQL rows). Before embedded DWT: 288 / 313 (92%).

## Alternatives (not in these scripts)

- **XMLA read** on Premium/Fabric capacity — full TMSL; needs XMLA endpoint and Build permission.
