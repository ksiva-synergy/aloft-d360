# Jobs / harvest — session log

**Purpose:** Running log of agent and engineer sessions that touch the harvest job pipeline.  
**Newest first.** See [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md).

---

### 2026-10-26 — Prisma pool: slim jobs summary poll + batched coverage (Cursor)

- **Issues:** P2024 on `/jobs/summary`, `/estate/facets` under load (10-connection pool, 6 parallel coverage queries + `getDefaultOrg` per request).
- **Files:** `connections.ts`, `reads.ts`, `jobs/summary/route.ts`, `useCatalogRefresh.ts`, `jobs.tsx`, `CHANGELOG.md`.
- **Before → after:** Pollers use `?coverage=false`; coverage SQL batched at 3; `getOrgId` uses env id when set.
- **Verified:** Code review; restart `dev:api` and exercise Estate catalog + Jobs.
- **Not done:** Production deploy.

---

### 2026-10-26 — Catalog Run pipeline now (Cursor)

- **Issues:** Catalog had schedule-only at schema scope; no one-click T0→T1→T2.
- **Files:** `catalog-pipeline.ts`, `BulkActionBar.tsx`, `EstateCatalogTab.tsx`, tests, `CHANGELOG.md`.
- **Before → after:** Pick catalog/schema in tree → **Run pipeline now** launches sequential harvest with Limit glob; **Schedule all** still marks discovery rows only.
- **Verified:** vitest `catalog-pipeline.test.ts`.
- **Not done:** Web deploy.

---

### 2026-10-26 — Pipeline scope batch: T1/T2 excludes, embed, T3, launch gates (Cursor)

- **Issues:** P0-1 (change_detect), P1-2, P1-6, P1-3/4/18, exclude-only T0 launch blocked when discovery 0 for kept schemas.
- **Files:** `job-scope.ts`, `job-ui.ts`, `launch-kinds.ts`, `queue.ts`, `jobs/plan`, `jobs/launch`, `orchestrator.ts`, `usage.ts`, `jobs.tsx`, tests, `CHANGELOG.md`, `current-status.md`.
- **Before → after:** Excludes flow through T1/T2 plan/launch; embed/T3 respect excludes; T0 can launch on live Databricks listing for narrowed exclude scope; unimplemented kinds blocked at launch API.
- **Verified:** vitest job-ui + job-scope.
- **Not done:** Harvester image deploy; Phase 2 UI; P0-7 T3 match quality.

---

### 2026-10-26 — T0 exclude-only scope uses resolveScope (Cursor)

- **Issues:** User excluded most schemas, kept few — T0 did not harvest successfully (0 / delta).
- **Files:** `harvest.ts`, `jobs.tsx`, `CHANGELOG.md`
- **Before → after:** Job-scoped `excludeSchemas` forces full listing of non-excluded schemas.
- **Verified:** Logic review; **Fargate needs new harvester image** for this fix.
- **Not done:** None.

---

### 2026-10-26 — Estate pipeline hardening batch (Cursor)

- **Issues:** Silent plan API failures; scan-coverage org-wide counts; catalog list not scoped by source.
- **Files:** `jobs.tsx`, `estate-source-sql.ts`, `queue.ts`, `reads.ts`, `estate/route.ts`, `scan-coverage/route.ts`, `EstateCatalogTab.tsx`, `EstateFacetTree.tsx`, `EstateTable.tsx`, tests, `schema.prisma`, `CHANGELOG.md`
- **Before → after:** Plan errors visible; regression tests for estate `source_id` SQL; estate browse/scan use selected source.
- **Verified:** vitest on plan-estate-split + job-ui tests.
- **Not done:** Manual multi-source estate picker UI.

---

### 2026-10-26 — verify-estate-1 DB check + planEstateSplit source_id (Cursor)

- **Issues:** User reported estate data missing; plan showed "—" for Limit.
- **Files:** `queue.ts`, `estate-db-audit.ts` (run), `CHANGELOG.md`
- **Findings:** Source `b491f1d6-…` has **22,239** active estate rows including **1,812** in `curated_db`; Limit glob matches **123** tables in `db_smac_prod_navitasai_masters_crewing`. Plan failed due to `source_id = $2::uuid` on text column.
- **Verified:** `planForKind` → 123 objects after fix.
- **Not done:** Deploy web with fix.

---

### 2026-10-26 — T0 Limit when catalog missing from discovery (Cursor)

- **Issues:** User Limit `curated_db…*` showed no discovery count and blocked Fargate launch; catalog not in 14-catalog tree.
- **Files:** `job-ui.ts`, `jobs/plan/route.ts`, `jobs/launch/route.ts`, `job-scope.ts`, `queue.ts`, `jobs.tsx`, tests, `CHANGELOG.md`
- **Before → after:** T0+Limit with 0 local discovery rows → `liveScopeLaunch`, launch allowed, UI “Databricks at run”; glob matching aligned for schema-prefix patterns; plan refetch on Limit change.
- **Verified:** `npx vitest run src/lib/estate/job-ui.test.ts src/lib/context/job-scope.test.ts`
- **Not done:** Pre-run Databricks count in plan API.

---

### 2026-10-26 — Jobs UI text contrast (Claude Code)

- **Issues:** Run Job dropdown labels hard to read (user screenshot)
- **Files:** `jobs.tsx` (UI colors only; no pipeline behavior change)
- **Before → after:** Run Job / Review buttons use `var(--on-brand)` instead of `inkOf('#FFFFFF')`; selected job label, kind/status badges and other pastel accent text wrapped in `inkOf()`.
- **Verified:** `npx tsc --noEmit` clean for the file
- **Not done:** Browser check in light and dark themes

---

### 2026-10-26 — Limit vs exclude tree UX fix (Cursor)

- **Issues:** P1-20, P2-16
- **Files:** `job-ui.ts`, `jobs/plan/route.ts`, `jobs/launch/route.ts`, `jobs.tsx`, `job-ui.test.ts`, `CHANGELOG.md`
- **Before → after:** Limit + excludes no longer zero scope; headline count follows plan when Limit is set; copy explains exclude tree ignored.
- **Verified:** `npx vitest run src/lib/estate/job-ui.test.ts`
- **Not done:** Phase 2 include-first tree.

---

### 2026-10-26 — Phase 1 gaps (inventory, multi-source, T1, knowledge_sync) (Cursor)

- **Issues:** P1-11, P1-14, P1-19, T1 stale-only default
- **Files:** `resolve-launch-source.ts`, `estate.ts`, `harvest.ts`, `knowledge-sync.ts`, `orchestrator.ts`, `jobs/plan|launch/route.ts`, `estate/sync-knowledge/route.ts`, `jobs/trigger/route.ts`, `jobs.tsx`, `current-status.md`
- **Before → after:** Inventory honors Limit/excludes; plan/launch accept `sourceId` with modal picker; T1 skips fresh profiles unless T0 newer; knowledge_sync runs lib + launches worker from estate sync route.
- **Verified:** `npx vitest run src/lib/context/job-scope.test.ts src/lib/estate/job-ui.test.ts`
- **Not done:** Phase 2 wizard; `mapping` stub; T1 `forceReprofile` UI toggle.

---

### 2026-10-26 — Phase 0/1 remainder (Cursor)

- **Issues:** P0-1 (entry points), P0-6, P0-7, P1-4, P1-6, P1-9, P1-15 (scoped debounce), P1-3 (t3_connected fail loud)
- **Files:** `enqueue-and-launch.ts`, `estate/harvest/route.ts`, `objects/[id]/refresh|enrich/route.ts`, `jobs/trigger/route.ts`, `usage.ts`, `job-scope.ts`, `orchestrator.ts`, `job-ui.ts`, `HarvestActionBar.tsx`, `HeroSection.tsx`, tests, `current-status.md`
- **Before → after:** Object/estate enqueue paths set Limit globs + launch worker; trigger launches Fargate/local worker; T3 matches `catalog.schema.table`; sequential chain advances on `partial`; stub kinds fail not succeed; T1/T2-only modal hides exclude tree; per-table debounce when scope overlaps.
- **Verified:** `npx vitest run src/lib/context/job-scope.test.ts src/lib/estate/job-ui.test.ts`
- **Not done:** Phase 2 wizard; P1-11 inventory Focus; P1-14 multi-source plan; `knowledge_sync` lib wiring; T1 stale-only skip.

---

### 2026-10-26 — Phase 0 estate jobs fixes (Cursor)

- **Issues:** P0-1, P0-2, P0-3, P0-4, P0-5, P0-8, P0-9, P1-1, P1-2, P1-3, P1-4, P1-7, P1-8, P1-10, P1-18, P1-20 (copy interim)
- **Files:** `src/lib/context/job-scope.ts`, `job-scope.test.ts`, `queue.ts` (`planEstateSplit`, `planForKind`), `jobs/plan/route.ts`, `jobs/launch/route.ts`, `harvest.ts`, `estate.ts`, `usage.ts`, `scripts/context/orchestrator.ts`, `objects/[id]/reharvest-all/route.ts`, `src/views/agent-lab/estate/jobs.tsx`, `docs/jobs/current-status.md`
- **Before → after:** T0 launch blocked when Scanned=0 but discovery>0 → Launch enabled with discovery-based plan; duplicate T0/inventory job rows → orchestrator reuses claimed id; object reharvest parallel tiers → T0 chains T1→T2 with table glob; embed/T3 respect Limit globs; modal labels Discovery vs Scanned; stub kinds removed from launch picker.
- **Verified:** `npx vitest run src/lib/context/job-scope.test.ts src/lib/estate/job-ui.test.ts` (pass)
- **Not done:** P0-6 chain on partial; P0-7 qualified T3 match; P1-9 trigger→worker; Phase 2 wizard; estate harvest/refresh/enrich routes still need `resolveJobScope` (P0-1 remainder); integration test on real DB.

---

## Entry template (copy for each session)

```markdown
### YYYY-MM-DD — <short title> (<Cursor|Claude|Human>)

- **Issues:** P0-3, … (or “docs only”)
- **Files:** `path/a`, `path/b`
- **Before → after:** …
- **Verified:** …
- **Not done:** …
```

---

### 2026-10-24 — Versioning + incremental policy doc (Cursor)

- **Issues:** Product rule from user — incremental OK when keeping versions; aligned docs with T1/T2 append-only tables.
- **Files:** `docs/jobs/versioning-and-incremental.md`; updates to `current-status.md`, `schema-harvest-guide.md`, `AGENT_INSTRUCTIONS.md`, `README.md`; `docs/CHANGELOG.md`.
- **Before → after:** Incremental guidance now explicit: T1/T2 version on re-run; T0 delta without structural version chain; overwrite toggles target new versions.
- **Verified:** `profile.ts` / `enrich.ts` `persistCard` version increment; prisma `platform_context_profiles`, `platform_context_semantics`.
- **Not done:** T1 stale-only skip; T0 structural snapshots; job stats showing version counts in UI.

---

### 2026-10-24 — Jobs docs pack + agent logging rules (Cursor)

- **Issues:** Documentation for P0-3, schema harvest, incremental policy; no code fixes yet.
- **Files:** `docs/jobs/README.md`, `current-status.md`, `schema-harvest-guide.md`, `AGENT_INSTRUCTIONS.md`, `session-log.md`; `AGENTS.md`, `CLAUDE.md`; `docs/estate-jobs.md`; `docs/audits/harvest-job-pipeline-remediation-charter.md` (cross-link); `docs/CHANGELOG.md`.
- **Before → after:** Jobs workstream had audits/charter only; now has operator schema guide, full current-status snapshot, and mandatory dual logging (CHANGELOG + this file) for Claude/Cursor.
- **Verified:** Cross-walk issue register ↔ current-status tables; paths exist in repo.
- **Not done:** Phase 0 code (`planEstateSplit`, UI wizard, schema Run button); P0-3 still blocks first T0 in modal.

---

### 2026-10-24 — Remediation charter + audit field report (Cursor)

- **Issues:** P0-3, P1-1, P1-7, P1-20, P2-16; charter phases for all P0–P3.
- **Files:** `docs/audits/harvest-job-pipeline-remediation-charter.md`, `docs/audits/harvest-job-pipeline-issues.md`, `docs/CHANGELOG.md`.
- **Before → after:** Audit expanded with T0 modal field report; charter defines cockpit UX and phased fixes.
- **Verified:** Code touchpoints listed in issues §13.
- **Not done:** Implementation.
