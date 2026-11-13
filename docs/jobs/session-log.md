# Jobs / harvest — session log

**Purpose:** Running log of agent and engineer sessions that touch the harvest job pipeline.  
**Newest first.** See [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md).

---

### 2026-11-13: Vessel pilot retrospective doc (Cursor)

- **What:** `docs/jobs/powerbi-vessel-pilot-issues-and-wiring.md`.
- **Why:** Document issues, fixes, wiring, and post-resolve pilot numbers.
- **Verified:** Matches latest `run-pilot-local` + `diag-vessel-recreation.ts`.

### 2026-11-13: Catalog column resolver in PBI translate (Cursor)

- **What:** `catalog-column-resolve.ts`, translate allowlist, UI column map line on measures.
- **Why:** Ground DAX→SQL in harvested catalog columns.
- **Verified:** unit tests; re-run pilot translate locally to refresh translations.

### 2026-11-13: Recreation summary UI + failure taxonomy (Cursor)

- **What:** `recreation-summary.ts`, Estate Power BI detail bar/tags, Vessel diag script.
- **Why:** Track Databricks recreation % and explain parity/translate failures per measure.
- **Verified:** Vessel 4/30 match, 3 published, 8 SQL errors, 10 no SQL, 8 no UC.

### 2026-11-13: Vessel translate re-run (Cursor)

- **What:** Applied `20261114_pbi_translation_upsert_index`; re-ran Vessel `--from-kind pbi_translate`.
- **Outcome:** `dax_uc=22 no_bind=8 rule=3 llm=6 cost≈$0.09`; parity `skip=9` (no pass); publish blocked.
- **Verified:** `diag-vessel-uc.ts` 22/30 resolved; pilot through parity step.

### 2026-11-13: Vessel translate — DAX UC refs + quote table names (Cursor)

- **What:** Track B follow-up: `normalizePbiTableName` on UC map keys; `input.modelTables` bugfix; Grok omit `temperature` in `harvest-llm.ts`; `scripts/powerbi/diag-vessel-uc.ts`.
- **Why:** Vessel `dax_uc=6` was mostly IMO-only; `'Vessel Internal Audit'` stored with literal quotes blocked DAX ref match; LLM 0/30 on Bedrock Grok temperature.
- **Verified:** Vitest; pilot translate once (pre-fix stats); full re-run pending RDS/VPN.

### 2026-11-13: Power BI estate page compact header (Claude Code)

- **What:** Replaced the duplicate title and 7 KPI cards with a one-line stats bar; removed the detail stat cards.
- **Why:** Too much vertical space before content.

### 2026-11-13: Power BI estate page UI redesign (Claude Code)

- **What:** `src/views/agent-lab/estate/powerbi.tsx`: KPI tiles, collapsible conflicts panel with model chips that jump to the measure, model search and status filter, and a tabbed detail pane (Measures / Tables / Reports). The domain score no longer renders as a percentage ("1800%").
- **Why:** The page was not usable at 451 models, and the conflicts box took half the viewport.
- **Verified:** tsc clean for the file; not checked in a browser.

### 2026-11-13: Power BI `pbi_translate` LLM tier v1 (Cursor)

- **What:** `translate-llm.ts` + second pass in `runPbiTranslate` after rule tier; pilot cap 12 measures; job `cost_usd` in stats.
- **Why:** CII pilot DAX too rich for rule tier; unblock parity with draft `tier=llm` rows.

### 2026-11-13: Power BI local 5-report pilot script (Cursor)

- **What:** `scripts/powerbi/run-pilot-local.ts`; orchestrator honors `max_models` / `max_reports` in scope.
- **Why:** Validate pipeline locally before Fargate harvest.

### 2026-11-13: Inspector verified-query path (Cursor)

- **What:** Match `kb_verified_queries` on user turn; `run_verified_query` tool in chat.
- **Verified:** Vitest format block.

### 2026-11-13: Power BI `pbi_publish` + kb_verified_queries (Cursor)

- **What:** Publish job writes verified queries from parity-pass translations; embed + match helper.
- **Verified:** Vitest publish-question, schema-hash.

### 2026-11-13: Power BI `pbi_parity` (Cursor)

- **What:** Parity job compares rule-tier SQL to oracle; updates translation verdicts.
- **Verified:** Vitest parity-compare.

### 2026-11-13: Power BI oracle + conflict steward UI (Cursor)

- **What:** `pbi_oracle` job + results table; conflicts acknowledge API; estate conflict panel.
- **Verified:** Vitest powerbi lib + API route tests.
- **Not done:** Operator `apply-phase3-oracle-migration.mjs`.

### 2026-11-13: Power BI `pbi_families` (Cursor)

- **What:** Model family clustering job; `pbi_families` table; models API family fields; migration + apply script.
- **Verified:** Vitest `family-cluster` + existing powerbi tests.
- **Not done:** Operator migration; Phase 3 `pbi_oracle`.

### 2026-11-13: Power BI `pbi_domains` (Cursor)

- **What:** Domain registry upsert, model scoring, `pbi_conflicts`; orchestrator job; domains API; estate UI domain filter + conflict banner; migration + apply script.
- **Verified:** Vitest powerbi lib + API route tests.
- **Not done:** Operator migration on Aurora; steward review UI.

### 2026-11-13: Power BI Phase 2 catalog link (Cursor)

- **What:** `pbi_catalog_link`; SQL path extraction; links to `platform_context_objects`; object page usage panel; migration 1c.
- **Verified:** Vitest `native-sql` + powerbi parse + API route tests (18).
- **Not done:** `pbi_domains`.

### 2026-11-13: Power BI browse tab + read APIs (Cursor)

- **What:** `estate.powerbi` section; Power BI estate page; workspace/model list + model detail APIs.
- **Files:** `powerbi.tsx`, `api/agent-lab/powerbi/{workspaces,models}`, `registry.ts`, `nav-items.ts`, `router.tsx`, route tests.
- **Before → after:** No in-app browse → admins view harvested models, tables, measures, classification.
- **Verified:** Vitest powerbi routes + section route-coverage.
- **Not done:** Catalog link job.

### 2026-11-13: Power BI Phase 1b — `pbi_parse` + parsers (Cursor)

- **What:** Phase 1b schema; TMDL parser; partition classifier §8.5; `runPbiParse`; legacy report summary parse; Jobs launch PBI Parse; summary API parse metrics; implementation report.
- **Files:** `prisma/migrations/20261113_powerbi_bridge_phase1b/`, `src/lib/powerbi/{tmdl-parse,partition-kind,parse,report-parse-legacy}.ts`, orchestrator, jobs UI, `powerbi/summary`, tests, `docs/jobs/powerbi-phase1-implementation-report.md`.
- **Before → after:** `pbi_parse` failed as stub → runnable after definitions + migration 1b; models get `classification.answerability` in `props`.
- **Verified:** `npx vitest run src/lib/powerbi/__tests__/powerbi-parse.test.ts`.
- **Not done:** Operator `apply-phase1b-migration.mjs`; browse UI; Phases 2–7.

### 2026-11-11: Phase 1 migration applied on dev Aurora (Cursor)

- **What:** `apply-phase1-migration.mjs` — five `pbi_*` tables live; Prisma migration history updated.
- **Verified:** Retry wrapper recovered from transient P1001 on first attempt.
- **Not done:** Power BI source registration; inventory job.

### 2026-11-11: `pbi_definitions` job + Fabric client (Cursor)

- **What:** TMDL/report download to raw store; orchestrator case; Jobs launch for PBI Definitions; summary API; migration helper script.
- **Files:** `src/lib/powerbi/{fabric,raw-store,definitions}.ts`, orchestrator, jobs UI, `powerbi/summary/route.ts`, `apply-phase1-migration.mjs`.
- **Before → after:** `pbi_definitions` stub failed → runnable after inventory + migration; validation baseline deferred.
- **Verified:** Code only; CII boost run today errored on RDS (recorded in `eval/powerbi/runs/`).
- **Not done:** Operator migration; first definitions job on dev.

### 2026-11-11: CII boost suite for validation baseline (Cursor)

- **What:** `cii_pilot_v1` boost cases, registry, run-suite `suiteVersion`, export to `eval/powerbi/runs`.
- **Files:** `src/lib/boost/suite-cii.ts`, `registry.ts`, boost API routes, `export-cii-boost-baseline.mjs`.
- **Before → after:** Manual-only Inspector scoring → repeatable 6-case automated matrix + DB export for stewards.
- **Verified:** Code only.
- **Not done:** Admin run on dev; steward outcome overrides.

### 2026-11-11: Power BI before/after validation guide (Cursor)

- **What:** Validation doc, eval assets, baseline snapshot script; clarified Phase 1 = platform metrics only, Phase 3 = Inspector improvement.
- **Files:** `docs/powerbi-integration-validation.md`, `eval/powerbi/`, `scripts/powerbi/record-baseline-snapshot.mjs`, tracker § Validation.
- **Before → after:** No structured proof plan → phased checklist + JSON snapshots + CII question template.
- **Verified:** `record-baseline-snapshot.mjs --label before-phase1`.
- **Not done:** Steward question bank scoring in Inspector.

### 2026-11-11: Power BI Phase 1 code on `feature/powerbi-bridge` (Claude)

- **What:** Branch `feature/powerbi-bridge`; Phase 1 schema + `pbi_inventory` runner; Power BI client/inventory lib; Jobs group **Power BI**; sources API accepts `connection_kind: powerbi`.
- **Files:** See `docs/jobs/powerbi-implementation-tracker.md` § Done on branch.
- **Before → after:** No Power BI jobs → `pbi_inventory` runnable after migration + Power BI source; other `pbi_*` kinds enqueue but orchestrator returns not-implemented.
- **Verified:** `npx prisma generate`. DB backup script failed locally (no pg_dump / Docker off); migration not executed.
- **Not done:** Operator backup + `prisma db execute`; first live inventory run.

### 2026-11-11: Power BI usage source proven; `pbi_inventory` scope extended in plan (Claude)

- **What:** Service principal read report usage from the workspace usage-metrics models through DAX (counts only). In the plan, `pbi_inventory` now also pulls usage keyed by window.
- **Files:** `docs/powerbi-harvest-build-plan.md`, `docs/CHANGELOG.md`; gitignored `powerbi-estate/dax/usage_*.dax`, `powerbi-estate/usage/`.
- **Before → after:** Usage was listed as blocked on admin APIs → available for 2 of 3 workspaces. Embedded PBI Portal data is stale (last refresh 4 June 2026); Synergy App Central is current (10 November).
- **Verified:** Four read-only `executeQueries` calls per workspace (tables, columns, views by report, page-view summary).
- **Not done:** No job code. `current-status.md` unchanged.

### 2026-11-11: Power BI bridge design finalized, separate job track (Claude)

- **What:** Final design for the Power BI track in `docs/powerbi-harvest-build-plan.md`:
  - Power BI is its own context source (`connection_kind = 'powerbi'`).
  - Nine job kinds: `pbi_inventory`, `pbi_definitions`, `pbi_parse`, `pbi_catalog_link`, `pbi_domains`, `pbi_oracle`, `pbi_translate`, `pbi_parity`, `pbi_publish`.
  - The jobs are built in TypeScript in `scripts/context/orchestrator.ts`.
  - Catalog linking is an optional job that is re-run after T0 on bound schemas, not chained after T0.
  - The jobs appear as a "Power BI" group on the Jobs screen.
- **Files:** `docs/powerbi-harvest-build-plan.md`, `docs/CHANGELOG.md`.
- **Before → after:** Earlier plan listed job kinds but not their run rules, incremental rules, or relationship to T0 → each job has a trigger and incremental rule; T0 independence is explicit.
- **Verified:** Harvester image is Node-only (`Dockerfile.harvester`); job wiring points (`queue.ts` `JobKind`, `job-ui.ts`, `launch-kinds.ts`, `sources/route.ts`) checked.
- **Not done:** No code. `current-status.md` unchanged (no runtime behavior change).

### 2026-11-10: Power BI harvest plan with proposed `pbi_*` job kinds (Claude)

- **What:** Plan for harvesting Power BI as an Estate source: a `platform_context_sources` row with `connection_kind = 'powerbi'` and job kinds `pbi_inventory`, `pbi_definitions`, `pbi_parse`, `pbi_crosswalk`, `pbi_families`, `pbi_oracle`, `pbi_translate`, `pbi_parity`, `pbi_publish`.
- **Files:** `docs/powerbi-harvest-build-plan.md`.
- **Before → after:** No change to job runtime or UI. The plan notes that `src/app/api/agent-lab/context/sources/route.ts` hard-codes `connection_kind: 'databricks'` and must change before a Power BI source can be registered.
- **Verified:** Doc only.
- **Not done:** `docs/jobs/current-status.md` is unchanged because no behavior changed.

### 2026-11-06: Push consolidated work to `dev` including docs and graphify (Composer)

- **What:** All local changes were committed and merged into `dev`, then pushed to `synergy-marine` so the branch carries documentation updates (`docs/CHANGELOG.md`, `docs/jobs/session-log.md`, `docs/jobs/current-status.md`, and other `docs/**` additions), research notes, and `graphify-out/` (graph report and artifacts).
- **Verified:** `git push synergy-marine dev`.
- **Not done:** Next.js dev logs under `.next/` are not in git (ignored).

### 2026-11-06: Estate routes `enrich` and `logs` put under section access (Claude)

- **What:**
  - A new route coverage test (`src/lib/sections/__tests__/route-coverage.test.ts`) found two estate routes still on the old admin check.
  - `objects/[id]/enrich` starts a harvest. It now needs Manage on Catalog, so platform admins only (admins could call it before; the button was already hidden).
  - `jobs/[id]/logs` (live job log stream) now needs View on Jobs. Admins and platform admins have it, as before.
- **Files:** `src/app/api/agent-lab/context/objects/[id]/enrich/route.ts`, `src/app/api/agent-lab/context/jobs/[id]/logs/route.ts`, `src/lib/sections/__tests__/route-coverage.test.ts`.
- **Verified:** vitest `src/lib/sections` and `src/app/api/agent-lab` (56 tests); `tsc --noEmit` clean. Not run against live jobs.
- **Not done:** Not checked in a browser.

### 2026-11-06: Data Estate section access, admins view only (Claude)

- **Files:**
  - New: `src/lib/sections/*`, `src/app/api/me/sections/route.ts`.
  - Estate pages and components: `EstateLayout`, `EstateNav`, `index`, `mapper`, `silo`, `SourceCard`, `ChildJobsPanel`, `EntityModelCard`, `HarvestActionBar`, `HeroSection`, `RelationshipList`, `TrustActionBar`, `SemanticCard`.
  - 29 `src/app/api/agent-lab/context/**/route.ts` files. Full list in `docs/CHANGELOG.md`.
- **Before → after:**
  - **Before:** any signed-in user could open the Data Estate and read every estate API. Run, harvest, and schedule controls were already platform-admin only, but confirm-semantic, resolve-pii, mapping status, and silo link status could be changed by anyone. Overview and object-page actions showed for everyone.
  - **After:**
    - Admins see everything view-only, with a banner, and all actions are hidden or disabled.
    - Members and read-only users have no Data Estate (hidden from the sidebar; the APIs return 403).
    - Platform admins are unchanged.
  - The orchestrator and job launch paths are unchanged.
- **Not done:**
  - Not browser-checked.
  - Section access for other areas.
  - Bundle editor.
 `metadata` / `profile` service principal roles (Cursor)

- **Files:** `src/lib/context/databricks-adapter.ts` (`exec` → `metadata` role; new `profileExec` → `profile` role for `harvestProfile`, `fetchSampleRows`, `countExactRows`), `src/lib/databricks/{sp-roles,token-client,secrets,test-connection}.ts`, `scripts/context/diagnose-query-history.ts`. Full list in `docs/CHANGELOG.md`.
- **Before → after:** Every harvest query used the connection's single SP. Now each query names a role. With no role credentials configured (today), both roles resolve to the same default SP, so harvest behaviour is unchanged. Once an admin sets a role SP, T0/T3 and T1 run under different identities. `DATABRICKS_SP_REQUIRED_ROLES` stops the fallback.
- **Also:** `src/lib/databricks/secrets.ts` now uses the AWS default credential chain when `AWS_ACCESS_KEY_ID` is unset, so the Fargate harvester can read role secrets through its task role.
- **Not done:** No live harvest run. The `platform_databricks_credentials` migration has not been applied. No role SPs exist yet. Whether `DESCRIBE DETAIL` works with `BROWSE` alone was not checked, so it runs as `profile`.

### 2026-11-04: T3 usage keeps executor names; key_columns only referenced columns (Claude)

- **Files:** `src/lib/context/usage.ts` (`access_stats.top_executors` = top 10 `executed_as` with query counts; `extractKeyColumns` drops columns with no references), `src/components/estate/UsagePanel.tsx`, `HeroSection.tsx`, `ObjectKnowledgePage.tsx`.
- **Before → after:** Usage showed only `distinct_executors`; names were discarded at harvest. Key columns listed 10 zero-score columns when queries referenced none (e.g. `SELECT *`). "last 0 days" when the window started and ended on one day. After the next T3: Executors card with names and counts; key columns only when referenced; window shown as dates; `weekly_trend` shown as bars.
- **Not done:** Existing usage snapshots have no `top_executors` until T3 re-runs. `executed_as` is a user email or service principal — shown to anyone who can open the object page.

### 2026-11-04: On-demand exact row count from the object page (Claude)

- **Files:** `src/lib/context/databricks-adapter.ts` (`countExactRows`), new `src/app/api/agent-lab/context/objects/[id]/row-count/route.ts`, `src/components/estate/HeroSection.tsx`.
- **Before → after:** Tables profiled before the T1 exact count showed only "5K+ · sampled". Rows tile now offers "Count exact rows" → one Delta `COUNT(*)` → saved to `row_count_est`. No job is queued; no change to orchestrator.
- **Not done:** Live check against Databricks.

### 2026-11-04: T1 exact row count for Delta tables (Claude)

- **Issue:** Object page could not show an exact row count for large tables — T1 only counts rows inside its LIMIT sample window.
- **Files:** `src/lib/context/databricks-adapter.ts` (one `SELECT COUNT(*)` for Delta tables after DESCRIBE DETAIL, only when ≥2 statements of budget remain; stored as `stats.row_count_exact`), `src/lib/context/harvest.ts` (`row_count_est` = `row_count_exact` when present). UI: `HeroSection.tsx`, `ProfileTimeline.tsx`.
- **Before → after:** Rows tile showed "5K+ · row_count not measured" for >1 GB tables; after the next T1 it shows the exact count (e.g. "12,483,902 · row_count_exact"). Views and non-Delta tables are unchanged (a COUNT there would be a full scan).
- **Not done:** Not run against live Databricks in this session; cost of COUNT(*) on Delta tables with deletion vectors not measured.

### 2026-11-04: Harvest launch budget gate + full cost program

- **What:** `assertHarvestBudget` on `POST /api/agent-lab/context/jobs/launch` using `estimateLaunchHarvestUsd` from job plans. Launcher attribution unchanged (`triggered_by_user_id`).
- **Why:** Org-level harvest cap (hard mode) should block launches before Fargate enqueue, not only show overage in the monitor.
- **Verified:** Code path review; ledger tests unchanged.
- **Not done:** Per-user harvest caps (still org pool only).

### 2026-11-03: Object page redesign + T1 row count / drift fixes (Claude)

- **Issues:** Object page showed "5,000 rows" for a ~1 GB table (the T1 sample window saved as `row_count_est`); Trusted score said "High drift (2 events)" for objects that had only been re-profiled (`computeDrift` writes a record every time); jobs queued from the object page never showed in its Recent Jobs (query matched `scope.path`, actions write `scope.includePatterns`).
- **Files:** `src/lib/context/harvest.ts` (null row count when the count fills the sample window), `src/lib/context/databricks-adapter.ts` (`table_detail` from DESCRIBE DETAIL), `src/lib/context/pipeline-freshness.ts` (`table_detail` volatile), `src/lib/context/drift-summary.ts` (+ test), `src/lib/context/data-score/dimensions/trusted.ts`, `src/lib/context/reads.ts` (jobs `includePatterns` match, confirmed mappings, agent knowledge chunks). UI: see `docs/CHANGELOG.md`.
- **Before → after:** Hero row count for a sampled large table reads "5K+ · not counted" instead of "5,000". Re-profiles with no change no longer lower Trusted. Recent Jobs lists Rescan / Re-enrich / Refresh all jobs, and the page polls every 15s while one is queued or running.
- **Not done:** Existing `row_count_est` values equal to the window stay until each object is re-profiled (no backfill run). No live-data verification in this session.

### 2026-11-03: Harvest spend ledger + launcher attribution

- **What:** `platform_context_jobs.triggered_by_user_id` set on launch (`jobs/launch`). `finalize()` writes `platform_spend_events` via `recordHarvestJobSpend` when `stats.cost_usd` is present.
- **Why:** Cost monitor harvest tab needs per-job USD and who launched on-demand jobs.
- **Verified:** Unit tests in `src/lib/spend/__tests__/record-spend-event.test.ts`.
- **Not done:** Backfill ledger from past jobs; scheduled jobs without a user id.

### 2026-11-02: DB verify pipeline 8942f51f… (Navitas 7 schemas)

- **Queried:** `platform_context_jobs`, `platform_context_objects` via `verify-pipeline-run.ts`.
- **Finding:** Job `670f5878…` is **`t3_usage`** (Fargate `da6440ed…`), **not** `t4_scan`. Scope **`chain: ["t4_scan"]`** is the *pending* step. Stats: **496 skipped**, 0 processed, 0 snapshots; window 2026-10-22→2026-11-02. **No `t4_scan` row** exists for this `pipeline_run_id` or source since Nov 1 → **T4 never enqueued** (orchestrator chain not executed on worker). Objects: **496 scanned, 496 not_in_model, ever_t3=0** in those schemas.
- **Root causes:** (1) T3 idle — no qualified query history in window; (2) **T4 missing** — chain advance failure or pre-fix orchestrator; (3) UI reads like a T4 job because **chain** is shown next to kind.
- **Files:** `pipeline-chain.ts`, `orchestrator.ts`, verify script/SQL.

### 2026-11-02: Verify T3 empty run + UI empty state

- **Question:** Scoped `t3_usage` (and T4) finished green with `skipped: 1`, other stats zero — bug or expected?
- **Finding:** Expected when one table is in scope, Databricks was queried, but **no query history** in the incremental window (`since` = that table's `last_t3_at`) matches qualified SQL (`catalog.schema.table` or `schema.table`). Table can still show **T3 · Linked** from an earlier harvest. T4 **succeeded empty** when no rows match `last_t4_at IS NULL OR last_t4_at < last_t2_at` in scope (already modeled).
- **Files:** `usage.ts` (`objectsInScope` stat), `job-ui.ts` (empty display for `t3_usage` / `t4_scan`).
- **Not done:** Force 7-day / 30-day re-harvest from Continue; DB status still `succeeded`.

### 2026-11-02: Continue pipeline tier selection (T3/T4)

- **Issues:** Continue could not run Usage or Business model; Run was disabled with no path forward.
- **Files:** `pipeline-freshness.ts`, `pipeline-intent.ts`, `ScannedPipelineScopeBar.tsx`, `pipeline/continue/route.ts`, `orchestrator.ts` (T3 chain advance).
- **Before → after:** Modal lists six stages; default checks T3+T4 when tables are not in the model. Run launches `t3_usage` → `t4_scan` sequentially with the same Limit. T0–Embed still cascade only when stale.
- **Not done:** Live UI verification.

### 2026-11-02: T3 and T4 stay on the selected tables

- **Issues:** Continue said "Nothing stale" while T4 was missing; `t4_scan` ignored Limit; scoped T3 used the source-wide `last_t3_at` and an unfiltered lineage pull.
- **Files:** `src/lib/context/t4/cluster.ts`, `scan-estate.ts`, `run.ts`; `src/lib/context/usage.ts`; `src/lib/context/job-scope.ts`; `src/lib/context/databricks-adapter.ts`; `src/lib/estate/pipeline-intent.ts`; tests; `docs/jobs/current-status.md`.
- **Before → after:** Business model on one table drafted every unfinished table on the source; it now drafts only the Limit. A scoped usage run reads that scope's history window and lineage. The Scanned bar says how many described tables are not in the business model. Continue still stops at Embed.
- **Not done:** Continue does not launch T3 or T4. Scopes larger than 40 tables still push a schema `LIKE` for query history. Live Catalog check not performed in this session.

### 2026-11-01: Home dashboard flags jobs that miss their schedule

- **Files:** `src/lib/dashboard/summary.ts` (`fetchJobs` sets `overdue` using the Jobs page rule: no finish within 1.5× the cadence, where the cadence comes from `getNextRuns`, for non-manual `HARVEST_SCHEDULES`), `src/components/dashboard/DashboardView.tsx` (amber stage status and a Briefing item that links to `/agent-lab/estate/jobs?kind=`). See `docs/CHANGELOG.md`.
- **No change** to orchestrator, schedules or job data. Read-only.
- **Verified:** ran against the live DB with no overdue jobs, as expected, because every schedule is `manual`.

### 2026-11-01: Themed dropdown for native selects in Jobs UI

- **Files:** `src/views/agent-lab/estate/jobs.tsx` and other estate components: `<select>` became the shared `Select` (`src/components/form/Select.tsx`). See `docs/CHANGELOG.md`.
- **Why:** consistent dropdown design across the app. No change to job logic or APIs. Live UI check not performed.

### 2026-11-05: Continue pipeline: "Scanned tables only" option

- **Files:** `src/app/api/agent-lab/context/pipeline/continue/route.ts` (POST accepts `scannedOnly`), `src/components/estate/ScannedPipelineScopeBar.tsx` (checkbox in the Continue confirm sheet; toggling re-runs the change check).
- **What:** with the option on, the server resolves the scope to exact table paths for objects with `lifecycle='active'` and `last_t0_at` set (structurally scanned). Discovery-only tables are excluded from the change check, the plan and the launch. Returns `400 NO_SCANNED_TABLES` when none match, and `400 TOO_MANY_TABLES` above 50 tables.
- **Why:** Continue on a schema otherwise also rescans and profiles every never-scanned table it discovers.
- **Not done:** the intent GET preview still uses the full scope, so its counts can differ from the scanned-only plan shown in the confirm sheet. A schema with more than 50 scanned tables cannot use this option; narrow the scope instead. No unit test for the scanned-only resolution yet. Live UI check not performed.

### 2026-11-04: Security hardening: role gates on harvest, refresh and log routes (assessment F7)

- **Files:** the 12 harvest/refresh routes listed in [current-status.md](./current-status.md) "Server-side access" now call `denyUnlessEstatePipelineOperator()` (platform_admin). `objects/[id]/enrich` and `jobs/[id]/logs` call the new `denyUnlessSessionRole('admin')` (`src/middleware/auth.ts`). `jobs/[id]/logs` no longer streams raw CloudWatch error text to the client. `silo/scan` and `silo/links/[id]` build the dev-only internal `/process` URL from `NEXTAUTH_URL` instead of the request Host.
- **Why:** any signed-in member could launch ECS harvest tasks, LLM enrichment or read CloudWatch logs. The UI already hid these controls from non-platform admins, but the APIs did not enforce that.
- **Behavior change:** members and readonly users get 403 on these APIs. The log stream panel is admin-only.
- **No change** to orchestrator, tier logic, scheduling or job data.
- **Verified:** `tsc` clean; `security-hardening.test.ts` + `authz-hardening.test.ts` 37/37; full vitest 1026 pass (1 unrelated typography-guard failure from UI work in progress).

### 2026-11-01: Home dashboard shows job health

- **Files:** `src/lib/dashboard/summary.ts` (new `jobs` section: `listJobKindSummaries(orgId, { sinceDays: 7, detail: true, recentLimit: 1 })` plus `computeJobHealth`), `src/components/dashboard/DashboardView.tsx`.
- **Change:**
  - The home dashboard briefing lists job kinds whose last run failed, and overdue memory jobs.
  - Each estate stage shows the status of the job that feeds it.
  - New metric: job success over the last 7 days.
  - Links deep-link to `/agent-lab/estate/jobs?kind=<kind>`.
- **No change** to job execution or to the Jobs page.
- **Verified:** adapter tests 13/13; screenshots with mocked data; tsc has no new errors.

### 2026-11-01: Jobs audit fixes (embed batching, reaper heartbeat, status, counts)

- **Files:** `src/lib/context/embed.ts`, `src/lib/context/orphan-jobs.ts`, `src/lib/context/active-jobs.ts`, `src/lib/context/reads.ts`, `src/lib/context/harvest.ts`, `src/lib/estate/job-ui.ts` (+`job-ui.test.ts`), `src/components/estate/ActiveRunsPanel.tsx`, `src/components/estate/JobDetailDrawer.tsx`, `docs/CHANGELOG.md`, `docs/jobs/current-status.md`
- **What (before → after):**
  - Embed `IN (...)` lookups with a whole source (about 34k IDs) exceeded Postgres's 32,767 bind-parameter limit → `embedSubjects` splits IDs into chunks of 5,000 and sums the tallies.
  - Web reaper killed any queued/running job without a task ID that was older than 10 minutes by `created_at`, including live ones → it now uses `updated_at`, which workers refresh with heartbeat every ~3 min.
  - `cancelled` jobs mapped to "queued" → mapped to `cancelled` (grey chip).
  - `partial` was green in the drawer and red in the runs panel → amber in both.
  - Kind filter omitted 6 kinds → lists every `JobKind`.
  - Summary `queued`/`running` ignored the time window, so `total` did not match the buckets → windowed.
  - Child counts had no `cancelled`, so `total` did not reconcile → added.
  - T0 drop pass filtered by source only → also filters by `org_id`.
- **Example:** an embed of a whole 486-table source (about 34k columns) used to record `columns_embedded: 0` with "too many bind variables… received 32769". Now it runs in 7 chunks.
- **Verified:** `tsc --noEmit` clean; vitest on `src/lib/context` and `src/lib/estate` passes (19 files, 88+ tests incl. new job-ui cases); ESLint shows only the 2 pre-existing `set-state-in-effect` errors.
- **Decisions and follow-up (same day):**
  - Schedules: `change_detect_daily`, `t1_profile_weekly`, `estate_inventory_weekly` changed from `live` to `manual` in [schedules.ts](c:/ALOFT/aloft-ui-redesign/src/lib/context/schedules.ts). Reason: EventBridge deployment unverified. Revert to `live` after `aws events list-rules --name-prefix aloft-` confirms.
  - Stale profiles: one-off data backfill on `platform_context_objects`, in one transaction. Ran `UPDATE ... SET last_t1_at = last_t0_at WHERE lifecycle='active' AND last_t0_at IS NOT NULL AND last_t1_at IS NOT NULL AND last_t1_at < last_t0_at AND source_altered_at IS NOT NULL AND source_altered_at <= last_t1_at`. Result: 1,695 rows updated; needs-profile count went 2,717 → 1,022. No profile stats changed.
  - Chain reap (Catalog banner, queued follow-ups) left as is; options documented in the CHANGELOG entry.
- **Not done / open:**
  - Catalog banner still reaps queued chain follow-ups after 10 minutes without a kick. Proper fix needs the harvester image with in-process chaining deployed, or a kick-before-reap change.
  - No live browser check of the Jobs page (CDP connection timed out earlier).
  - `src/app/api/catalog/tools/*` and `src/app/api/catalog/tools/schema.ts` have uncommitted changes from other work that fail `tsc` (Zod / Prisma JSON types). Not touched here.

---

### 2026-11-01: Continue pipeline checks the source, then cascades

- **Files:** `src/lib/context/pipeline-freshness.ts` (+test), `src/lib/estate/pipeline-change-check.ts`, `src/lib/estate/pipeline-intent.ts`, `src/app/api/agent-lab/context/pipeline/continue/route.ts`, `src/lib/context/databricks-adapter.ts`, `src/lib/context/harvest.ts`, `src/lib/context/profile.ts`, `src/lib/context/embed.ts`, `src/lib/context/embedding-presence.ts`, `scripts/context/orchestrator.ts`, `src/components/estate/ScannedPipelineScopeBar.tsx`
- **What (before → after):**
  - Continue only compared local timestamps → it **always** runs a scoped, metadata-only Databricks check first: one `information_schema.tables` listing per catalog in scope, comparing each table's `last_altered` with its stored `source_altered_at`. The check failing stops the run.
  - Chain was a click-time snapshot (Profile → Embed could skip Describe) → it runs from the earliest stale stage through every downstream stage to Embed. Each stage still picks only its own stale tables when it starts.
  - T0 rescans always bumped `last_t0_at` (no-op rescans made Profile look stale) → bump only on structure or alter-time change.
  - Re-profile always made Describe stale → an identical profile keeps Describe current (re-describe only when the profile changed).
  - "Not searchable" counted only missing embeddings → it also counts embeddings older than the latest semantic card. Embed refreshes the time on unchanged vectors.
  - Embed job with an empty scope embedded columns for the whole source → no-op.
  - Continue dialog → preview with the source check result (changed / new / removed / unchanged) and per-stage "up to N", then Run.
- **Example:** no source change and only embedding missing → the plan is **Embed** only.
- **Verified:** vitest 18 passed; tsc clean. No live run yet.
- **Notes:** `[x] current-status read [x] code [x] CHANGELOG [x] session-log [x] current-status updated`. The worker image needs a redeploy for the T0/T1/embed changes.

---

### 2026-11-01: Job type switcher redesign

- **Files:** `src/views/agent-lab/estate/jobs.tsx` (`KindDropdown`, new `kindHealthOf`)
- **What (before → after):** The breadcrumb switcher on the job type page was a coloured monospace pill opening an alphabetical list with kind colour dots and a "current" label → plain trigger with a health dot; the menu has a search box, is grouped by pipeline stage (01 Discover, 02 Scan, …) in pipeline order, shows each job's status (last-run age, or Failing / Overdue / Running / Queued / Never run) with a ✓ on the current job, and supports ↑/↓, Enter and Esc. The coloured stripe beside the job title was removed (matches the table).
- **Verified:** tsc clean; fixture screenshots light and dark with the menu open.
### 2026-11-01: Job types table polish

- **Files:** `src/views/agent-lab/estate/jobs.tsx`, `src/lib/estate/nav-items.ts`
- **What (before → after):**
  - Overdue scheduled jobs (missed schedule by >1.5× cadence) showed a green dot and a plain date → amber dot plus "overdue" in Last finished, reason in the tooltip.
  - Last finished switched to a locale date after 7 days → always relative (`1w ago`, `3mo ago`), exact time in the tooltip (`relativeTime` now covers weeks/months/years everywhere on the page).
  - Advanced job types that need attention were hidden when the advanced section was collapsed (strip named "Silo Scan" but no row) → those rows always show; toggle reads "Show N more advanced job types".
  - Success header did not say which window it used → "Success · 7d" (follows `?range=`); value reads "100% 4 runs" instead of "100% /4".
  - "Manual" vs "On demand" → both "On demand", tooltip explains whether a schedule exists but is switched off.
  - Cancelled runs looked like empty slots → hollow outlined bar (strip, legend, job-type page chart and legend).
  - Coloured job-type stripes removed from rows (clashed with status colours); per-row Run shows on row hover/focus only (always on touch devices).
  - Page title "Pipeline jobs" → "Jobs" (matches the tab).
- **Verified:** tsc clean; fixture screenshots light and dark. Live data not verified.
### 2026-11-01: Catalog cleanup touches shared Jobs components

- **Files:** `src/components/estate/ScannedObjectsTab.tsx`, `src/components/estate/Pagination.tsx`
- **What:** The Jobs page's "Scanned objects" tab uses the redesigned `ScannedObjectsTab`: plain tier names, a pipeline progress bar, and the same table style as the Catalog. `Pagination` now uses sans tabular numbers. Fetching, selection and the harvest/pipeline logic are unchanged.
- **Verified:** tsc is clean; screenshots with fake API data. Live data is not verified.
### 2026-10-31: Health tab rebuilt as a full page

- **Files:** `src/views/agent-lab/estate/jobs.tsx`
- **What:**
  - `HealthView` now shows:
    - a status headline and window switch;
    - KPI tiles (success rate vs the previous period, runs, objects processed, time spent);
    - a runs-per-day or per-hour stacked chart;
    - reliability by job type;
    - recent failures with error lines, which open the drawer;
    - needs attention;
    - upcoming scheduled runs;
    - the suggested next step with coverage.
  - Removed `RunHealthCard`.
  - New helpers: `healthSeg`, `buildRunBuckets`, `RunsPerPeriodChart`, `HealthCard`, `KpiTile`, `WindowSwitch`.
  - Data comes from the summary API plus the jobs list (`after=<window start>&pageSize=1000`, parents only).
- **Verified:** `tsc` clean; screenshots for 7d, 30d and 24h, with no page errors.

### 2026-11-03: Health tab; Job types tab shows a one-line health strip

- **Files:** `src/views/agent-lab/estate/jobs.tsx`, `src/components/estate/JobsCockpitPanel.tsx`, `src/lib/estate/nav-items.ts`, `src/views/agent-lab/estate/EstateNav.tsx`
- **What:**
  - Removed the Jobs page subtitle.
  - New **Health** tab (`?tab=health`), which shows a status dot when job types need attention. It holds `RunHealthCard` (headline, success · runs · failed · running, window select, attention rows with issue + time) and `JobsCockpitPanel` ("Suggested next step" + estate coverage, open by default via `defaultExpanded`).
  - The Job types tab replaces both cards with `HealthStrip`, a single row: headline, affected job types (each opens its page), stats, window select and **View health**.
  - The shared `computeRunHealth()` feeds the strip, the card and the tab dot.
- **Verified:** `tsc` clean; screenshots of `/jobs` and `/jobs?tab=health`, with no page errors.

### 2026-10-31: Job type detail page (`?kind=`) + slimmer Job types table

- **Files:** `src/views/agent-lab/estate/jobs.tsx`
- **What:**
  - Job types table: removed the per-row description, the stage-group sentence and the header blurb (descriptions are tooltips now); rows are single-line.
  - New `JobKindPage` replaces `L2View` (date groups), `L3View` (runs on one date), `DateDropdown` and `JobsDrilldownNav`. It has a header with a health badge, schedule and Run; a Last run card with error excerpt and Retry failed chunks / Run again; a recent-runs duration chart (60 runs); pipeline context (upstream/downstream + coverage); and an All runs table with status / time range / day filters (`?status=`, `?since=`, `?date=`).
  - `?highlight=<jobId>` now fetches the job, opens its job type page and the drawer (previously only worked on L3, so the harvest action bar links did nothing).
  - `RunJobButton` gained `hideTrigger` (modal only, used on the job type page) and no longer replays a stale `launchRequest` when it remounts.
- **Verified:** `tsc --noEmit` clean. Headless screenshots with real DB data (T1, T2, T2 `status=failed`, highlight deep link, Run again modal, L1): no page errors.
- **Not done:** Dependency map (`KIND_FLOW`) is hand-written from the stage order; the `/jobs/dates` API is now unused by the UI.

---

### 2026-10-31: Jobs L1 redesign (jobs-first layout) + summary API window/detail

- **Files:**
  - `src/lib/context/reads.ts` (`listJobKindSummaries` options `sinceDays`, `detail`, `recentLimit`)
  - `src/app/api/agent-lab/context/jobs/summary/route.ts` (`days`, `detail` params)
  - `src/lib/estate/cockpit.ts` (T0 recommendation wording)
  - `src/components/estate/JobsCockpitPanel.tsx` (compact Next step bar; coverage funnel behind Details)
  - `src/components/estate/ScannedObjectsTab.tsx` (`initialTier` prop)
  - `src/views/agent-lab/estate/jobs.tsx` (RunHealthBar, attention chips, JobStagesTable, per-row Run, `?range=` / `?tier=`)
  - `docs/jobs/current-status.md`
- **Why:** Coverage, stats and schedules sat above the jobs, so the job list started about 820px down. Stats had no time window and did not add up (cancelled/partial missing). Rows showed "Never run" (UI read `last_run_at`, API returns `last_finished_at`).
- **Before → after:**
  - Coverage funnel + recommendation card (~280px) → one-line Next step bar with coverage % chips; funnel under **Details** (remembered in localStorage).
  - Four stat tiles + attention box → one run-health bar with time window and deltas; attention chips only when needed.
  - Kind cards + schedules strip → stage table.
  - The job table now starts about 450px down at 1440×900.
- **Verified:**
  - `tsc --noEmit` clean. Summary SQL run against the real DB (~110 ms warm).
  - Headless Chromium screenshots with real DB data (auth/API stubbed): L1, Details expanded, stage click → `?tab=scanned&tier=t0`, L2 `?kind=t2_semantic`, `?range=30`, per-row Run opens the confirm modal with the kind preselected. No page errors.
- **Not done:** Not checked in a live signed-in session. Pre-existing `react-hooks/set-state-in-effect` lint errors remain. `docs/jobs/current-status.md` was accidentally deleted mid-session and restored from HEAD + the 2026-11-02 rows seen earlier in this session; any other uncommitted edits to it from another session would be lost — please diff-check.

---

### 2026-11-02: Estate identity and language overhaul (UI copy and layout only)

- **Files:**
  - `src/views/agent-lab/estate/jobs.tsx`
  - `src/components/estate/JobsCockpitPanel.tsx`
  - `src/lib/context/schedules.ts` (labels only)
  - `src/lib/estate/cron-label.ts` (+ test)
  - `src/lib/estate/stages.ts`
  - `EstateNav.tsx`, `nav-items.ts`, the overview, catalog, entities, lineage, mapper and silo views
  - estate components: SourceCard, CoverageBar, LifecycleBadge, EstateTable, EstateFilterBar, FilterBar, HarvestActionBar, facet trees, Pagination
  - `src/lib/breadcrumb-config.ts`
- **Why:** Users found the estate wording confusing (T0/T1/Harvested/Fargate jargon, raw cron strings, inconsistent headers).
- **Before → after:**
  - **Shared estate header:** a visible `h1` and a one-line description for each tab.
  - **One stage vocabulary:** Discovered, Scanned, Profiled, Described, Searchable.
  - **Readable schedules**, e.g. "Sundays at 03:00 UTC · next in 11h".
  - **Jobs tabs** are sentence case. The cockpit health strip is now a stage stepper.
  - **Fix:** the "Job types used" count only counts known kinds (it showed 13/9 before).
  - **Labels:** the schedule labels in `schedules.ts` have new names. No schedule IDs, cron values or filter values changed. No orchestrator, API or harvest behaviour changed.
- **Verified:**
  - `npm run web:typecheck` passes.
  - vitest passes for `src/lib/estate`, `src/components/estate` and `src/views/agent-lab` (15 files, 77 tests, plus 3 new cron cases).
  - A DOM sweep at 1366px and 390px found 1 `h1` per tab and no horizontal overflow; dark mode was checked.
- **Not done:** Recommendation text from the cockpit API still says "Run T0 →" (server copy).

---

### 2026-11-01: Estate UI pass (visual and a11y only)

- **Files:**
  - `src/views/agent-lab/estate/EstateNav.tsx`: segmented tabs; `sr-only` `h1` for catalog/jobs/mapper/silo
  - `src/views/agent-lab/estate/jobs.tsx`: larger hit areas on the chip remove button and the "View in Active Runs" link
  - `src/views/agent-lab/estate/entities.tsx`: lineage links get a larger hit area
  - `src/components/estate/*`: radius tokens
  - `docs/CHANGELOG.md`
- **Why:** UI redesign, batch 2.
- **Before → after:** Styling and accessibility only. No change to harvest, orchestrator or job behaviour, so `current-status.md` is unchanged.

---

### 2026-10-31 — Harvest pipeline cost audit (documentation only)

- **Files:** `docs/audits/performance-and-cost-optimization-report.md` (§7, Area D), `docs/CHANGELOG.md`, `docs/jobs/session-log.md`.
- **Why:** Platform-wide performance and cost audit. The harvest findings cover:
  - `npx tsx` start-up in `Dockerfile.harvester`
  - one Fargate task per child job
  - per-column Databricks profiling and OFFSET discovery in `databricks-adapter.ts`
  - full weekly T1 sweep
  - sequential and repair LLM calls in T2 `enrich.ts`
  - row-by-row embedding upserts
  - no Fargate Spot
- **Before → after:** No runtime behaviour change; `current-status.md` unchanged. Recommendations only (precompiled image, worker reuse, change-driven T1, batched profiling, T2 batching and caching, Spot).

---

### 2026-10-30 — Harvester LLM switched to LLM Lite Grok 4.7

- **Files:** `src/lib/context/harvest-llm.ts`, `src/lib/context/harvester-llm.ts`, `docs/CHANGELOG.md`, `docs/jobs/session-log.md`.
- **Why:** Direct Bedrock 5.5 models failed and user requested switching harvester LLM calls (T2 semantic, T3 usage, T4 cluster proposals, silo/mapping) to LLM Lite Grok 4.7 (`aws_bedrock/xAI-Grok-4.7`) by default.
- **Before → after:** `getHarvestLlmProvider()` defaults to `'llmlite'` and `getHarvestLlmModelId()` / `getContextHarvesterModelId()` resolve to `aws_bedrock/xAI-Grok-4.7` against `${LLMLITE_BASE_URL}/v1`.

---

### 2026-10-30 — Table-level Limit launch returned NO_OBJECTS_IN_SCOPE

- **Files:** `src/lib/context/queue.ts`, `src/lib/context/job-scope.ts`, `job-scope.test.ts`, `plan-split-scope.test.ts`, `docs/CHANGELOG.md`, `current-status.md`.
- **Why:** Continue pipeline for one Scanned table (`open_analytics_zone.ash_scratchpad.global_employee_master`) failed with 400 on `/jobs/launch`; `planSplit` only matched Limit globs at schema level, so a table path counted 0 objects.
- **Before → after:** Table-level Limit plans exactly the matching objects (T0 discovery and T1/T2/embed scanned), with matching names in split partitions; schema-level Limits unchanged.

---

### 2026-10-30 — Unscoped T1/T2 launch guard + job Objects scope filter

- **Files:** `job-ui.ts`, `jobs/launch/route.ts`, `enrich.ts`, `orchestrator.ts`, `jobs/[id]/objects/route.ts`, `EstateCatalogTab.tsx`, `job-scope-flags.ts`, tests, `CHANGELOG.md`.
- **Why:** Single-table Catalog Harvest queued T0 correctly, but separate Jobs launches (no Limit) ran T2 on 100+ objects; Objects tab showed unrelated tables in the job window.
- **Before → after:** Launch blocked (or API opt-in) when T1/T2/embed/T3 would touch >50 objects without Limit; chain copies Limit from DB parent; Objects tab respects Limit; Harvest toast says T0-only.

---

### 2026-10-30 — Estate inventory partial schema must not remove other schemas

- **Files:** `src/lib/context/estate.ts`, `estate-inventory-remove.test.ts`, `docs/CHANGELOG.md`.
- **Why:** Scoped `estate_inventory` on `open_analytics_zone.ash_scratchpad.*` reported `removed=1440` — other schemas in the same catalog soft-deleted.
- **Before → after:** Remove diff uses `schemasSeen` (`catalog.schema` upserted this run), not `catalogsSeen` alone.

---

### 2026-10-30 — Catalog Scanned: Continue pipeline button missing

- **Files:** `src/components/estate/ScannedObjectsTab.tsx`, `docs/CHANGELOG.md`.
- **Why:** Scope bar on Catalog → Scanned & Beyond showed T1 gaps but no **Continue pipeline**; Jobs embedded tab worked because it passed `canRunPipeline` from session.
- **Before → after:** Scanned tab resolves platform-admin access from session when prop omitted; run controls match Jobs scanned panel.

---

### 2026-10-29 — Auto-reap orphan active jobs (no Fargate task)

- **Files:** `orphan-jobs.ts`, `kick-queued-workers.ts`, `pipeline-intent.ts`, `jobs/launch/route.ts`.
- **Why:** User asked why overlap/zombie jobs are not handled automatically (`687b51c…`).
- **Before → after:** Launch API marks new rows **failed** when RunTask fails; after 10m without worker, reaper clears overlap blockers on intent/kick paths.

---

- **Files:** `JobRunPage.tsx`, `ActiveRunsPanel.tsx`, `job-ui.ts` (`canCancelJob`), `jobs/[id]/route.ts` DELETE.
- **Why:** User opened overlapping `t2_semantic` from Scanned banner; Job Run had Launch but no Cancel; job had no Fargate task.
- **Before → after:** Cancel on Job Run and Active Runs when no `fargate_task_id`; API cancels queued/running/orchestrating without a worker.

---

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
