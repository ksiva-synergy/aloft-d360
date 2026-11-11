# Power BI bridge — implementation tracker

**Branch:** `feature/powerbi-bridge`  
**Design:** [`docs/powerbi-harvest-build-plan.md`](../powerbi-harvest-build-plan.md)

## Validation (before / after)

**Guide:** [`docs/powerbi-integration-validation.md`](../powerbi-integration-validation.md)

| When | Action |
|------|--------|
| **Now (Phase 0)** | Snapshot script; **CII boost:** `POST …/boost/run-suite` `{ "suiteVersion": "cii_pilot_v1" }` → `export-cii-boost-baseline.mjs --label before-phase3`; parity script |
| **After Phase 1** | Same script `--label after-phase1`; confirm `pbi_*` counts; **Inspector scores should match before** (no publish yet) |
| **After Phase 3** | Rerun full question bank; track pass rate + `verified_query` path share vs baseline |

## Prerequisites

| Step | Status | Notes |
|------|--------|--------|
| DB backup | **Blocked locally** | Run `node --env-file=.env scripts/backup-postgres.mjs backups` (needs `pg_dump` or Docker Desktop). |
| Apply Phase 1 migration | **Done (dev, 2026-11-11)** | `apply-phase1-migration.mjs` — SQL executed + `migrate resolve` after RDS retry |
| `npx prisma generate` | **Done** | Client includes `Pbi*` models |
| Power BI context source | Manual | POST `/api/agent-lab/context/sources` with `connection_kind: "powerbi"`, `connection_ref: <tenant id>`, `scope_include: [<workspace guids>]` |
| PBI env on harvester | Ops | `PBI_TENANT_ID`, `PBI_CLIENT_ID`, `PBI_CLIENT_SECRET` on worker |

## Phase checklist (build plan §13.2)

| Phase | Deliverable | Status |
|-------|-------------|--------|
| 0 | Baseline, IT, stewards | Not started |
| **1** | Schema + `pbi_inventory` + `pbi_definitions` + client/Fabric/raw store | **In progress** (code on branch) |
| 1 | `pbi_parse`, parsers, Estate Power BI tab UI | Not started |
| 2 | Catalog link, domains, lineage UI | Not started |
| 3 | CII pilot, verified queries, Inspector | Not started |
| 4+ | Finance, scale, RLS | Not started |

## Done on branch (session 2026-11-11)

- `feature/powerbi-bridge` created from `dev`
- `scripts/backup-postgres.mjs`, `backups/README.md`, `.gitignore` for dumps
- Migration `20261111_powerbi_bridge_phase1` — `pbi_workspaces`, `pbi_models`, `pbi_model_datasources`, `pbi_reports`, `pbi_usage`
- Prisma models `PbiWorkspace`, `PbiModel`, `PbiModelDatasource`, `PbiReport`, `PbiUsage`
- `src/lib/powerbi/credentials.ts`, `client.ts`, `inventory.ts`
- Job kinds in `queue.ts`; orchestrator **`pbi_inventory`** implemented; other `pbi_*` stub failed with clear message
- Launch/trigger APIs; Jobs UI group **Power BI**; `connection_kind: powerbi` on sources POST
- Other `pbi_*` kinds disabled in launch modal except **`pbi_definitions`**
- `src/lib/powerbi/fabric.ts`, `raw-store.ts`, `definitions.ts`; `GET /api/agent-lab/powerbi/summary`
- `scripts/powerbi/apply-phase1-migration.mjs`, `run-cii-boost-baseline.ts` (validation deferred)

## Next (ordered)

1. Operator: backup + apply migration + `prisma generate`
2. Register Power BI source; run **PBI Inventory** from Jobs
3. Migration phase 1b: TMDL/report tables (`pbi_tables`, `pbi_measures`, …)
4. `pbi_definitions` + `pbi_parse` jobs
5. Estate **Power BI** nav tab (read APIs)

## Files map

| Area | Paths |
|------|--------|
| Schema | `prisma/migrations/20261111_powerbi_bridge_phase1/`, `prisma/schema.prisma` (Pbi*) |
| Runtime | `src/lib/powerbi/*`, `scripts/context/orchestrator.ts` |
| Jobs UI | `src/views/agent-lab/estate/jobs.tsx`, `src/lib/estate/job-ui.ts`, `launch-kinds.ts` |
| APIs | `src/app/api/agent-lab/context/sources/route.ts`, `jobs/launch`, `jobs/trigger` |
