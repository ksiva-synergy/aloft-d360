# Power BI bridge — implementation tracker

**Branch:** `feature/powerbi-bridge`  
**Design:** [`docs/powerbi-harvest-build-plan.md`](../powerbi-harvest-build-plan.md)  
**Inspector positioning:** [`docs/inspector/semantic-layer-and-powerbi.md`](../inspector/semantic-layer-and-powerbi.md)

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
| Apply Phase **1b** migration | **Done (dev)** | `apply-phase1b-migration.mjs` |
| Apply Phase **1c** migration | **Done (dev)** | `apply-phase1c-migration.mjs` |
| Apply Phase **2 domains** migration | **Done (dev)** | `apply-phase2-domains-migration.mjs` |
| Apply Phase **2 families** migration | **Pending operator** | `apply-phase2-families-migration.mjs` |
| Apply Phase **3 oracle** migration | **Done (dev)** | `apply-phase3-oracle-migration.mjs` |
| Apply Phase **3 translate** migration | **Done (dev)** | `apply-phase3-translate-migration.mjs` |
| Apply Phase **3 publish** migration | **Done (dev)** | `apply-phase3-publish-migration.mjs` |
| `npx prisma generate` | **Done** | Client includes `Pbi*` + parsed models after generate |
| Power BI context source | Manual | POST `/api/agent-lab/context/sources` with `connection_kind: "powerbi"`, `connection_ref: <tenant id>`, `scope_include: [<workspace guids>]` |
| PBI env on harvester | Ops | `PBI_TENANT_ID`, `PBI_CLIENT_ID`, `PBI_CLIENT_SECRET` on worker |

## Phase checklist (build plan §13.2)

| Phase | Deliverable | Status |
|-------|-------------|--------|
| 0 | Baseline, IT, stewards | Not started |
| **1** | Schema + `pbi_inventory` + `pbi_definitions` + client/Fabric/raw store | **Done (code)** |
| 1 | `pbi_parse`, parsers, classifier | **Done (code)** — TMDL + §8.5 + legacy report summary; embedded decode/PBIR reader pending |
| 1 | Estate Power BI tab UI | **Done (browse)** — nav + APIs + detail panel |
| 2 | Catalog link | **Done (code)** — `pbi_catalog_link`, object panel |
| 2 | `pbi_domains`, domain filter UI | **Done (code)** — scoring, conflicts, browse filter |
| 2 | `pbi_families` | **Done (code)** — year-variant clustering; apply `apply-phase2-families-migration.mjs` |
| 2 | steward conflict UI | **Done (v1)** — conflicts list + acknowledge (manage) |
| 3 | `pbi_oracle` (pilot DAX snapshots) | **Done (code)** — non-RLS |
| 3 | `pbi_translate` (rule + LLM v1) | **Done (code)** — rule tier; LLM draft SQL via `harvest-llm` (capped) |
| 3 | `pbi_parity` (scalar v1) | **Done (code)** — warehouse SQL vs oracle |
| 3 | `pbi_publish` → `kb_verified_queries` | **Done (code)** — parity pass; Titan embed |
| 3 | Inspector `run_verified_query` retrieval | **Done (code)** — chat prompt + tool |
| 3 | Domain filter on VQ match | Not started |
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
- Phase 1b migration + `pbi_parse`, `tmdl-parse.ts`, `partition-kind.ts`, tests, `powerbi-phase1-implementation-report.md`

## Next (ordered)

1. Run **PBI Inventory** → **Definitions** → **Parse** → **Catalog Link** → **Domains** on dev (migrations 1/1b/1c/phase2 domains applied)
2. Confirm estate **Power BI** tab + object “used by Power BI” after harvest
6. Phase 2+: `pbi_families`, steward review queue
7. Phase 3+: oracle, translate, parity, publish, Inspector

## Files map

| Area | Paths |
|------|--------|
| Schema | `prisma/migrations/20261111_powerbi_bridge_phase1/`, `prisma/schema.prisma` (Pbi*) |
| Runtime | `src/lib/powerbi/*`, `scripts/context/orchestrator.ts` |
| Jobs UI | `src/views/agent-lab/estate/jobs.tsx`, `src/lib/estate/job-ui.ts`, `launch-kinds.ts` |
| APIs | `src/app/api/agent-lab/context/sources/route.ts`, `jobs/launch`, `jobs/trigger` |
