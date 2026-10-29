# Jobs / harvest — session log

**Purpose:** Running log of agent and engineer sessions that touch the harvest job pipeline.  
**Newest first.** See [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md).

---

### 2026-10-29 — Estate pipeline RBAC (platform admin only)

- **Files:** `src/lib/estate/pipeline-access.ts`, `require-estate-pipeline-operator.ts`, `useEstatePipelineAccess.ts`, Jobs/Catalog UI components, context API launch/continue/harvest/schedule routes, `docs/jobs/current-status.md`, `docs/CHANGELOG.md`.
- **Why:** User request — on Estate, only platform admins run pipelines; everyone else view-only with no triggers.
- **Before → after:** Mutating pipeline APIs return 403 for non–platform-admin; Run Job, Continue, cockpit launch, Active Runs kick/cancel, catalog harvest/schedule/pipeline buttons hidden for other roles.

---

### 2026-10-29 — Scanned tier pill colors match “done” dots

- **Files:** `src/lib/context/reads.ts`, `src/components/estate/ScannedObjectsTab.tsx`, `docs/jobs/current-status.md`, `docs/CHANGELOG.md`.
- **Why:** Header T1/T2/Embed showed gap counts (0) while row dots were filled, so finished processors looked undone.
- **Before → after:** Pills and filters count tables that have that tier. Hollow pill dot when the count is 0. Needs-work stays on facets and Continue.

---

### 2026-10-29 — CI typography guard (estate Jobs UI)

- **Files:** `ActiveRunsPanel.tsx`, `ScannedPipelineScopeBar.tsx`, `ScannedFacetTree.tsx`, `CHANGELOG.md`.
- **Why:** CI failed `typography-guard` (`text-[10px]` ×5); switched to `text-caption`.

---

### 2026-10-28 — Embeddings inactive / T0 drops doc

- **Files:** `embeddings-lifecycle-and-drops.md`, README, `current-status.md`, `redundancy-and-skip-behavior.md`, CHANGELOG.
- **Why:** Explain mass “inactive embedding” behavior (object dropped, search excludes).

---

### 2026-10-28 — Tier timestamps / staleness doc

- **Files:** `tier-timestamps-and-staleness.md`, `README.md`, `current-status.md`, `redundancy-and-skip-behavior.md`, `CHANGELOG.md`.
- **Why:** Document `last_t1_at < last_t0_at` and ladder for understanding.

---

### 2026-10-28 — Efficient pipeline playbook + brainstorm

- **Files:** `efficient-pipeline-playbook.md`, `schema-harvest-guide.md`, `README.md`, `redundancy-and-skip-behavior.md`, `CHANGELOG.md`.
- **Why:** Golden paths and prioritized ideas for non-redundant harvest craft.

---

### 2026-10-28 — Redundancy / stale-skip operator doc

- **Files:** `docs/jobs/redundancy-and-skip-behavior.md` (new), `README.md`, `current-status.md`, `versioning-and-incremental.md`, `CHANGELOG.md`.
- **Why:** Detailed documentation for when tiers skip work vs when orchestration still runs jobs.

---

- **Change:** Wizard enabled unless `NEXT_PUBLIC_JOBS_LAUNCH_WIZARD=false` (`job-ui.ts`, jobs README/current-status).
- **Why:** Product default should not require a secret env to turn on Phase 4 UX.

---

### 2026-10-28 — Phase 4 guided wizard + scope copy (Cursor)

- **Files:** `JobsLaunchWizard.tsx`, `JobsCockpitPanel.tsx`, `jobs.tsx`, `job-ui.ts`, `JobDetailDrawer.tsx`, `ActiveRunsPanel.tsx`; docs.
- **Enable:** set `NEXT_PUBLIC_JOBS_LAUNCH_WIZARD=true` in env and restart dev server.
- **Verified:** tsc.

---

### 2026-10-28 — Active Runs filters + multi Continue (Phase 2–3, Cursor)

- **Files:** `ActiveRunsPanel.tsx`, `jobs.tsx`, `ScannedFacetTree.tsx`, `ScannedObjectsTab.tsx`, `ScannedPipelineScopeBar.tsx`, `pipeline/intent/route.ts`, `pipeline/continue/route.ts`; docs.
- **Verified:** `npx tsc --noEmit`.
- **Not done:** Phase 4 wizard; Phase 0 ECS sign-off.

---

### 2026-10-28 — Phase 0 doc + Phase 1–3 continuation (planned order, Cursor)

- **Issues:** DET-2592 — continue master plan phases 0→3 without Jira updates.
- **Files:** `docs/jobs/phase-0-chain-deploy.md`, `README.md`, `remediation-master-plan.md`; `pipeline-intent.ts`, `cockpit/route.ts`, `plan/route.ts`, `launch/route.ts`, `jobs/kick-queued/route.ts`, `reads.ts` (facets + tier gaps), `ActiveRunsPanel.tsx`, `ScannedPipelineScopeBar.tsx`, `ScannedFacetTree.tsx`, `ScannedObjectsTab.tsx`, `BulkActionBar.tsx`; `CHANGELOG.md`, `session-log.md`, `current-status.md`.
- **Before → after:** Ops have deploy/runbook doc; cockpit and plan honor scoped intent/stale copy; Active Runs is a fuller ops desk; Scanned tree/tiers show **gaps** not only completed tiers; overlap blocks Continue with banner.
- **Verified:** vitest + tsc.
- **Not done:** ECS deploy verification; partial filter for orchestrating; multi-schema Continue; wizard (Phase 4).

```text
[x] docs/jobs/session-log.md updated
[x] docs/CHANGELOG.md updated
[x] docs/jobs/current-status.md updated
```

---

### 2026-10-28 — Pipeline intent, Active Runs, Scanned Continue (Phase 1–2 partial, Cursor)

- **Issues:** DET-2592 implementation start (repo only — no Jira updates).
- **Files:** `src/lib/estate/pipeline-intent.ts`, `src/lib/context/active-jobs.ts`, `src/lib/context/enqueue-and-launch.ts` (`findScopedLaunchConflict`), `src/lib/context/job-scope.ts` (`includePatternsOverlap`), API routes under `context/pipeline/*` and `context/jobs/active`, `jobs/plan`, `jobs/launch`; UI `ActiveRunsPanel`, `ScannedPipelineScopeBar`, `jobs.tsx` tab + queued strip link; tests `pipeline-intent.test.ts`, `job-scope.test.ts`; docs below.
- **Before → after:** Operators can open **Active Runs**, kick queued rows, continue pipeline from Scanned catalog/schema scope; launch rejects overlapping active jobs (409); T1/T2 plan shows stale counts.
- **Verified:** Vitest on intent helpers + pattern overlap; typecheck.
- **Not done:** Harvester deploy (Phase 0); cancel on Active Runs; failed/partial filters; cockpit intent delegation; launch conflict in continue-only path (client calls launch).

```text
[x] docs/jobs/session-log.md updated
[x] docs/CHANGELOG.md updated
[x] docs/jobs/current-status.md updated (behavior)
```

---

### 2026-10-28 — Master remediation plan DET-2592 (Cursor)

- **Issues:** User request — brainstorm and plan to fix all Estate Jobs / ops / pipeline gaps.
- **Files:** `docs/jobs/remediation-master-plan.md` (new), `docs/jobs/README.md`, `docs/jobs/current-status.md`, `docs/CHANGELOG.md`, `session-log.md`.
- **Before → after:** Phases 0–5 (deploy/chain, pipeline intent, Active runs UI, Scanned Continue, wizard, audit remainder), PR bundles A–I, verification matrix, timeline. No code.
- **Verified:** Crosswalk to OPS-1–14, audit §0, scanned-continue + ops docs.
- **Not done:** Execute phases.

---

### 2026-10-28 — Ops console gaps + Active runs vision (Cursor)

- **Issues:** DET-2592 — need one place to see running/failed/stuck harvest jobs; operator asked for gap analysis beyond pipeline UX.
- **Files:** `docs/jobs/ops-console-gaps-and-vision.md` (new), `docs/estate-jobs.md`, `docs/jobs/README.md`, `docs/jobs/current-status.md`, `docs/CHANGELOG.md`, `session-log.md`.
- **Before → after:** Documented today’s monitoring path (Jobs L1→L3, kick/retry/cancel), OPS-1–OPS-14 gap register, proposed **Active runs** tab + `GET jobs/active` sketch, acceptance criteria. No runtime change.
- **Verified:** Cross-check with `jobs/queued`, `JobDetailDrawer`, `ChildJobsPanel`, `listJobsPage` status filter unused in UI.
- **Not done:** Build Active runs UI/API.

```text
[x] docs/jobs/session-log.md updated
[x] docs/CHANGELOG.md updated
```

---

### 2026-10-28 — Scanned Continue pipeline design doc (Cursor)

- **Issues:** DET-2592 / operator need to run T1→T2→embed from Scanned when only T0 complete; tier chips and catalog **Run pipeline now** do not match that flow.
- **Files:** `docs/jobs/scanned-continue-pipeline-design.md` (new), `docs/jobs/README.md`, `docs/jobs/current-status.md`, `docs/CHANGELOG.md`, `session-log.md`.
- **Before → after:** Design captured for pipeline intent API, Scanned UX (Continue vs full pipeline), multi-schema/table selection, reliability guardrails, phased rollout, acceptance criteria. No runtime change.
- **Verified:** Doc review; links from jobs index and current-status §6.
- **Not done:** Implementation (phases 1–6 in design doc).

```text
[x] Read docs/jobs/current-status.md
[x] Identified issue IDs (if any) — UX/planned (DET-2592)
[x] Code/docs change complete
[x] docs/CHANGELOG.md updated
[x] docs/jobs/session-log.md updated
[ ] docs/jobs/current-status.md updated (if behavior changed) — link only, no behavior change
```

---

### 2026-10-27 — Schema Run now stopped after T0 (Cursor)

- **Issues:** Catalog **Run pipeline now** did not continue T0 → T1 → T2 → embed. Operator reported only profile; DB showed T0 succeeded and T1 queued with no `fargate_task_id`.
- **Files:** `catalog-pipeline.ts`, `catalog-pipeline-launch.ts`, `orchestrator.ts`, `queue.ts` (`claimById`), `kick-queued-workers.ts`, `jobs/queued/route.ts`, `EstateCatalogTab.tsx`, `BulkActionBar.tsx`, tests, docs.
- **Before → after:** T0 for `crewing_shore` (40) and `crewing_dashboard_public` (12) succeeded; T1 sat queued because the harvester cannot `RunTask` the next tier. Chain is now T0→T1→T2→embed. Web poller launches orphaned queued jobs; new harvester image continues the chain in-process when `RunTask` fails.
- **Verified:** vitest catalog-pipeline + kick-queued-workers. Chain SQL updated 2 queued T1 rows. Kick launches T1.
- **Not done:** Harvester image deploy. Web process must stay up to launch T2 and embed on the current image.

```text
[x] Read docs/jobs/current-status.md
[x] Identified issue IDs (if any) — chain launch gap; embed omitted from catalog pipeline
[x] Code/docs change complete
[x] docs/CHANGELOG.md updated
[x] docs/jobs/session-log.md updated
[x] docs/jobs/current-status.md updated (if behavior changed)
```

---

### 2026-10-27 — T4 handlers re-implement (Cursor)

- **Issues:** P1-5 T4 stub failures.
- **Files:** `src/lib/context/t4/*`, `scripts/context/t4-handlers.ts`, `orchestrator.ts`, `launch-kinds.ts`, `jobs/trigger`, `jobs.tsx`, docs.
- **Before → after:** T4 scan fans out per schema; entity/dim jobs write sem tables + `last_t4_at`; Jobs can launch `t4_scan`.
- **Verified:** vitest scan-estate grouping.
- **Not done:** Harvester deploy; optional per-schema LLM upgrade.

---

### 2026-10-27 — Cockpit v1 + T3 pushdown + estate link (Cursor)

- **Issues:** Phase 2 cockpit; P2-5 T3; P1-16; P2-15 schedules; ECS scheduled drain.
- **Files:** `cockpit.ts`, `jobs/cockpit/route.ts`, `JobsCockpitPanel.tsx`, `jobs.tsx`, `job-ui.ts`, `job-scope.ts`, `usage.ts`, `databricks-adapter.ts`, `harvest.ts`, `schedules.ts`, `task-definition.json`, docs.
- **Before → after:** Jobs L1 shows pipeline strip + Run recommendation; modal include-tree; T3 scopes warehouse pull; T0 links estate rows; Fargate drains scheduled schemas each loop.
- **Verified:** vitest job-scope + job-ui.
- **Not done:** T4 port; deploy web + harvester + register task def.

---

### 2026-10-27 — Audit register + deploy notes (Cursor)

- **Issues:** Stale `harvest-job-pipeline-issues.md` implied no fixes applied.
- **Files:** `docs/audits/harvest-job-pipeline-issues.md`, `infra/context/deploy-notes.md`, `docs/CHANGELOG.md`, `session-log.md`.
- **Before → after:** §0 status table; launch matrix and orchestrator table match 2026-10-27 behavior; ECS doc for `--process-scheduled`.
- **Verified:** Manual cross-check with codebase paths listed in register.
- **Not done:** Per-issue inline edits in §4–§7 (snapshot in §0 is canonical).

---

### 2026-10-26 — Prisma pool: slim jobs summary poll + batched coverage (Cursor)

- **Issues:** P2024 on `/jobs/summary`, `/estate/facets` under load (10-connection pool, 6 parallel coverage queries + `getDefaultOrg` per request).
- **Files:** `connections.ts`, `reads.ts`, `jobs/summary/route.ts`, `useCatalogRefresh.ts`, `jobs.tsx`, `CHANGELOG.md`.
- **Before → after:** Pollers use `?coverage=false`; coverage SQL batched at 3; `getOrgId` uses env id when set.
- **Verified:** Code review; restart `dev:api` and exercise Estate catalog + Jobs.
- **Not done:** Production deploy.

---

### 2026-10-27 — T3 scope + multi-source launch + process-scheduled (Cursor)

- **Issues:** P0-7/P2-5 T3; P1-14 launch first source only.
- **Files:** `job-scope.ts`, `usage.ts`, `jobs/launch/route.ts`, `orchestrator.ts`, `job-scope.test.ts`, `jobs.tsx`, docs.
- **Before → after:** T3 ignores unrelated query text; launch without `sourceId` runs each active source; Fargate can pass `--process-scheduled`.
- **Verified:** vitest job-scope.
- **Not done:** Enable `--process-scheduled` in ECS command if desired.

---

### 2026-10-27 — Remaining estate/jobs batch (Cursor)

- **Issues:** Source routes queue-only; schedule without run; no re-run flags in UI; scheduled harvest no-op.
- **Files:** `scheduled-estate-harvest.ts`, `run-scheduled/route.ts`, `catalog-pipeline-launch.ts`, `job-scope-flags.ts`, source `harvest|inventory|refresh` routes, `launch/route.ts`, `orchestrator.ts`, `enrich.ts`, `harvest.ts`, `jobs.tsx`, `BulkActionBar`, `EstateCatalogTab`, tests, docs.
- **Before → after:** Scheduled rows can start pipelines; Jobs modal can force full T0 / re-profile / re-enrich (new versions); source APIs start workers.
- **Verified:** vitest.
- **Not done:** Deploy web + harvester + ECS task def.

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
