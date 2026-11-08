# Estate Jobs — current status snapshot

**Last verified:** 2026-11-06 (Data Estate section access: admins view only, members and read-only users have no access, every estate action is platform-admin only — code and unit tests only, not browser-checked). Previously 2026-11-05 (harvest warehouse calls name a service principal role, `metadata` or `profile`; falls back to the default SP until roles are configured — code and unit tests only). Previously 2026-11-03 (T1 row count no longer stores the sample window; `table_detail` on profile stats; object page jobs + refresh — code and unit tests only, not run against live data). Previously 2026-11-02 (T3/T4 scope: T4 honors Limit; T3 window, query history, and lineage stay on in-scope tables; Scanned bar names tables missing from the business model. Continue still stops at Embed). Previously 2026-11-05 (Continue "Scanned tables only" option: scanned-only scope resolution, max 50 tables; see session-log). Previously 2026-11-01 (Jobs audit fixes: embed batching, heartbeat-based reaper, cancelled/partial status, windowed summary counts, org-scoped T0 drop pass; Continue pipeline: always-on scoped source change check + cascade chain + preview; T0 no-op rescans keep `last_t0_at`; identical T1 profile keeps T2 current; embed staleness vs latest card). Previously 2026-10-31 (Jobs L1 redesign + summary API `days` / `detail`; pipeline RBAC unchanged: platform admin only for run/trigger; chain deploy still pending)  
**Owner workstream:** [README](./README.md) · Log sessions in [session-log.md](./session-log.md) · **Issue IDs:** audit §0 (Fixed/Partial/Open)

---

## 1. What Jobs is today

| Layer | Reality |
|-------|---------|
| **Server-side access** | (security assessment F7, see [SECURITY-ASSESSMENT.md](../security/SECURITY-ASSESSMENT.md)) Every route that launches, refreshes or rescopes harvest work requires **`platform_admin`** (`denyUnlessEstatePipelineOperator`): `context/sources` POST, `sources/[id]` PATCH/POST, `sources/[id]/{harvest,refresh,inventory}`, `objects/[id]/{refresh,reharvest-all}`, `silo/scan`, `mappings/run`, `process`, `estate/{sync-knowledge,scan-coverage}`. `objects/[id]/enrich` requires **Manage on Catalog** (platform admins only, since 2026-11-06; admin before) and the live **job log stream** (`jobs/[id]/logs`) requires **View on Jobs** (admins and platform admins). **Since 2026-11-06 (section access, `src/lib/sections`):** every estate read API (`estate`, `estate/facets`, `estate/preview-columns`, `estate-briefing`, `data-score`, `jobs*` GETs, `pipeline/intent`, `objects*` GETs, `sources*` GETs, `mappings*` GETs, `silo/links` GET) needs **View** on its estate section, which admins and platform admins have and members and read-only users do not (403). `objects` GET is also open to anyone who can manage Agents (workbench datasource picker). `objects/[id]/{confirm-semantic,resolve-pii}`, `mappings/[id]` PATCH and `silo/links/[id]` PATCH were open to any signed-in user and are now **platform admin only**. |
| **UI** | `Agent Lab → Estate → Jobs` — L1 tabs **Job types**, **Health**, **Scanned objects**, **Active runs** (Health added 2026-11-03; relabelled 2026-11-02; the UI shows plain stage names Discovered → Scanned (T0) → Profiled (T1) → Described (T2) → Searchable (embed), job groups Discover / Scan / Profile, describe & index / Usage & lineage / Business model / Publish & connect, and schedules as readable cron, e.g. "Sundays at 03:00 UTC"). **Run / Continue / kick / cancel / harvest / schedule** controls visible only for **`platform_admin`**. Since 2026-11-06 admins see the whole estate view-only (banner "View only…"; Scan now, Check coverage, Refresh profiles, Reharvest, Count rows, Promote, Trust advance, Resolve PII, mapping and silo confirm/reject, Retry failed are hidden or disabled), and members and read-only users cannot open the Data Estate (hidden from the sidebar; the page explains why). Catalog **Run full pipeline (from T0)** same rule. Job types tab layout (2026-11-03): one-line **health strip** (headline, affected job types, success % · runs · failed for 24h/7d/30d/All via `?range=`, **View health**), then the stage **table** (last 14 runs, success % for the selected window with run count, typical time, last finished as relative time with **overdue** flag when a schedule was missed, schedule ("On demand" when unscheduled or schedule switched off), per-row Run on hover; single-line rows, descriptions only as tooltips; advanced job types needing attention stay visible when the advanced section is collapsed; cancelled runs drawn hollow). **Health tab** (`?tab=health`, dot on the tab when something needs attention): status headline + 24h/7d/30d/All switch; KPI tiles (success rate vs previous period, runs, objects processed, time spent running); left column **Runs per day** (per hour for 24h) stacked chart, **Reliability by job type** (least reliable first), **Recent failures** (first error line, opens the run drawer); right column **Needs attention**, **Coming up** (next automatic runs + manual schedules), **Suggested next step** with the estate coverage funnel (open by default, stages link to Scanned objects). "All" uses the last 30 days of runs for the chart, failures and totals. **Job type page** (`?kind=<kind>`, replaces the old per-date L2/L3 drill-down): header (stage, health badge Healthy / Failing / Needs attention / Running / Never run, schedule + next run, Run button), **Last run** card (status, duration, results, trigger, scope, error excerpt, Retry failed chunks for split parents or Run again), **Recent runs** chart (last 60 runs, bar height = duration, colour = status; success %, typical time, objects/run, runs in 7 days), pipeline context (upstream/downstream job types with last status; coverage % for T0/T1/T2/embed linking to Scanned objects), and **All runs** table (status filter `?status=`, time range `?since=1|7|30`, single day `?date=YYYY-MM-DD`, paging, chunk expand, row click opens the run drawer; polls every 10s while runs are active). `?highlight=<jobId>` now works from any page: it opens that job type and the run drawer. |
| **Control plane** | `POST …/jobs/launch` (409 overlap, `pipeline_run_id` on sequential chains), `GET …/pipeline/intent`, `POST …/pipeline/continue`, `GET …/jobs/active`, **`POST …/jobs/kick-queued`**. Scoped **`GET …/jobs/cockpit`**. Plan API **staleObjectCount** + honest T1/T2 summaries. |
| **Workers** | `scripts/context/orchestrator.ts` … **Deploy/runbook:** [phase-0-chain-deploy.md](./phase-0-chain-deploy.md). |
| **Warehouse identity** (2026-11-05) | `DatabricksAdapter` runs structure, inventory, query history and lineage as the **`metadata`** service principal role, and T1 profiles, sample rows and exact row counts as **`profile`**. Until a role has its own SP (`platform_databricks_credentials`), both use the connection's default SP, as before. Setup: [databricks-auth-and-usage.md](../databricks-auth-and-usage.md) §7.1. |

**Operator intent we are moving toward:** Harvest **one schema per catalog** easily, run **only tiers that need work**, optional **overwrite** when necessary. **Incremental is preferred when we keep versions** (T1/T2 append profile/semantic versions); see [versioning-and-incremental.md](./versioning-and-incremental.md). **Embeddings “inactive” / mass catalog loss:** [embeddings-lifecycle-and-drops.md](./embeddings-lifecycle-and-drops.md) (usually **`lifecycle: dropped`** on objects, not deleted vectors). **Stale skips and launch paths:** [redundancy-and-skip-behavior.md](./redundancy-and-skip-behavior.md). **Today:** first-time T0 on a focused schema can launch when discovery has rows (P0-3 fixed); modal still uses exclude-tree + Limit textarea (wizard not shipped).

---

## 2. Data registries (two different “object counts”)

| Name in UI/docs | Table | Created by |
|-----------------|-------|------------|
| **Discovery / inventory** | `platform_estate_objects` | `estate_inventory` |
| **Scanned / context** | `platform_context_objects` | `t0_structural` |

T1/T2/embed read **Scanned** only. The launch modal can show **Discovery** counts and **Scanned** plan counts at the same time without clear labels (P1-1).

---

## 3. Per-tier behavior today (incremental vs full)

### 3.1 `estate_inventory`

| Aspect | Behavior |
|--------|----------|
| **Input** | Databricks metadata for source `scope_include` / `scope_exclude` |
| **Modal exclude tree** | Yes |
| **Modal Focus** | **Yes** — Limit globs + exclude tree (P1-11 fixed) |
| **Incremental** | Re-run refreshes discovery; soft-removes unseen rows per catalog rules (P2-20) |
| **Overwrite** | N/A |

### 3.2 `t0_structural` (structural scan)

| Aspect | Behavior |
|--------|----------|
| **Scope** | Source scope + modal `excludeSchemas` + optional Focus `includePatterns` (overrides `scope_include`) |
| **First run / Focus / `forceFullScan`** | `resolveScope` — full listing for in-scope paths |
| **Subsequent run (no Focus)** | `detectChanges` since `last_sweep_at` — **delta** only |
| **`last_t0_at`** | Advanced **only** when the object is new/re-activated, its source `last_altered` moved forward, or its structure (kind, comment, column name/type/nullability/comment) changed (2026-11-01). Unchanged rescans keep it, so T1+ are not marked stale. Job stat `objects_changed`. |
| **Focus side effect** | Treated like first run for that subset; may run drop pass within listed schemas (P2-1); may skip updating global `last_sweep_at` (P2-2) |
| **`forceFullScan`** | Supported in `runT0Harvest` opts; **not exposed in Jobs UI** |
| **Launch gate** | T0 plan/assert uses **discovery** (`planEstateSplit`); T1/T2 still use **Scanned** (`planSplit`) |

### 3.3 `t1_profile`

| Aspect | Behavior |
|--------|----------|
| **Input** | Active `platform_context_objects` in scope |
| **Modal exclude tree** | **Honored at plan/launch** (P1-6 fixed 2026-10-26); Limit still overrides when set |
| **Incremental** | **Stale-only default** — skips objects where `last_t1_at >= last_t0_at`; opt-in `forceReprofile` for full re-run |
| **Overwrite** | Re-run re-profiles and **appends** a new `platform_context_profiles.version` (history kept) |
| **Unchanged profile** | If the new stats equal the previous version (ignoring `query_count`, `table_detail` etc.) and T2 was current, `last_t2_at` is carried forward → no re-describe (2026-11-01). Job stat `objects_unchanged`. |
| **Row count** | Sampled profiles count rows inside the LIMIT window. When that count fills the window (e.g. 5,000 for a table over 1 GB) `row_count_est` is now stored as **null**, not the window size (2026-11-03). Rows profiled before this fix still hold the window count until re-profiled; the object page shows them as "5K+ · not counted". |
| **Exact rows (Delta)** | T1 runs one `SELECT COUNT(*)` on Delta tables (answered from transaction-log stats) when at least 2 statements of budget remain, saved as `stats.row_count_exact` and written to `row_count_est` (2026-11-04). Views / non-Delta tables skip it. |
| **Table detail** | `DESCRIBE DETAIL` format, partition / clustering columns, file count, created / last-modified are kept on the profile stats as `table_detail` (2026-11-03). No schema change. |

### 3.4 `t2_semantic`

| Aspect | Behavior |
|--------|----------|
| **Input** | Objects with `last_t1_at` set |
| **Incremental** | **Yes** — only where `last_t2_at` is null or `last_t2_at < last_t1_at` (P2-14 if re-T2 without re-T1) |
| **Overwrite** | Re-T1 then T2, or future explicit “force re-enrich” → new `platform_context_semantics.version` per object |

### 3.5 `embed`

| Aspect | Behavior |
|--------|----------|
| **Scope** | **Limit + exclude tree** from job scope (P1-2 fixed 2026-10-26) |
| **Incremental** | Skips unchanged embed text when semantic card unchanged (P2-18); skipped vectors get `created_at` refreshed so they count as current |
| **Stale = ** | No embedding, or embedding `created_at` older than the latest `platform_context_semantics` row. The Searchable color counts only current embeddings. **N need searchable** is the rest (missing or stale) and opens that list. Those two numbers add up to the scanned set (2026-11-05). |
| **Empty scope** | No in-scope objects → no-op (previously fell back to every column in the source) |

### 3.6 `t3_usage`

| Aspect | Behavior |
|--------|----------|
| **Scope** | **Limit + exclude tree** on context objects. With a Limit, the time window is `MAX(last_t3_at)` of those objects (not the source). Query history uses a table `LIKE` when the list is ≤40 tables, otherwise `catalog.schema.`. Lineage is an exact full-name filter up to 200 tables, otherwise a schema prefix. |
| **Matching** | Statement text must contain `catalog.schema.table` or `schema.table` (backticks ignored). A bare table name does not match. |

### 3.7 Continue pipeline (Catalog → Scanned → selection → **Continue pipeline**)

1. **Always** runs a scoped, metadata-only change check (`checkScopeChanges`): per catalog in scope, one `information_schema.tables` listing with `last_altered`, compared per table with stored `source_altered_at` → changed / new / removed / unknown / unchanged. If the listing fails, it returns 502 `CHANGE_CHECK_FAILED` and nothing launches.
2. Chain = earliest stale stage → **every** downstream stage through Embed (`buildContinueChain`). Scan runs first only if the check found something.
3. Each stage re-selects its own stale tables when it starts (T1: t1<t0, T2: t2<t1, embed: missing/older than card).
4. The UI shows a preview (source check + "up to N" per stage) before **Run** → `jobs/launch` with `sequential: true`.
5. When T0–Embed are current, open **Continue**, select **T3 · Linked** and/or **T4 · In model**, then **Run** (same Limit). T0–Embed checkboxes still cascade only when stale.

### 3.8 `t4_scan`

| Aspect | Behavior |
|--------|----------|
| **Scope** | `includePatterns` and `excludeSchemas` on the job (including `scope.path`) filter eligible tables before clustering. No Limit still means every T2-complete table on the source whose T4 is missing or older than T2. |
| **Output** | Candidate entities, joins, dimensions, and measures on the Auto-Bootstrap Model. Joins only connect tables inside the same cluster. |

---

## 4. Scoping controls (what actually works)

| Control | T0 | T1 | T2 | Inventory |
|---------|----|----|-----|-----------|
| `catalog.schema.*` Focus | ✅ runtime | ✅ | ✅ | ❌ |
| Exclude tree | ✅ | ✅ | ✅ | ✅ |
| `scope.path` on job from object APIs | ✅ via `includePatterns` (refresh/enrich/reharvest-all/estate harvest); **change_detect** fixed 2026-10-26 | ✅ | ✅ | — |
| T0 exclude-only, 0 discovery rows in kept schemas | ✅ **liveScopeLaunch** (2026-10-26) | — | — | — |
| Per-schema easy button in UI | ❌ (manual Focus) | ❌ | ❌ | ❌ |

**Canonical single-schema pattern (today):**

```text
includePatterns: ["<catalog>.<schema>.*"]
```

Example: `curated_db.db_smac_prod_navitasai_crewing_dashboard_public.*`

---

## 5. Launch & plan APIs (current)

| Endpoint | Role |
|----------|------|
| `POST …/jobs/plan` | Split preview; T0 uses discovery count; T1/T2 use Scanned; returns `registry`, `discoveryObjects`, `scannedObjects` |
| `POST …/jobs/launch` | `assertObjectsInScope` for T0/T1/T2; then enqueue + Fargate. Sequential mode launches **only the first kind**; the worker enqueues the rest via `scope.chain`. |
| Catalog **Run pipeline now** | Kinds `t0_structural` → `t1_profile` → `t2_semantic` → `embed`, Limit `catalog.schema.*` |
| `GET …/jobs/queued` | Also starts a worker for top-level queued jobs with no task id (chain follow-ups the harvester could not launch) |
| `POST …/jobs/trigger` | Enqueue + **launch worker** (P1-9 fixed) |
| `GET …/jobs/cockpit` | Pipeline health + recommendation |
| `GET …/jobs/summary` | Per-kind counts. Optional `days=N` (window for total/succeeded/failed; running/queued never windowed; `running` includes `orchestrating`) and `detail=true` (partial/cancelled/other, `last_status`, `median_duration_s`, previous-window `prev_*`, `recent[]` = last 14 top-level runs). No params = original shape (catalog-refresh poller). |

Splittable kinds may create parent `orchestrating` + child `queued` rows with `partition_*` in scope.

---

## 6. Known gaps (blocking “easy schema harvest”)

| ID | Gap | Impact on schema-only harvest |
|----|-----|-------------------------------|
| **Chain follow-up** | Harvester container cannot `RunTask` (no `ECS_SUBNET_IDS` / task-role ECS permission). Next tier is enqueued and stays `queued` until the **web** process launches it, or until a harvester image with in-process continuation is deployed. The Catalog banner path (`pipeline-intent.ts`) reaps queued follow-ups after 10 minutes without kicking them first. | Schema pipeline stops after the tier the web launched (seen: T0 done, T1 queued, then reaped) |
| **Schedules unverified** | Daily change check, Weekly re-profile and Weekly re-discovery are now labelled `manual` in `schedules.ts` (were `live`), because no EventBridge rule was confirmed (no AWS credentials in the audit session). The DB has no scheduled change_detect/profile runs after 2026-10-18. Switch back to `live` after `aws events list-rules --name-prefix aloft-` confirms the rules. | The UI no longer claims a weekly cadence; no automatic runs until verified |
| **Stale profiles (backfilled)** | 1,695 objects were stale only because a T0 rescan ran after their last T1 profile while the source was unchanged. One-off backfill set `last_t1_at = last_t0_at` for exactly those rows (`source_altered_at <= last_t1_at`). No profile data was changed. 1,022 objects still need a real T1 profile (source changed or never profiled). | None for the 1,695; the 1,022 are genuine work |
| **P1-1 / P1-20** | Full 4-step intent wizard | Cockpit strip + recommendations + include-tree mode shipped; intent cards not shipped |
| **P2-5** | T3 SQL scope | Table `LIKE` when ≤40 objects; schema `LIKE` above that. Lineage exact-match up to 200 tables. Post-filter still applies |
| **P1-16** | Estate ↔ scanned link | `context_object_id` set on T0 upsert (join in list API still works for legacy rows) |
| **Re-run flags** | Jobs modal checkboxes: full T0 listing, re-profile all, re-enrich all (append versions) | Not on Catalog bar (use Jobs for flags) |

**Planned UX/engineering:** [remediation charter](../audits/harvest-job-pipeline-remediation-charter.md) — include-tree wizard, recommendations API, honest preview copy. **Scanned Continue pipeline (design):** [scanned-continue-pipeline-design.md](./scanned-continue-pipeline-design.md). **Ops / Active runs (design):** [ops-console-gaps-and-vision.md](./ops-console-gaps-and-vision.md). **Master fix plan (phases 0–5):** [remediation-master-plan.md](./remediation-master-plan.md).

---

## 7. Target behavior (partial — Continue + Active Runs shipped)

| Capability | Status |
|------------|--------|
| **Active runs desk** | **Partial** — kind filter, failed/partial 24h, retry failed, queued deep-link; source filter not yet |
| **Continue pipeline from Scanned** | **Partial** — confirm sheet; multi-schema (≤12) and multi-table (≤50) Continue |
| **UI** | … **Guided launch** wizard on L1 (default on; `NEXT_PUBLIC_JOBS_LAUNCH_WIZARD=false` to hide); advanced kind cards collapsed under **Advanced job types**. |
| **Harvest this schema (wizard)** | **Partial (flagged)** — 4-step wizard; discovery include-tree still via classic modal |

Documented so agents do not implement the wrong default.

| Capability | Target |
|------------|--------|
| **Harvest this schema** | One click on catalog tree → runs **minimum** tier(s): inventory gap → T0 → T1 → T2 only if stale |
| **Overwrite** | Optional per step: “Full structural rescan”, “Re-profile all”, “Re-enrich all” |
| **No unnecessary tiers** | Do not enqueue embed/T3 when user only asked for structural scan |
| **Honest preview** | “Will touch 42 tables in Databricks” vs “Will update 12 already-scanned tables” |

---

## 8. Entry points fragmentation

See issues register §9. **Prefer** `POST …/jobs/launch` for operator flows until `trigger` and object routes are unified (Phase 1 charter).

---

## 9. Recently fixed

| Date | Item |
|------|------|
| 2026-11-05 | **Searchable count:** the Searchable color is current embeddings only. "N need searchable" is the missing or stale remainder, and it filters the Scanned list to those tables. |
| 2026-11-03 | **Object page + T1 data:** sampled T1 no longer writes the sample window as `row_count_est`; `table_detail` kept on profile stats. Trusted score counts only profiles with a real change (was every re-profile). Object page Recent Jobs now finds jobs queued from the page (`scope.includePatterns`), and the page refreshes after an action and while a job runs. |
| 2026-11-02 | **T3/T4 scope:** `t4_scan` keeps the job Limit; scoped T3 uses in-scope `last_t3_at`, table-level history SQL, and lineage limited to those tables. Scanned Continue copy names tables missing from the business model and still does not launch T3/T4. |
| 2026-11-01 | **Jobs audit fixes:** embed id lookups chunked at 5,000 (fixes Postgres 32,767 bind-parameter failure on large embeds); web reaper uses worker heartbeat (`updated_at`) instead of creation time; `cancelled` status shown (was "queued"); `partial` amber in drawer and runs panel; kind filter lists every job kind; summary `queued`/`running` counts windowed; child counts include `cancelled`; T0 drop pass scoped by org. |
| 2026-11-02 | Jobs UI copy only: stage vocabulary, sentence-case tabs, readable schedules (`describeCron`), `Job types used` count limited to known kinds, schedule labels renamed (Daily change check, Weekly re-profile, Weekly re-discovery, Usage & lineage, Business model draft). No orchestrator or API change. |
| 2026-10-31 | Jobs L1 redesign (jobs-first): compact Next step bar, run-health bar with time window + attention chips, stage table with run history and per-row Run; schedules strip and stat tiles removed. Fixed rows showing "Never run" (UI read `last_run_at`; API returns `last_finished_at`). |
| 2026-10-31 | Dedicated job type page (`?kind=`) replaces the date-group (L2) and per-date run list (L3) views; descriptions removed from the Job types table. Fixed `?highlight=<jobId>` links (from the harvest action bar), which only worked on L3. UI only; `/jobs/dates` API is no longer called by the page but is unchanged. |
| 2026-10-30 | Table-level Limit (`catalog.schema.table`) plans the matching objects at launch — previously 0 → `NO_OBJECTS_IN_SCOPE` for Continue pipeline / Jobs on a single table |
| 2026-10-27 | Catalog pipeline includes **embed**; orphaned chain jobs are launched from the web; orchestrator continues in-process when follow-up `RunTask` fails (needs harvester image deploy) |
| 2026-10-27 | Catalog **Run pipeline now** + **Run scheduled now**; source harvest/inventory/refresh **launch workers**; Jobs **re-run flags**; `POST …/estate/run-scheduled` |
| 2026-10-26 | Scope batch (T1/T2 excludes, embed/T3 scope, T0 live launch); **P1-11** inventory Limit; **P1-14** source picker; **T1 stale-only**; **P1-19** knowledge_sync |
| 2026-10-26 | **P0-3** … (Phase 0 bundle — see prior session log) |

---

## 10. Document maintenance

When any row in §3–§6 becomes false, update this file and add [session-log.md](./session-log.md) + [CHANGELOG.md](../CHANGELOG.md) entries per [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md).
