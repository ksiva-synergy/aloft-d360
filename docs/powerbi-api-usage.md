# Power BI and Fabric API Usage

This document catalogs the external Power BI/Fabric API calls in the application, what invokes them, and what ALOFT keeps from the responses. It distinguishes the inventory/lineage harvest from optional refresh, ownership, and measure-evaluation features.

## Inventory and lineage harvest

The estate-wide lineage chain is `pbi_inventory` → `pbi_definitions` → `pbi_parse` → `pbi_catalog_link`. Inventory calls the Power BI REST API. Definitions calls the Fabric REST API. Parse reads saved definition files locally; Catalog Link resolves parsed sources against already harvested estate objects. Neither Parse nor Catalog Link fetches report rows.

| Step | HTTP method and endpoint | Code | Purpose and retained information |
| --- | --- | --- | --- |
| Authenticate to Power BI | `POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`, scope `https://analysis.windows.net/powerbi/api/.default` | [`client.ts`](../src/lib/powerbi/client.ts) | Client-credentials token for Power BI REST requests. Token is cached in process memory; it is not part of inventory data. |
| Authenticate to Fabric | Same token endpoint, scope `https://api.fabric.microsoft.com/.default` | [`fabric.ts`](../src/lib/powerbi/fabric.ts) | Client-credentials token for Fabric definition requests. |
| List workspaces | `GET https://api.powerbi.com/v1.0/myorg/groups` | [`client.ts`](../src/lib/powerbi/client.ts), [`inventory.ts`](../src/lib/powerbi/inventory.ts) | Workspace ID/name and capacity/tenant workspace metadata where returned. Inventory applies configured scope, except the explicit all-workspaces lineage run. Upserts `pbi_workspaces`. [Microsoft API reference](https://learn.microsoft.com/en-us/rest/api/power-bi/groups/get-groups) |
| List semantic models | `GET https://api.powerbi.com/v1.0/myorg/groups/{workspaceId}/datasets` | [`client.ts`](../src/lib/powerbi/client.ts), [`inventory.ts`](../src/lib/powerbi/inventory.ts) | Model ID/name, description, configured owner, refreshability, storage mode, effective-identity/RLS flags and inventory hash. Upserts `pbi_models`. [Microsoft API reference](https://learn.microsoft.com/en-us/rest/api/power-bi/datasets/get-datasets-in-group) |
| List reports | `GET https://api.powerbi.com/v1.0/myorg/groups/{workspaceId}/reports` | [`client.ts`](../src/lib/powerbi/client.ts), [`inventory.ts`](../src/lib/powerbi/inventory.ts) | Report ID/name/type/format, web URL, dataset ID and inventory hash. Dataset ID links the report to its semantic model. Upserts `pbi_reports`. [Microsoft API reference](https://learn.microsoft.com/en-us/rest/api/power-bi/reports/get-reports-in-group) |
| List model data sources | `GET https://api.powerbi.com/v1.0/myorg/groups/{workspaceId}/datasets/{datasetId}/datasources` | [`client.ts`](../src/lib/powerbi/client.ts), [`inventory.ts`](../src/lib/powerbi/inventory.ts) | Connector type, `connectionDetails` fields such as server/database/path/URL, gateway ID, datasource ID, and the raw datasource response in `pbi_model_datasources`. Inventory/UI redacts secrets when displaying selected fields. Microsoft documents a write-permission limitation for this endpoint; calls can fail independently of basic inventory. [Microsoft API reference](https://learn.microsoft.com/en-us/rest/api/power-bi/datasets/get-datasources-in-group) |
| Get semantic-model definition | `POST https://api.fabric.microsoft.com/v1/workspaces/{workspaceId}/semanticModels/{semanticModelId}/getDefinition?format=TMDL` | [`fabric.ts`](../src/lib/powerbi/fabric.ts), [`definitions.ts`](../src/lib/powerbi/definitions.ts) | TMDL definition parts: tables, columns, measures, relationships, model metadata, and Power Query expressions. Parts are written under `powerbi-estate/definitions/`; `pbi_models.props.definition` records path, hash, part count and fetch run. [Microsoft API reference](https://learn.microsoft.com/en-us/rest/api/fabric/semanticmodel/items/get-semantic-model-definition) |
| Get report definition | `POST https://api.fabric.microsoft.com/v1/workspaces/{workspaceId}/reports/{reportId}/getDefinition[?format=PBIR|PBIR-Legacy]` | [`fabric.ts`](../src/lib/powerbi/fabric.ts), [`definitions.ts`](../src/lib/powerbi/definitions.ts) | PBIR/legacy report parts, including report/page/visual definition files. Parts are written under `powerbi-estate/report-definitions/` (or `report-definitions-legacy/`); `pbi_reports.props.definition` records path, format, hash, part count and fetch run. [Microsoft API reference](https://learn.microsoft.com/en-us/rest/api/fabric/report/items/get-report-definition) |
| Complete an asynchronous definition export | `GET https://api.fabric.microsoft.com/v1/operations/{operationId}` then `GET {operationUrl}/result` | [`fabric.ts`](../src/lib/powerbi/fabric.ts) | `getDefinition` can return `202 Accepted`. The worker honors `Retry-After`, polls for success, then retrieves the definition parts. A 202 alone does not count as a downloaded definition. |

**What Parse derives:** [`parse.ts`](../src/lib/powerbi/parse.ts) reads the saved TMDL and report files. It writes semantic tables, columns, measures, relationships and model expressions to Postgres. For reports it extracts page count and measure references from PBIR visuals or legacy report JSON into `pbi_reports.props.parse`. It does not call Microsoft APIs.

**What Catalog Link derives:** [`catalog-link.ts`](../src/lib/powerbi/catalog-link.ts) reads parsed M/native SQL and existing estate objects to fill Power BI table bindings and optional Unity Catalog paths. It does not call Power BI, Fabric, or SharePoint APIs.

**Lineage assembly and storage:** [`report-lineage-build.ts`](../src/lib/powerbi/report-lineage-build.ts) joins report measure references, parsed DAX/model metadata, M source origins, inventory connections, and optional table bindings. [`report-lineage-store.ts`](../src/lib/powerbi/report-lineage-store.ts) saves the latest report snapshot to `pbi_report_lineage.lineage` after Catalog Link. Original-source paths come from the harvested definition; ALOFT does not call SharePoint, SQL Server, Snowflake or the source system to read their data rows.

## Other Power BI features

These are real provider calls, but are **not required to harvest report/model definitions or build source lineage**.

| HTTP method and endpoint | Code/caller | Purpose and data used |
| --- | --- | --- |
| `GET .../groups/{workspaceId}/datasets/{datasetId}/refreshes?$top=5` | [`client.ts`](../src/lib/powerbi/client.ts), [`oracle.ts`](../src/lib/powerbi/oracle.ts), [`refresh-watch.ts`](../src/lib/powerbi/refresh-watch.ts) | Latest completed refresh time, to check data freshness and verification timing. |
| `GET .../groups/{workspaceId}/datasets/{datasetId}` | [`pbi-ownership.ts`](../src/lib/powerbi/pbi-ownership.ts), model ownership API | Dataset owner, created date, storage mode, refreshable and gateway-required flags. |
| `GET .../groups/{workspaceId}/datasets/{datasetId}/refreshes?$top=10` | [`pbi-ownership.ts`](../src/lib/powerbi/pbi-ownership.ts) | Recent refresh status/times/errors for the ownership/health panel. |
| `GET .../groups/{workspaceId}/datasets/{datasetId}/refreshSchedule` | [`pbi-ownership.ts`](../src/lib/powerbi/pbi-ownership.ts) | Configured refresh schedule. |
| `GET .../groups/{workspaceId}/users` and `GET .../groups/{workspaceId}/datasets/{datasetId}/users` | [`pbi-ownership.ts`](../src/lib/powerbi/pbi-ownership.ts) | Workspace and model access/role information for the ownership panel. |
| `GET .../groups/{workspaceId}/reports` | [`pbi-ownership.ts`](../src/lib/powerbi/pbi-ownership.ts) | Reports associated with a model in the ownership summary; same endpoint as inventory. |
| `POST .../groups/{workspaceId}/datasets/{datasetId}/executeQueries` | [`client.ts`](../src/lib/powerbi/client.ts), [`oracle.ts`](../src/lib/powerbi/oracle.ts), [`decompose-run.ts`](../src/lib/powerbi/decompose-run.ts), freshness and rule-diff probes | Executes read-only DAX and returns JSON results for oracle, freshness, and differential checks. |
| `POST .../groups/{workspaceId}/datasets/{datasetId}/executeDaxQueries` | [`execute-dax.ts`](../src/lib/powerbi/execute-dax.ts), [`oracle.ts`](../src/lib/powerbi/oracle.ts), [`decompose-run.ts`](../src/lib/powerbi/decompose-run.ts), [`sliced-parity.ts`](../src/lib/powerbi/sliced-parity.ts) | Executes DAX and decodes Arrow results; used for RLS/service-principal cases and sliced comparisons where the JSON API is unsuitable. |

All `...` entries above use the Power BI REST root `https://api.powerbi.com/v1.0/myorg`.

## Internal app endpoints

These are ALOFT routes, not Microsoft provider APIs:

| ALOFT endpoint | Purpose |
| --- | --- |
| `POST /api/agent-lab/context/jobs/launch` | Operator-authorized launch of the sequential Inventory → Definitions → Parse → Catalog Link chain. |
| `GET /api/agent-lab/powerbi/reports` | Paginated report list and lineage coverage/snapshot summaries. |
| `GET /api/agent-lab/powerbi/reports/{id}/lineage` | Builds the current report lineage view from harvested Postgres/raw-store metadata. |
| `GET /api/agent-lab/powerbi/models/{id}/sources` | Power Query source-origin details for one model. |
| `GET /api/agent-lab/powerbi/sources/impact` | Reverse-impact lookup over stored lineage snapshots. |

## Scope and limits

- Inventory is metadata, not report or source-system row data.
- Semantic-model and report definitions are separate Fabric exports; one does not contain the other.
- The all-reports lineage chain excludes Oracle, Translate, Parity and Publish.
- Some report/model/source details depend on tenant access, item permissions, definition format and what the APIs return.
- Source paths and connector information can be extracted from Power Query/model definitions even when there is no Unity Catalog binding. Missing information is reported as unknown rather than inferred from unrelated connections.