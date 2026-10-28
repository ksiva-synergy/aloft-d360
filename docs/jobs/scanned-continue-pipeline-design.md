# Scanned & beyond — Continue pipeline (design)

**Status:** Design / not implemented (target for DET-2592 and Estate Jobs UX)  
**Audience:** Product, operators, engineers  
**Last updated:** 2026-10-28  

**Related:**

- [current-status.md](./current-status.md) — how jobs behave today  
- [schema-harvest-guide.md](./schema-harvest-guide.md) — operator playbook for one schema (today’s manual steps)  
- [harvest-job-pipeline-remediation-charter.md](../audits/harvest-job-pipeline-remediation-charter.md) — Jobs cockpit vision  
- Jira **DET-2592** — Estate pipeline reliability and UI redesign  

---

## 1. Problem

Operators often land on **Agent Lab → Estate → Jobs → Scanned & beyond** with tables that **finished T0 (structural scan)** but not **T1 (profile), T2 (semantic), or embed**. The UI shows tier chips (e.g. T0: 78, T1: 0) but:

- Chips count **completed** tiers, not **gaps** (“needs profile”).
- **Run pipeline now** on the catalog bar always starts at **T0**, even when only T1→T2→embed is needed.
- Row **Harvest selected** (discovery catalog) enqueues **T0 only**, not continue tiers.
- Launch and plan APIs can show **all scanned objects in scope**, while workers **skip fresh** T1/T2 rows — preview feels wrong.
- Chain follow-up (T1 queued after T0) can stall without a worker — operational, but looks like “pipeline stopped.”

**Goal:** From Scanned, an operator selects **schema(s) or table(s)**, sees **what is left**, and runs **Continue pipeline** (minimum stale tiers only) with an honest preview — without job-kind jargon or hand-typed globs.

---

## 2. Concepts

### 2.1 Two registries (unchanged)

| Term | Table | Meaning |
|------|--------|---------|
| **Discovery** | `platform_estate_objects` | Exists in Databricks metadata |
| **Scanned** | `platform_context_objects` | Structural harvest done (`last_t0_at`); T1/T2/embed read this |

Scanned & beyond lists **Scanned** objects only (`last_t0_at IS NOT NULL`).

### 2.2 Per-table pipeline state

```text
DISCOVERED → (T0) → SCANNED → (T1) → PROFILED → (T2) → ENRICHED → (embed) → EMBEDDED
```

**Stale rules (match workers today):**

| Tier | Run when |
|------|----------|
| **T1** | `last_t1_at IS NULL` OR `last_t0_at IS NULL` OR `last_t1_at < last_t0_at` |
| **T2** | `last_t2_at IS NULL` OR `last_t1_at IS NULL` OR `last_t2_at < last_t1_at` |
| **Embed** | No object-level embedding row (see `SQL_OBJECT_HAS_EMBEDDING`) |

Overwrite flags (`forceReprofile`, `forceReEnrich`, `forceFullScan`) bypass stale skips — **Advanced only**, never default on Continue.

### 2.3 Scope patterns

| Selection | `includePatterns` |
|-----------|-------------------|
| One schema | `catalog.schema.*` |
| Several schemas | `['cat.s1.*', 'cat.s2.*', …]` |
| Specific tables | Full paths `catalog.schema.table` (one pattern per path) |

Patterns are matched with minimatch on **full path** (`catalog.schema.table`). See `src/lib/context/scope-match.ts` and `matchesPatterns` in `harvest.ts` / `enrich.ts`.

---

## 3. Operator experience (target)

### 3.1 Two primary actions

| Action | When to use | What runs |
|--------|-------------|-----------|
| **Continue pipeline** | Tables already **scanned**; gaps in T1/T2/embed | Minimum **stale** tiers for selection only |
| **Run full pipeline** | Discovery gap or deliberate re-run from T0 | T0 → T1 → T2 → embed (catalog bar today: **Run pipeline now**) |

Default on **Scanned** should be **Continue**, not full pipeline.

### 3.1 Context bar (scoped to tree + optional row selection)

Example when one schema is selected:

```text
Scope: curated_db.db_smac_prod_navitasai_masters_crewing
78 scanned · 78 need profile · 0 need enrich · 0 need embed

[ Continue pipeline ]   [ Advanced ▾ ]
```

**Continue** opens a confirm sheet:

- Tiers to run (T1, T2, embed) — pre-checked from server **intent**.
- **Work estimate:** “Up to 78 tables will be profiled (0 skipped as already fresh).”
- Collapsible technical scope (`includePatterns`, sequential chain).

**Advanced:** force re-profile, re-enrich, full T0 rescan; optional T3 with source-wide warning.

### 3.2 Multi-select

| Selection unit | Primary use | Launch scope |
|----------------|-------------|--------------|
| **Schemas** (tree checkboxes) | Bulk catch-up across schemas | Union of `catalog.schema.*` |
| **Tables** (grid checkboxes) | Fixes, one-off re-run | List of full paths |

Cap very large runs (confirm dialog if table count or schema count exceeds threshold).

### 3.3 Vocabulary changes (UI copy)

| Today | Target |
|-------|--------|
| Tier chip **T0: N** (completed) | **Scanned N** + separate **Needs profile M** |
| Tier filter “T1” = has T1, not T2 | **Gap: needs profile** / **Gap: needs enrich** |
| “No objects in scope” | **Nothing to profile yet — run a scan first** (when appropriate) |

### 3.4 Active job banner

When a job overlaps the current scope (`queued` / `running`):

```text
T1 profile running (job …) · T2 queued — [ View run ]
```

Disable **Continue** or require Advanced override to avoid duplicate warehouse load.

---

## 4. Server design — pipeline intent (“one brain”)

All surfaces (Scanned bar, Jobs cockpit, catalog) should call the same logic:

```text
computePipelineIntent(orgId, sourceId, scope) → PipelineIntent
```

### 4.1 Inputs

- `sourceId` (required for launch)
- `includePatterns[]` and/or `catalog` + `schema` (normalized to patterns)
- Optional `excludeSchemas[]`

### 4.2 Outputs

| Field | Purpose |
|-------|---------|
| `gaps` | Counts: `needsT0`, `needsT1`, `needsT2`, `needsEmbed` (in scope) |
| `completed` | Progress counts per tier |
| `recommendedKinds` | e.g. `['t1_profile']` or `['t1_profile','t2_semantic','embed']` |
| `sequential` | `true` when multiple kinds |
| `includePatterns` | Normalized globs for launch |
| `humanSummary` | Operator-facing one-liner |
| `staleEstimate` | Tables that **will** be touched (matches worker stale filter) |
| `blockers` | No scanned rows, overlapping active job, nothing stale to do |

### 4.3 Recommendation order (scoped)

1. Discovery in scope, not scanned → `estate_inventory` / `t0_structural` (full pipeline intent only when user asks for full run).
2. `needsT1 > 0` → start at `t1_profile`.
3. Else `needsT2 > 0` → `t2_semantic`.
4. Else `needsEmbed > 0` → `embed`.
5. Else → idle (“All fresh through selected tiers”).

Same rules as `getJobRecommendations` in `src/lib/estate/cockpit.ts`, but filtered by scope SQL — not source-wide only.

### 4.4 Proposed APIs

| Method | Path | Role |
|--------|------|------|
| GET | `/api/agent-lab/context/pipeline/intent` | Query: `sourceId`, `catalog`, `schema`, `includePatterns` → `PipelineIntent` |
| GET | `/api/agent-lab/context/objects/scanned/facets` | **Extend:** per-schema `needs_profile`, `needs_enrich`, `needs_embed` |
| POST | `/api/agent-lab/context/pipeline/continue` | Optional wrapper: intent → validate → `POST …/jobs/launch` |
| POST | `/api/agent-lab/context/jobs/plan` | **Extend:** `staleObjectCount` for T1/T2 (or `estimateMode: stale`) |

**Launch remains** `POST /api/agent-lab/context/jobs/launch` with:

```json
{
  "sourceId": "...",
  "kinds": ["t1_profile"],
  "includePatterns": ["curated_db.my_schema.*"],
  "excludeSchemas": [],
  "sequential": true,
  "forceReprofile": false
}
```

Do **not** use `POST …/estate/harvest` for Continue — that path enqueues **T0 only** per table path.

### 4.5 Suggested module layout

```text
src/lib/estate/pipeline-intent.ts   # computePipelineIntent, scoped health SQL
src/lib/estate/pipeline-health-scoped.ts  # optional split from cockpit.ts
```

---

## 5. Reliability and safety

### 5.1 What Continue should **not** break

- **Data:** T1/T2 append versions; no destructive schema drops on profile/enrich.
- **Scope:** Workers honor `includePatterns` for T1/T2/embed (see [current-status.md](./current-status.md)).
- **Incremental:** Default stale-only T1/T2 — no `force*` flags on Continue.

### 5.2 Risks to mitigate in implementation

| Risk | Mitigation |
|------|------------|
| Plan count ≠ work done | UI shows **staleEstimate** from intent, not only `plan.totalObjects` |
| Parallel T1+T2 | Always `sequential: true` when chain length > 1 |
| Duplicate jobs | Generalize `findScopedHarvestConflict` (`enqueue-and-launch.ts`) to pattern overlap; 409 + job id |
| Chain stuck **queued** | Banner + link to Runs; ops: web poller / harvester deploy (see session log 2026-10-27) |
| Misleading **succeeded** with 0 work | Disable Continue when `staleEstimate === 0`; show EMPTY in job UI (`skipped_stale` in T1 stats) |
| **forceFullScan** on focused T0 | Advanced only; document drop-pass edge cases (P2-1) |
| **T3** on schema selection | Never default; warn source-wide SQL history |

### 5.3 Impact analysis summary

Running **T1 → T2 → embed** from Scanned with correct `includePatterns` and without overwrite flags is **aligned with existing workers** and does **not** corrupt estate/context rows. Pain points are **ops and trust** (chain queue, preview mismatch, tier chip semantics), not structural data loss.

---

## 6. Implementation phases

| Phase | Deliverable | Operator value |
|-------|-------------|----------------|
| **1** | Scoped intent API + gap columns on scanned facets | See what’s left per schema |
| **2** | Scanned context bar + **Continue** → confirm → `jobs/launch` | Run T1+ without Jobs modal |
| **3** | Stale-aware plan / preview copy | Trustworthy counts |
| **4** | Multi-schema tree select + launch conflict detection | Bulk catch-up |
| **5** | Relabel tier chips + gap filters | Less confusion |
| **6** | `POST pipeline/continue` + active-job banner | Single launch path, visible chains |

**Feature flag (suggested):** `estate.scannedContinuePipeline` until chain behavior is verified in target environment.

**Smallest first PR:**

1. `computePipelineIntent` + `GET pipeline/intent`.
2. Facets: per-schema `needs_profile` / `needs_enrich`.
3. Scanned tab: bar + Continue for single schema when `needs_profile > 0` → launch T1 with `catalog.schema.*`.

---

## 7. Testing

| Test | Assert |
|------|--------|
| Intent, schema with 78 scanned, 0 T1 | `recommendedKinds = ['t1_profile']`, `staleEstimate = 78` |
| Intent, all profiled, stale T2 | starts at `t2_semantic` |
| Launch Continue body | `includePatterns`, `sequential`, no `forceFullScan` |
| Overlap | 409 when T1 running on same pattern |
| Plan / intent | Stale count matches `runT1Profile` filter predicate |

---

## 8. Acceptance criteria (DET-2592 alignment)

- [ ] Operator selects one schema on Scanned, sees **need profile** count, launches **Continue** without typing a glob.
- [ ] **Continue** does not enqueue T0 when all selected tables have `last_t0_at`.
- [ ] Confirm sheet shows **stale** table estimate, not all scanned rows when they differ.
- [ ] Multi-schema selection builds multiple `includePatterns` in one launch.
- [ ] Active overlapping job blocks or warns before second launch.
- [ ] Full pipeline from T0 remains available separately (**Run full pipeline** / catalog bar), not conflated with Continue.
- [ ] Documentation updated in [session-log.md](./session-log.md) when behavior ships.

---

## 9. Out of scope (this design)

- Replacing Fargate orchestration or rewriting the harvester.
- Merging Discovery and Scanned into one registry.
- Default **T3 usage** on schema Continue.
- Second enqueue path that bypasses `jobs/launch`.

---

## 10. Document history

| Date | Change |
|------|--------|
| 2026-10-28 | Initial design: problem, operator UX, pipeline intent API, reliability, phases, tests, DET-2592 criteria. |
