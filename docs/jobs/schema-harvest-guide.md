# Harvest one schema (catalog.schema)

**Goal:** Touch **only** one schema in one catalog — no full-source harvest unless you explicitly choose overwrite.

**Status:** Scope pattern works at **runtime** for T0/T1/T2; **launch modal may block** first-time T0 (see [current-status.md](./current-status.md) P0-3). This guide describes **correct scope** and **what to run**; UI improvements are in the [remediation charter](../audits/harvest-job-pipeline-remediation-charter.md).

---

## 1. Naming

Use the exact names from **Estate → Jobs → launch modal** tree (discovery facets):

```text
<catalog>.<schema>.*
```

Examples:

```text
curated_db.db_smac_prod_navitasai_crewing_dashboard_public.*
curated_db.my_schema.*
```

- **Catalog** = first segment (`curated_db`).  
- **Schema** = second segment (long Unity Catalog schema name).  
- **`*`** or **`.*`** at the end = all tables in that schema (both usually work with minimatch).

**Do not** rely on the exclude tree alone to “select” a schema — it only **excludes**. To limit to one schema, use **Focus** (today) or clear excludes and set a single include pattern.

---

## 2. What to run (minimum necessary)

Use this order. Skip steps that are already satisfied.

| Step | Job kind | Run when | Skip when |
|------|----------|----------|-----------|
| 0 | *(optional)* `estate_inventory` | Schema not visible in discovery tree | Already in discovery |
| 1 | `t0_structural` | No rows in **Scanned** for this schema | All tables scanned (`last_t0_at` set) and delta sufficient |
| 2 | `t1_profile` | Scanned but need stats / drift | Only if you accept stale profiles *(today T1 re-profiles all in scope)* |
| 3 | `t2_semantic` | `last_t2_at` missing or older than `last_t1_at` | Already enriched after last profile |
| 4 | `embed` | Need vectors for search | **Today runs wider than Focus** (P1-2) — avoid unless needed |
| 5 | `t3_usage` | Need query-history usage | **Today is source-wide** (P0-8) — avoid for schema-only |

**Recommended chain for one schema (modal):**

1. Select **T0 Structural** only first time.  
2. Confirm tables under **Scanned & beyond** tab filtered by schema.  
3. Run **T1** with the **same** Focus glob.  
4. Run **T2** with the same Focus — only stale tables are enriched.  
5. Add **embed** only if you need embeddings; expect possible extra tables until P1-2 is fixed.

**Sequential toggle:** When launching T0 + T1 + T2 together, enable **Run sequentially** so T1 does not start before T0 finishes.

---

## 3. Incremental vs overwrite

**Product rule:** Incremental is good **when we keep a version** — T1 and T2 append new profile/semantic versions on each run; skipping (T2 default) keeps the latest version. Details: [versioning-and-incremental.md](./versioning-and-incremental.md).

| Tier | Default (incremental) | When you need overwrite |
|------|------------------------|-------------------------|
| **T0** | Delta via `detectChanges` after first full sweep | New schema: Focus forces full resolve for that schema. Full source rescan: `forceFullScan` in code only (UI not wired). *No version chain — current structural row only.* |
| **T1** | *Not skip-by-default* — re-run re-profiles all tables in Focus → **new profile version** each time | When columns/types changed or you need fresh drift in history |
| **T2** | Only objects where enrich is stale vs T1 → **new semantic card version** when run | After schema change: run T1 first, then T2; or future “re-enrich all” |
| **embed** | Skips unchanged text when possible | Force re-embed (future UI) |

**Operator rule:** If unsure, run **T0 → check Scanned → T1 → T2** with the **same** `catalog.schema.*` Focus; do not add embed/T3 for a structural-only task.

---

## 4. Launch modal checklist (today)

1. Job kinds: only what you need (avoid selecting embed/T3 for schema scan).  
2. **Focus:** one line `catalog.schema.*`.  
3. **Exclude tree:** leave other schemas excluded or reset — do not assume checks “select” scope.  
4. Read split preview: if **0 scanned** but discovery has tables → P0-3 (blocked); see [current-status.md](./current-status.md).  
5. **Launch** starts Fargate; use job detail **logs** for child tasks.

---

## 5. After run — verify

| Check | Where |
|-------|--------|
| Tables exist as Scanned | Jobs → **Scanned & beyond** |
| T0 stats | Job row `objects_swept` (watch for duplicate job rows P0-4) |
| T1/T2 progress | Child jobs under parent if split |
| Wrong scope (whole source) | Job `scope` JSON — should list `includePatterns` with your schema |

---

## 6. Future UI (charter)

- **Harvest this schema** action on facet row → builds Focus + runs minimum tier.  
- **Overwrite** checkboxes: full T0 rescan, re-profile all, re-enrich all.  
- Plan API uses **Discovery** count for T0 so first launch is never blocked.

Track implementation in [session-log.md](./session-log.md).
