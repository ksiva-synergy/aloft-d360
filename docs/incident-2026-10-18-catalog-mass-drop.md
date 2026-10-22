# Incident: 1,387 catalog objects wrongly marked `dropped` (2026-10-18)

| | |
|---|---|
| **Status** | Data restored, two of three code bugs fixed. Bug 1 (`scope.path` ignored) and the stalled harvest queue are still open. |
| **Detected** | 2026-10-20, when Workbench agent creation said `sire_report` was "not in the harvested catalog" |
| **Impact window** | 2026-10-18 18:36 UTC → 2026-10-20 (about 2 days) |
| **Source** | `b491f1d6-944e-42d7-855b-dbd392bd7a3e` — "Databricks Estate (verify-estate-1)", org `cmpm82n5x0000dj0cn3fo9pug` |
| **Offending job** | `410051c9-daa3-4386-8a21-a5bd94946db4` (`t0_structural`, `on_demand`, scope `null`), child of `1ca6e094-74d3-4c68-bd61-123b445108d6` |
| **Database** | aloft-prod-writer RDS (`platform_context_objects`) |

## Summary

A one-table harvest request from the Estate UI made the ECS harvester run a full-source structural sweep. The sweep listed only 1,000 tables and also treated every table outside the source's narrowed scope as deleted. It marked 1,387 active objects `dropped`, leaving exactly 1,000 active. Catalog search, `describe` and `relations` only return `active` objects. Workbench agents and Inspector therefore stopped seeing tables such as `landing_zone_dev.sire_2_0.sire_report`, although those tables still exist in Databricks. The Estate inventory (`platform_estate_objects`) still showed all of them as `active`.

No one deleted tables on purpose. The cause was a chain of three code defects plus a source configuration change.

## User-visible symptom

Workbench (agent creation for "inspections" → "does it include SIRE?" → "there is a table called sire report"):

> The harvested catalog does not include a table named `sire_report` … `open_analytics_zone.ash_scratchpad.sire_report` was checked and is not in the catalog.

The agent's answer was accurate for the catalog as stored. The catalog itself was wrong.

## Timeline (UTC)

| When | Event | Evidence |
|---|---|---|
| 2026-07-02 | Full T0 sweeps on source `b491…` saw 2,227 objects, including `landing_zone_dev.sire_2_0.*`. The last successful unscoped sweep was at 13:02. Those sweeps also dropped about 167 objects. | `platform_context_jobs.stats` (`objects_swept: 2227`, `dropped_objects: 75 / 94`) |
| 2026-07-15 | T2 semantic cards were generated for the SIRE 2.0 tables (`sire_report` at 04:46). | `platform_context_objects.last_t2_at` |
| 2026-07-02 → 2026-10-18 | The source's `scope_include` was narrowed to `["open_analytics_zone.*.*"]` **and** `last_sweep_at` was reset to `NULL`. | No app route changes `scope_include` on an existing source or nulls `last_sweep_at`. `audit_logs` has no row for this source, and no repo commit or agent session does it. Most likely a direct SQL edit or an external script. **Actor unknown.** |
| 2026-09-20 16:53 | Someone used Estate → **Harvest** on `curated_db.addressable_market.bi_competitor_historical_snapshot`. Job `1ca6e094` was enqueued with scope `{ "path": … }`. 34 more `{path}` jobs followed on 2026-09-28. | `platform_context_jobs` (no user id is stored for enqueued jobs) |
| 2026-09-20 → 2026-10-18 | The jobs sat `queued`; no harvester was consuming the queue. The ECS harvest runtime arrived in commit `1ace436` (2026-10-12). | Git history, job `started_at` |
| 2026-10-18 18:24:28 | Fargate task `ea53db94363f4481ba3a850167e9b4b6` claimed `1ca6e094` and dispatched child `410051c9` with **scope `null`**. | `stats.dispatched_to_job` |
| 2026-10-18 18:36:30 | `410051c9` finished: `is_full_sweep: true`, `objects_swept: 1000`, `queries_issued: 510`, **`dropped_objects: 1387`**. It then set `last_sweep_at`. | Job stats; 1,387 rows have `updated_at` in the 18:00 hour |
| 2026-10-18 18:38 | Harvest activity stopped. Two jobs remain `running` and 47–49 remain `queued`. | `platform_context_jobs` |
| 2026-10-20 | Detected through Workbench. Root cause identified, code fixed and data restored (see below). | This document |

## Root cause — how it got dropped

Four conditions had to line up:

1. **The orchestrator ignores `scope.path` (open bug).**
   - The Estate harvest route enqueues `t0_structural` with `{ path }` (`src/app/api/agent-lab/context/estate/harvest/route.ts`).
   - `scripts/context/orchestrator.ts` builds `runT0Harvest` options only from `includePatterns`, `excludeSchemas` and `partition_*`. `path` is dropped, so a one-table request harvests the **whole source**.
   - Present since the Estate port (`89ef59a`, 2026-07-10).
2. **`last_sweep_at = NULL` means "first run".**
   - In `runT0Harvest` (`src/lib/context/harvest.ts`), `isFirstRun = last_sweep_at === null || forceFullScan || hasIncludeOverride`.
   - A first run uses `resolveScope()` (full listing) and then runs the lifecycle drop pass.
   - Because the source's `last_sweep_at` had been reset, the stray full-source run was treated as a first sweep.
3. **The listing was silently truncated at 1,000 rows (fixed).**
   - `DatabricksAdapter.resolveScope()` queried `information_schema.tables` with no row limit, so `executeDatabricksSQL` applied `DATABRICKS_MAX_ROWS` (default 1000).
   - The sweep saw exactly 1,000 `open_analytics_zone` tables; the other 190 in that catalog (by the pre-restore count) were treated as deleted.
4. **The drop pass treated "not seen" as "deleted", even outside scope (fixed).**
   - The unscoped branch dropped every active object of the source missing from the harvested set.
   - With the scope narrowed to `open_analytics_zone.*.*`, every object in other catalogs was "not seen" and was dropped.
   - The scoped branch matched on bare schema names across catalogs.
   - Both branches compared against the budget-capped *harvested* set, not the resolved listing.

### Breakdown of the 1,554 dropped objects restored

1,387 were dropped by `410051c9` on 2026-10-18. The other 167 came from earlier sweeps (2026-07-02 and before) using the same drop-pass logic. Counts by catalog just before the restore:

| Catalog | Dropped | Likely cause |
|---|---:|---|
| `reporting_layer` | 582 | Outside narrowed scope (bug 4) |
| `curated_db` | 417 | Outside narrowed scope (bug 4) |
| `open_analytics_zone` | 190 | In scope but missing from the truncated listing (bug 3) |
| `landing_zone_dev` (incl. `sire_2_0.*`) | 133 | Outside narrowed scope (bug 4) |
| `samples` | 92 | Outside narrowed scope (bug 4) |
| `landing_zone` | 64 | Earlier drops (latest `updated_at` 2026-07-02) |
| `sm2_public` 20, `sap_prod` 18, `curated_db_dev` 15, `reporting_layer_dev` 10, `finance_db` 7, `system` 4, `synergymarine-export-prod` 2 | 76 | Outside narrowed scope (bug 4) |
| **Total** | **1,554** | All still `active` in `platform_estate_objects` |

The exact Oct-18 vs earlier split per catalog cannot be recovered. The restore rewrote `updated_at`, and `platform_job_logs` has no lines for `410051c9`.

## Who did it

- **The drop itself:** the automated ECS harvester (Fargate task `ea53db94…`), executing a queued `on_demand` job. No person ran a delete.
- **The originating request:** an Estate UI **Harvest** click on 2026-09-20. The user is not recorded, because `enqueue()` stores no actor.
- **The scope narrowing and `last_sweep_at` reset:** unknown. There is no audit row, no app code path, no commit and no recorded agent session. It was likely a manual DB edit or an out-of-repo script.

## Resolution (2026-10-20)

### Code

| File | Change |
|---|---|
| `src/lib/context/databricks-adapter.ts` | `resolveScope()` pages `information_schema.tables` (`ORDER BY … LIMIT 1000 OFFSET n`, explicit `rowLimit`). If a page fails, that catalog's refs are discarded, so a partial listing never reaches the drop pass. |
| `src/lib/context/scope-match.ts` | New pure `selectDroppedPaths()`. It drops only paths that are inside the sweep's include/exclude scope, in a `catalog.schema` that was actually listed, and absent from the resolved listing. |
| `src/lib/context/harvest.ts` | Both drop branches replaced with `selectDroppedPaths()` over the resolved refs. Updates are chunked by id and the step logs a drop-pass summary. |
| `src/lib/context/scope-match.test.ts` | 4 tests: narrowed scope, unlisted schema, empty listing, excludes. |

### Data (prod-writer, user-approved)

- `UPDATE platform_context_objects SET lifecycle='active'` for the **1,554** dropped objects whose `platform_estate_objects` row is `active`.
- Titan v2 embeddings were generated for **742** restored objects that had semantic cards (0 failed, 22 unchanged).
- Active objects went from 1,000 to **2,554**; Titan-embedded active objects went from 467 to **1,520**.

### Verification

- `vitest run src/lib/context` passes (10 tests).
- `tsc` shows only the existing `@radix-ui/react-switch` error.
- `describe_schema research "sire_report"` returns `landing_zone_dev.sire_2_0.sire_report` first (0.52), then `q88_report` and `classnk_report_metadata`.
- `describe` on `sire_report` returns its card ("one row per SIRE 2.0 questionnaire question per inspection report").

## Still open / follow-ups

| # | Item | Risk | Suggested fix |
|---|---|---|---|
| 1 | Orchestrator ignores `scope.path` (bug 1) | High. With `last_sweep_at` set again, the 49 queued `{path}` jobs (including `landing_zone_dev.sire_2_0.sire_report`, job `6da8ef2d…`) run in delta mode. They will likely **not** harvest the requested table. | In `scripts/context/orchestrator.ts`, map `scope.path` → `includePatterns: [path]`. |
| 2 | Harvest queue stalled | Medium. 2 jobs `running` since 2026-10-18 18:38 and 47–49 `queued`; nothing processed since. | Check the EventBridge schedule, ECS tasks on `aloft-agents-dev` and the `/ecs/aloft-context-harvester` logs. Reap the stale `running` jobs (`failStale`). |
| 3 | No audit trail | Medium. Source scope and `last_sweep_at` changes, and harvest enqueues, record no actor. | Write `audit_logs` rows on source updates and Estate harvest enqueues (actor, before/after). |
| 4 | Source scope is `open_analytics_zone.*.*` | Medium. Future full sweeps will not refresh restored tables in other catalogs (they are no longer dropped, but they will go stale). | Confirm the intended scope with the owner and widen it if `landing_zone_dev`, `reporting_layer`, `curated_db` etc. should be harvested. |
| 5 | Drop pass has no safety ratio | Low (after fixes). | Optionally abort the drop pass if it would drop more than X% of active objects in one run. |
| 6 | Job logs not persisted for `410051c9` | Low. | Ensure `platform_job_logs` is written for ECS runs. |

## Detection queries

```sql
-- Context objects dropped while Estate says they still exist
SELECT c.catalog_name, count(*)
FROM platform_context_objects c
JOIN platform_estate_objects e ON e.org_id = c.org_id AND e.full_path = c.full_path
WHERE c.lifecycle = 'dropped' AND e.lifecycle = 'active'
GROUP BY 1 ORDER BY 2 DESC;

-- T0 runs that dropped objects
SELECT id, started_at, stats->>'objects_swept' swept, stats->>'dropped_objects' dropped
FROM platform_context_jobs
WHERE job_kind = 't0_structural' AND (stats->>'dropped_objects')::int > 0
ORDER BY started_at DESC;
```
