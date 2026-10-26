# Estate Jobs — current status snapshot

**Last verified:** 2026-10-24 (code review; not re-run against production DB)  
**Owner workstream:** [README](./README.md) · Log sessions in [session-log.md](./session-log.md)

---

## 1. What Jobs is today

| Layer | Reality |
|-------|---------|
| **UI** | `Agent Lab → Estate → Jobs` — L1 kind cards → L2 dates → L3 runs; **Launch** opens a single modal (`jobs.tsx`) with exclude tree, Focus textarea, split preview. |
| **Control plane** | `POST /api/agent-lab/context/jobs/launch` enqueues `platform_context_jobs` and starts ECS Fargate (or local orchestrator). |
| **Workers** | `scripts/context/orchestrator.ts` claims jobs and calls `runT0Harvest`, `runT1Profile`, `runT2Enrich`, etc. |

**Operator intent we are moving toward:** Harvest **one schema per catalog** easily, run **only tiers that need work**, optional **overwrite** when necessary. **Incremental is preferred when we keep versions** (T1/T2 append profile/semantic versions); see [versioning-and-incremental.md](./versioning-and-incremental.md). **Today:** schema scope is possible via Focus globs but UX is confusing and first-time T0 is blocked by plan API (P0-3).

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
| **Modal Focus** | **No** — ignored (P1-11) |
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
| **Launch gate** | `planSplit` counts **Scanned** rows only → **blocks first harvest** on new schema (P0-3) |

### 3.3 `t1_profile`

| Aspect | Behavior |
|--------|----------|
| **Input** | Active `platform_context_objects` in scope |
| **Modal exclude tree** | Shown but **stripped at API** for T1 (P1-6) — use Focus |
| **Incremental** | **Weak** — profiles **all active objects** matching Focus/partition each run (no `last_t1_at` skip in runner) |
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
| **Scope** | **Full source** — Focus **not applied** (P1-2) |
| **Incremental** | Skips unchanged embed text when semantic card unchanged (P2-18) |

### 3.6 `t3_usage`

| Aspect | Behavior |
|--------|----------|
| **Scope** | **Full source** objects; Focus stored but **not applied** (P0-8) |
| **Matching** | Substring on `object_name` in SQL text (P0-7) |

---

## 4. Scoping controls (what actually works)

| Control | T0 | T1 | T2 | Inventory |
|---------|----|----|-----|-----------|
| `catalog.schema.*` Focus | ✅ runtime | ✅ | ✅ | ❌ |
| Exclude tree | ✅ | ❌ API | ❌ API | ✅ |
| `scope.path` on job from object APIs | ❌ runtime (P0-1) | ❌ | ❌ | — |
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
| `POST …/jobs/plan` | Split preview; `emptyScope` from Scanned count only |
| `POST …/jobs/launch` | `assertObjectsInScope` for T0/T1/T2; then enqueue + Fargate |
| `POST …/jobs/trigger` | Enqueue **only** — no worker (P1-9) |

Splittable kinds may create parent `orchestrating` + child `queued` rows with `partition_*` in scope.

---

## 6. Known gaps (blocking “easy schema harvest”)

| ID | Gap | Impact on schema-only harvest |
|----|-----|-------------------------------|
| **P0-3** | Plan/assert uses Scanned count for T0 | Cannot launch first T0 on schema from modal |
| **P0-1** | `scope.path` ignored | Object-page actions may run full source |
| **P1-1 / P1-20** | Confusing modal | Operators think tree “selects” schema; Focus separate |
| **P1-6** | Exclude tree on T1/T2 launch | Misleading when chaining kinds |
| **P1-2 / P0-8** | embed/T3 ignore Focus | Extra work outside schema after T2 |
| **T1 full re-profile** | No stale-only default | Running T1 on schema re-queries all tables |

**Planned UX/engineering:** [remediation charter](../audits/harvest-job-pipeline-remediation-charter.md) — include-tree, recommendations, `planEstateSplit`, `JobScope`, **Overwrite** toggles per tier.

---

## 7. Target behavior (not implemented — design intent)

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
| — | *(none in this workstream yet — log here when Phase 0 lands)* |

---

## 10. Document maintenance

When any row in §3–§6 becomes false, update this file and add [session-log.md](./session-log.md) + [CHANGELOG.md](../CHANGELOG.md) entries per [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md).
