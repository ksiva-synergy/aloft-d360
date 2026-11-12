# Databricks authentication and usage in ALOFT D360

This document explains **why** the platform uses a Databricks **service principal** (OAuth M2M), **where** credentials and connections are stored, and **every major code path** that talks to the SQL warehouse.

For provider endpoints and env var names at a glance, see also [external-apis-and-providers.md](./external-apis-and-providers.md) §4.1. For the SQL safety model, see [ARCHITECTURE.md](../ARCHITECTURE.md) (Databricks execution chokepoint).

**Maintained against:** `src/lib/databricks/*`, `PlatformDatabricksConnection`, and call sites as of the repo snapshot that introduced this file.

---

## 1. Why a service principal?

ALOFT is a **server-side** application. It must run SQL when:

- A user chats in **Inspector** (`execute_tool`)
- **Dashboards** and **semantic metrics** load widget data
- The **Data Estate** harvester inventories and profiles tables (T0–T3 jobs)
- **Metric views** apply DDL on the warehouse

None of these can rely on an interactive Databricks login in the browser.

| Identity | Purpose |
|----------|---------|
| **Azure Entra ID** (NextAuth) | Which **human** can use ALOFT |
| **Databricks service principal** (`CLIENT_ID` + `CLIENT_SECRET`) | Which **machine identity** ALOFT uses against Databricks |
| **`PlatformDatabricksConnection`** row | **Which workspace and SQL warehouse** that org uses |

The app does **not** implement personal access token (`dapi…`) auth. All warehouse access goes through **OAuth client credentials** in `src/lib/databricks/token-client.ts`.

---

## 2. Authentication flow

```text
PlatformDatabricksConnection (Postgres)
  workspace_host, default_warehouse_id, secret_ref
        │
        ▼
openDatabricksSession(conn, role)   (or getAccessToken(connectionId, workspaceHost, role))
  0. Role has a row in platform_databricks_credentials (or DATABRICKS_SP_<ROLE>_* env)?
       yes → role credential: cache (connectionId:role) → env → SM aloft/databricks/{id}/{role}
       no  → default credential below (error instead if role is in DATABRICKS_SP_REQUIRED_ROLES)
  1. In-process token cache (per connectionId)
  2. If DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET are set → use env (local dev)
  3. Else readCredentials(connectionId) from AWS Secrets Manager
        │
        ▼
POST https://{host}/oidc/v1/token
  Authorization: Basic base64(client_id:client_secret)
  grant_type=client_credentials&scope=all-apis
        │
        ▼
Bearer access token (short-lived, cached ~60s before expiry)
        │
        ▼
POST https://{host}/api/2.0/sql/statements
  executeDatabricksSQL() or executeDatabricksDDL()
```

### 2.1 Environment variables

| Variable | Role |
|----------|------|
| `DATABRICKS_CLIENT_ID` | Service principal application (client) ID |
| `DATABRICKS_CLIENT_SECRET` | OAuth secret for that SP |
| `DATABRICKS_HOST` | Workspace hostname (harvester ECS; reference for ops) |
| `DATABRICKS_HTTP_PATH` | Warehouse HTTP path (harvester ECS) |
| `DATABRICKS_WORKSPACE_ID` | Workspace id (reference; not used on the main token/SQL path) |
| `DATABRICKS_MAX_ROWS` | Max rows per query (default 1000, cap 10000) — `execute.ts` |
| `DATABRICKS_MAX_WAIT_SECS` | Client-side wait tuning — `execute.ts` |
| `DATABRICKS_SP_REQUIRED_ROLES` | Roles that must use their own SP (comma list or `all`); unset = every role may fall back to the default SP (§7.1) |
| `DATABRICKS_SP_<ROLE>_CLIENT_ID` / `_CLIENT_SECRET` | Local dev only: a role's SP for every connection, e.g. `DATABRICKS_SP_PROFILE_CLIENT_ID` |

Local development typically sets `CLIENT_ID` / `CLIENT_SECRET` in `.env` and `.env.local`. **Never commit real secrets.**

### 2.2 Production secrets

| Store | Path / key | Contents |
|-------|------------|----------|
| AWS Secrets Manager (per connection) | `aloft/databricks/{connectionId}` | JSON `{ "client_id", "client_secret" }` |
| AWS Secrets Manager (per role) | `aloft/databricks/{connectionId}/{role}` | Same JSON, one SP per role (§7.1) |
| Postgres | `platform_databricks_credentials` | Role, `secret_ref`, optional `warehouse_id`, test status — never the secret |
| AWS Secrets Manager (harvester task) | `aloft/databricks` | Keys listed in `infra/context/task-definition.json` |
| Postgres | `platform_databricks_connections.secret_ref` | Pointer to SM secret name only — not the secret value |

Connection CRUD writes SP credentials via `src/lib/databricks/secrets.ts` when creating or rotating a connection through the API.

### 2.3 Database model

`PlatformDatabricksConnection` (`prisma/schema.prisma`):

- `workspace_host`, `default_warehouse_id`, `default_warehouse_http_path`
- `auth_type` (default `oauth_m2m`)
- `secret_ref`, `status`, `last_tested_at`
- Scoped by `org_id`

---

## 3. Core library (single front door for SQL)

All read-only warehouse SQL should go through **`executeDatabricksSQL`** in `src/lib/databricks/execute.ts`. DDL for metric views uses **`executeDatabricksDDL`** in the same module.

| File | Responsibility |
|------|----------------|
| `token-client.ts` | OAuth token acquisition and cache; env vs SM credential resolution |
| `secrets.ts` | Read/write SP JSON in AWS Secrets Manager |
| `connections.ts` | Org-scoped connection CRUD in Postgres |
| `execute.ts` | Statement Execution API, read-only enforcement, row/byte limits, async polling |
| `test-connection.ts` | Token + `SELECT 1`; updates connection `status` |
| `tool-registration.ts` | Mirror connection → `tool_catalog` for Inspector/agents |

**Rule for contributors:** Do not call the Databricks Statement API directly from feature code. Use `executeDatabricksSQL` or `executeSemanticQuery` (which calls it).

---

## 4. HTTP API routes

### 4.1 Connection management

| Method | Path | Purpose |
|--------|------|---------|
| GET, POST | `/api/databricks/connections` | List / create connection (+ store creds in SM) |
| GET, PATCH, DELETE | `/api/databricks/connections/[id]` | CRUD; PATCH can rotate creds and evict token cache |
| POST | `/api/databricks/connections/[id]/test` | Health check (`SELECT 1`) |
| POST | `/api/databricks/connections/[id]/execute` | Read-only SQL (thin HTTP adapter over `execute.ts`) |
| GET | `/api/databricks/connections/[id]/tool` | Tool catalog entry for this connection |

**Easiest connectivity check:** `POST .../connections/{id}/test` while logged in (or with a valid session cookie).

### 4.2 Inspector (Build)

| Route | Uses live warehouse? | Why |
|-------|----------------------|-----|
| `POST /api/inspector/chat` | Yes | Agent `execute_tool` → `getAccessToken` + `executeDatabricksSQL` |
| `POST /api/inspector/teach` | Yes | `verify_claim` → `executeSemanticQuery` |
| `POST /api/inspector/charts` | Yes | Chart pipeline / semantic execution |
| `GET /api/inspector/dashboards/[dashboardId]/data` | Yes | Widget data (semantic + optional raw SQL) |
| `GET /api/inspector/semantic/[modelId]/authoring-preview` | Yes | Preview compiled semantic SQL |
| `GET /api/inspector/semantic/entities-catalog` | No (metadata from Aurora) | Governed catalog; live DISTINCT reads are documented as on-demand elsewhere |

Inspector resolves **`connection_id`** from the active **`tool_catalog`** entry (e.g. `synergy_dwh`) in the chat and teach routes.

### 4.3 Data Estate (context / harvest)

Routes under `/api/agent-lab/context/*` use `getOrgId()` from `connections.ts` and/or **`DatabricksAdapter`** (`src/lib/context/databricks-adapter.ts`), which calls `getAccessToken` and `executeDatabricksSQL`.

Examples:

- `.../context/sources*` — sources tied to a connection
- `.../context/jobs/*` — plan, launch, trigger harvest jobs
- `.../context/estate/*` — harvest, facets, schedule, sync-knowledge, scan-coverage, preview-columns

---

## 5. Feature modules and call graph

### 5.1 Inspector tools (`src/lib/inspector/tools.ts`)

| Tool | Live Databricks? | Notes |
|------|------------------|-------|
| `execute_tool` | **Yes** | Read-only SQL via chokepoint |
| `emit_chart` | **Yes** | Via semantic/chart execution |
| `describe_schema` | **No** | Harvested metadata in Aurora only (`src/lib/context/dispatch.ts` → `describe.ts`) |

Prompts and reflect-mode allowlists live in `prompts.ts` and `reflect-tools.ts`. Teach verification uses `executeSemanticQuery`, not raw SQL.

### 5.2 Semantic layer

| Module | Uses SP? | Purpose |
|--------|----------|---------|
| `src/lib/semantic/execute.ts` | Yes | `executeSemanticQuery` — compile model → SQL → `executeDatabricksSQL` |
| `src/lib/semantic/metric-views.ts` | Yes | `applyMetricViews` — DDL via `executeDatabricksDDL` |
| `src/lib/semantic/context-builder.ts` | Metadata only | Connection lookup for context building |
| `src/lib/semantic/lineage.ts` | Metadata | Lineage graph; execution when callers run queries |

Consumers: chart pipeline, dashboards, authoring preview, reflect `verify_claim`.

### 5.3 Dashboards

| Module | Purpose |
|--------|---------|
| `src/lib/dashboards/execute-raw-sql.ts` | Raw SQL widgets → same chokepoint |
| `src/lib/dashboards/widget-preview.ts` | Builder preview (semantic or raw) |

### 5.4 Data Estate pipeline

| Module | Purpose |
|--------|---------|
| `src/lib/context/databricks-adapter.ts` | Primary SQL for structural harvest, profiling, samples |
| `src/lib/context/harvest.ts` | Job orchestration using adapter |
| `src/lib/context/estate.ts` | Estate inventory |
| `src/lib/context/knowledge-sync.ts` | Sync steps requiring live reads |
| `src/lib/context/usage.ts` | T3 usage history from warehouse |

**Aurora-only (no `executeDatabricksSQL`):** `embed.ts`, `enrich.ts`, `mapping.ts`, `silo.ts`, and the core `describe.ts` read path used by `describe_schema`.

### 5.5 Background jobs

| Location | Purpose |
|----------|---------|
| `scripts/context/orchestrator.ts` | CLI harvest orchestration |
| `infra/context/task-definition.json` | ECS context harvester env from `aloft/databricks` secret |
| `infra/context/deploy-notes.md` | Deploy and SM layout |

---

## 6. UI (indirect)

The browser never holds Databricks credentials.

| UI | Behavior |
|----|----------|
| `src/components/inspector/InspectorShell.tsx` | `GET /api/databricks/connections` — treats any `status === 'active'` as healthy |
| Estate / mapper / catalog pages | Call context APIs that may trigger harvest or SQL |
| Dashboard builder / viewer | Calls dashboard data APIs |

There is no dedicated “Test Connections” page in the nav; use the test API or connection status from the list endpoint.

---

## 7. Creating and validating a service principal

1. In the Databricks **account console** (or workspace admin UI), create or select a **service principal**.
2. Generate an **OAuth secret**; copy **Client ID** and **secret** (secret shown once).
3. Grant the SP access to the **workspace**, the **SQL warehouse**, and required **Unity Catalog** privileges.
4. In local `.env` / `.env.local`:

   ```env
   DATABRICKS_CLIENT_ID=<application-client-id>
   DATABRICKS_CLIENT_SECRET=<oauth-secret>
   DATABRICKS_HOST=<workspace-host-without-https>
   DATABRICKS_HTTP_PATH="/sql/1.0/warehouses/<warehouse-id>"
   ```

5. Ensure a row exists in `platform_databricks_connections` for your org (via POST `/api/databricks/connections` or seed/migration).
6. Run **`POST /api/databricks/connections/{id}/test`** → expect `{ "success": true, "status": "active" }`.
7. Ensure **`tool_catalog`** has an entry with `config.connection_id` pointing at that connection for Inspector.

**Common failure:** `401 invalid_client` on `/oidc/v1/token` — wrong or expired secret, or client ID does not match the SP that owns the secret.

### 7.1 Separate service principals per role

Every warehouse call names a role (`src/lib/databricks/sp-roles.ts`). A role without its own SP uses the connection's default SP above. Design and the role-to-code map: `docs/access/data-access-architecture.md` §9.

| Role | Grants it needs (UC admin runs these; privilege names to confirm) |
|---|---|
| `query_internal` | `USE CATALOG` / `USE SCHEMA` / `SELECT` on the data users query. Until ALOFT has labels, the same data the default SP reads |
| `query_confidential`, `query_restricted` | Not used by code yet; create when Phase 1 labels ship |
| `metadata` | `USE CATALOG`, `USE SCHEMA`, `BROWSE` on harvested catalogs; `SELECT` on `system.query.history`, `system.access.table_lineage`, `system.access.column_lineage`. No `SELECT` on business tables |
| `profile` | `USE CATALOG`, `USE SCHEMA`, `SELECT` on schemas approved for profiling, excluding Restricted |
| `publish` | `USE CATALOG`, `USE SCHEMA`, `CREATE TABLE` on the metric-view schema only; `SELECT` on the source tables |

Each role SP also needs workspace access and `CAN USE` on its warehouse.

Example for the UC admin (ALOFT never runs `GRANT`):

```sql
GRANT USE CATALOG, BROWSE ON CATALOG <catalog> TO `<metadata-sp-application-id>`;
GRANT USE SCHEMA ON SCHEMA system.query TO `<metadata-sp-application-id>`;
GRANT SELECT ON TABLE system.query.history TO `<metadata-sp-application-id>`;
```

Steps, one role at a time:

1. Apply `prisma/migrations/20261105_databricks_sp_roles/migration.sql` once (`prisma db execute`, then `prisma migrate resolve --applied 20261105_databricks_sp_roles`).
2. Create the SP, its OAuth secret and its grants in Databricks.
3. `PUT /api/databricks/connections/{id}/credentials/{role}` with `{ "client_id", "client_secret", "warehouse_id"? }` (platform admin). The secret goes to Secrets Manager at `aloft/databricks/{id}/{role}`; Postgres keeps only the name.
4. `POST /api/databricks/connections/{id}/credentials/{role}/test` → expect `"status": "active"`. This tests the role's own SP, never the fallback.
5. Run the real workload (a harvest for `metadata` / `profile`, an Inspector question for `query_internal`, a metric-view publish for `publish`) and watch for permission errors.
6. Add the role to `DATABRICKS_SP_REQUIRED_ROLES` (web app and harvester task) so it can no longer fall back. When every role is done, set it to `all` and remove business-data `SELECT` from the default SP.

To undo a role: `DELETE /api/databricks/connections/{id}/credentials/{role}` marks it `disabled`; the role falls back to the default SP within 60 seconds on every instance (binding cache TTL).

The harvester task reads role secrets from Secrets Manager through its task role (`aloftEcsTaskRole`); `infra/context/secrets-policy.json` allows `aloft/*`. Confirm that policy is attached before step 3 for `metadata` or `profile`.

---

## 8. Onboarding checklist

- [ ] Service principal created with warehouse + catalog grants  
- [ ] `DATABRICKS_CLIENT_ID` and `DATABRICKS_CLIENT_SECRET` set (local) or in SM (prod)  
- [ ] `PlatformDatabricksConnection` row with correct `workspace_host` and `default_warehouse_id`  
- [ ] Connection test returns `active`  
- [ ] Inspector tool catalog links `connection_id`  
- [ ] Optional: run a harmless `execute_tool` or dashboard widget to confirm end-to-end SQL  

---

## 9. Related documentation

| Document | Topic |
|----------|--------|
| [external-apis-and-providers.md](./external-apis-and-providers.md) | Provider table, env vars, health summary |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Platform overview, API route index, chokepoint rule |
| [ARCHITECTURE-FULL.md](../ARCHITECTURE-FULL.md) | Module depth, Data Estate + connections |
| [AI-AGENT-MEMORY.md](./AI-AGENT-MEMORY.md) | Inspector tool flow and SQL caps |

---

**Owner:** ALOFT Platform Team  
**Source of truth for behavior:** `src/lib/databricks/*` and call sites listed above
