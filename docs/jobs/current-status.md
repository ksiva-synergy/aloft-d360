# Estate Jobs — current status snapshot

**Last verified:** 2026-10-29 (pipeline RBAC: platform admin only for run/trigger; chain deploy still pending)  
**Owner workstream:** [README](./README.md) · Log sessions in [session-log.md](./session-log.md) · **Issue IDs:** audit §0 (Fixed/Partial/Open)

---

## 1. What Jobs is today

| Layer | Reality |
|-------|---------|
| **UI** | `Agent Lab → Estate → Jobs` — L1 **Job Types**, **Scanned Objects**, **Active Runs**. **Run / Continue / kick / cancel / harvest / schedule** controls visible only for **`platform_admin`**; other roles see status and catalogs view-only. Catalog **Run full pipeline (from T0)** same rule. |
| **Control plane** | `POST …/jobs/launch` (409 overlap, `pipeline_run_id` on sequential chains), `GET …/pipeline/intent`, `POST …/pipeline/continue`, `GET …/jobs/active`, **`POST …/jobs/kick-queued`**. Scoped **`GET …/jobs/cockpit`**. Plan API **staleObjectCount** + honest T1/T2 summaries. |
| **Workers** | `scripts/context/orchestrator.ts` … **Deploy/runbook:** [phase-0-chain-deploy.md](./phase-0-chain-deploy.md). |

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
| **Incremental** | Skips unchanged embed text when semantic card unchanged (P2-18) |

### 3.6 `t3_usage`

| Aspect | Behavior |
|--------|----------|
| **Scope** | **Limit + exclude tree** on context objects (P0-8 partial fix 2026-10-26); query history still workspace-wide (P2-5) |
| **Matching** | Substring on `object_name` in SQL text (P0-7) |

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

Splittable kinds may create parent `orchestrating` + child `queued` rows with `partition_*` in scope.

---

## 6. Known gaps (blocking “easy schema harvest”)

| ID | Gap | Impact on schema-only harvest |
|----|-----|-------------------------------|
| **Chain follow-up** | Harvester container cannot `RunTask` (no `ECS_SUBNET_IDS` / task-role ECS permission). Next tier is enqueued and stays `queued` until the **web** process launches it, or until a harvester image with in-process continuation is deployed. | Schema pipeline stops after the tier the web launched (seen: T0 done, T1 queued) |
| **P1-1 / P1-20** | Full 4-step intent wizard | Cockpit strip + recommendations + include-tree mode shipped; intent cards not shipped |
| **P2-5** | T3 SQL scope | Schema `LIKE` pushdown when Limit/excludes narrow scope; post-filter still applies |
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
| 2026-10-30 | Table-level Limit (`catalog.schema.table`) plans the matching objects at launch — previously 0 → `NO_OBJECTS_IN_SCOPE` for Continue pipeline / Jobs on a single table |
| 2026-10-27 | Catalog pipeline includes **embed**; orphaned chain jobs are launched from the web; orchestrator continues in-process when follow-up `RunTask` fails (needs harvester image deploy) |
| 2026-10-27 | Catalog **Run pipeline now** + **Run scheduled now**; source harvest/inventory/refresh **launch workers**; Jobs **re-run flags**; `POST …/estate/run-scheduled` |
| 2026-10-26 | Scope batch (T1/T2 excludes, embed/T3 scope, T0 live launch); **P1-11** inventory Limit; **P1-14** source picker; **T1 stale-only**; **P1-19** knowledge_sync |
| 2026-10-26 | **P0-3** … (Phase 0 bundle — see prior session log) |

---

## 10. Document maintenance

When any row in §3–§6 becomes false, update this file and add [session-log.md](./session-log.md) + [CHANGELOG.md](../CHANGELOG.md) entries per [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md).
