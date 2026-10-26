# Harvest jobs — remediation charter & cockpit UX plan

**Date:** 2026-10-24  
**Status:** Plan (not implemented)  
**Companion:** [harvest-job-pipeline-issues.md](./harvest-job-pipeline-issues.md) (issues register) · [estate-jobs.md](../estate-jobs.md) (current mental model)

---

## 1. Charter

### 1.1 Problem

Operators must run a **pipeline** (discover → scan → profile → enrich → embed → usage), but the product exposes **multiple registries**, **six launch entry points**, and a **launch modal** that mixes discovery counts, scanned counts, exclude-tree semantics, and a raw Focus textarea. The result feels like a **cockpit with mislabeled instruments**: valid actions are blocked (P0-3), dangerous actions succeed quietly (P0-1), and “green DONE” often means nothing ran (P1-4).

### 1.2 Vision — one Jobs cockpit

**Goal:** Agent Lab → Estate → Jobs becomes a **single, honest control room** where an operator can answer in under 10 seconds:

1. What stage is my data in? (Discovery / Scanned / Profiled / Enriched / Embedded / Usage)
2. What should I run next? (one primary recommendation, not 12 job kinds)
3. What exactly will this run touch? (catalogs, schemas, table count — one number, one source of truth per step)
4. Is it running, stuck, or done — and did it actually process objects?

**Schema-first + minimal work:** One action — **Harvest this schema** (`catalog.schema`) — runs only tiers that are stale; **Overwrite** is opt-in per tier (full T0 rescan, re-profile, re-enrich). Operator guide: [docs/jobs/schema-harvest-guide.md](../jobs/schema-harvest-guide.md). Living status: [docs/jobs/current-status.md](../jobs/current-status.md).

**Non-goals (this charter):** Replacing Fargate orchestration, rewriting the harvester in another language, or merging Estate and Inspector products.

### 1.3 Design principles

| Principle | Meaning for Jobs |
|-----------|------------------|
| **One registry per step** | UI never shows two different “object counts” without labeling which table they come from. |
| **Progressive disclosure** | Default = guided “Run pipeline”; Advanced = per-kind power user panel. |
| **Scope is visual** | Pick catalogs/schemas in the tree → generates Focus globs; no orphan textarea unless Advanced. |
| **Fail loud, succeed honest** | No `succeeded` on stubs; empty runs show **EMPTY** not **DONE** (extend P2-13). |
| **Same scope everywhere** | Object page, modal, orchestrator, and plan API share one `JobScope` type and one resolver. |
| **Launch = worker** | Any UI that enqueues harvest work must start a worker (fix P1-9) or say “queue only” explicitly. |

### 1.4 Success metrics

| Metric | Target |
|--------|--------|
| First-time T0 on a new schema without support | Launch succeeds from UI (P0-3 fixed) |
| Per-path reharvest runs only that table | 100% in e2e tests (P0-1) |
| Modal “objects affected” matches worker stats ±1% | Spot-check on 5 schemas |
| Operators who can name Discovery vs Scanned | >80% in internal UAT (P3-1) |
| Stub kinds visible in launch UI | 0 (P1-3, P1-4, P1-18) |

---

## 2. Target experience — Jobs cockpit (UX spec)

### 2.1 Page layout (replace “kind zoo” with pipeline strip)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Estate · Jobs                                    [Source: curated_db ▾] │
├─────────────────────────────────────────────────────────────────────────┤
│  PIPELINE HEALTH (read-only strip)                                       │
│  Discovery 12.4k → Scanned 8.1k → Profiled 7.9k → Enriched 2.1k → …     │
│  [gap: 4.3k not scanned yet]  [View gaps]                                │
├─────────────────────────────────────────────────────────────────────────┤
│  RECOMMENDED NEXT STEP                                                   │
│  “Run structural scan on 121 tables in 3 schemas”  [Configure] [Run]   │
├─────────────────────────────────────────────────────────────────────────┤
│  Tabs:  Runs  |  Scanned objects  |  Schedules  |  Advanced kinds       │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Pipeline strip** — counts from APIs keyed by stage (`estate/facets`, context coverage, job stats). Click a stage → Scanned tab filtered.
- **Recommended next step** — rules engine (see §2.4), not user picking `t4_scan` beside `mapping`.
- **Advanced kinds** — today’s multi-select + warnings; collapsed by default.

### 2.2 Launch flow — guided wizard (replaces single modal)

| Step | Title | User sees | Backend |
|------|--------|-----------|---------|
| **1. Intent** | What are you doing? | Cards: *Refresh discovery* · *Scan new schemas* · *Profile / enrich* · *Usage only* | Maps to kind set + default chain |
| **2. Scope** | Where? | **Include** tree (checkbox = include), search, “N tables in Databricks” | Builds `includePatterns` + `excludeSchemas` from selection |
| **3. Review** | What will run? | One headline count, tier breakdown, chunk/cost estimate, chain diagram T0→T1→T2→embed | `POST /jobs/plan` with **kind-aware registry** (§3.2) |
| **4. Run** | Confirm | Primary button: **Run on Fargate**; secondary: Save scope as preset | `POST /jobs/launch` |

**Remove / relocate:**

- Invert exclude-only tree → **include-first** for T0/inventory; “Exclude advanced” accordion.
- Raw Focus textarea → **Advanced → Edit globs** with validator + examples from selected nodes.
- Footer labels **“Focused scope”** → **“Limit: 3 schemas (122 tables)”**.

### 2.3 Copy & vocabulary (fix P3-1, P1-7, P1-8, P1-10)

| Old | New |
|-----|-----|
| Objects in scope | **In Databricks (discovery)** or **Already scanned** — always prefix |
| No objects in scope | **Nothing to {verb} at this stage** — e.g. “Nothing to profile yet (run scan first)” |
| Focus | **Limit to** (schemas/tables) |
| Sequential T0→T1→T2 | **Run pipeline in order** — list actual kinds including embed |
| Scanned & beyond | **Scanned tables** (subtitle: structural harvest complete) |

### 2.4 Recommendation rules (cockpit brain)

| Condition | Suggested action |
|-----------|------------------|
| Schema in discovery, 0 scanned rows | **Scan** (T0) on that schema |
| Scanned, no `last_t1_at` | **Profile** (T1) |
| Profiled, no `last_t2_at` | **Enrich** (T2) |
| Enriched, no embed | **Embed** |
| Operator opened object detail | Pre-fill scope to `catalog.schema.table` (P0-1) |

Expose as `GET /api/agent-lab/context/jobs/recommendations?sourceId=`.

### 2.5 Run detail — trustworthy status

- Parent row: progress bar `children_done / children_total`, not fake RUNNING without workers.
- **EMPTY** badge when primary metric = 0 (P2-13 + stubs).
- Scope panel: human sentence + “Technical scope” collapsible JSON.
- T3: explain **skipped** = no SQL text match (P1-13).

---

## 3. Engineering remediation — phased delivery

All issue IDs refer to [harvest-job-pipeline-issues.md](./harvest-job-pipeline-issues.md).

### Phase 0 — Unblock & stop the bleeding (1–2 weeks)

**Theme:** Operators can complete first-time T0; scope cannot silently widen to full source.

| Deliverable | Issues closed |
|-------------|----------------|
| `planEstateSplit()` + use for `t0_structural` / `estate_inventory` in plan + assert; T1/T2 keep `planSplit` on context objects | **P0-3**, **P1-1**, **P2-16**, **P2-17** (T0 path) |
| Modal: dual labels **Discovery** / **Scanned**; T0 `launchBlocked` only when discovery count = 0 | **P1-1**, **P1-20** (interim copy) |
| Orchestrator: `scope.path` → `includePatterns: [path]` (and partition if needed) | **P0-1** |
| `reharvest-all`: sequential chain T0→T1→T2 (+ optional embed), honor path | **P0-2**, **P2-11** (partial) |
| `runT0Harvest({ existingJobId })`; remove duplicate inventory job insert; heartbeat claimed job id | **P0-4**, **P0-5**, **P0-9** |
| Hide/disable launch for `mapping`, `knowledge_sync`, `t3_connected`, `t4_*` until real | **P1-3**, **P1-4**, **P1-5**, **P1-18** |
| Fix embed / TRIGGERABLE_JOBS copy | **P1-10** |

**Exit criteria:** Field-report scenario (§13 of issues doc) launches T0; object reharvest scoped to one table in integration test.

### Phase 1 — One scope model (2–3 weeks)

**Theme:** Same scope object from UI → API → orchestrator → runners.

| Deliverable | Issues closed |
|-------------|----------------|
| `JobScope` type: `sourceId`, `includePatterns`, `excludeSchemas`, `path?`, `chain?` | **P0-1**, **P1-14** |
| `resolveJobScope(kind, scope)` in `src/lib/context/` used by plan, launch, orchestrator, harvest, enrich, embed, usage | **P0-1**, **P1-6**, **P1-11** |
| Propagate Focus to `embed`, `runT3Usage`, T3 continuations | **P1-2**, **P0-8**, **P1-12** |
| T3: catalog.schema-qualified match instead of bare `object_name` | **P0-7** |
| `trigger` → launch worker OR deprecate + redirect HarvestActionBar to `launch` | **P1-9**, **P1-17** |
| `estate/harvest`, `refresh`, `enrich` routes use `resolveJobScope` | **P0-1** (remaining entry points) |

**Exit criteria:** Matrix in issues §8 true in automated tests; Focus on T2 run limits embed when chained.

### Phase 2 — Cockpit UI v1 (3–4 weeks)

**Theme:** Replace confusing modal with wizard + pipeline strip (§2).

| Deliverable | Issues closed |
|-------------|----------------|
| Pipeline health strip component + gaps API | **P3-1**, **P1-16** (surface link estate↔scanned) |
| Guided launch wizard (4 steps) behind feature flag | **P1-7**, **P1-8**, **P1-20**, **P2-16** |
| Include-tree → auto `includePatterns`; Advanced glob editor with validation | **P1-7** |
| Combined launch: hide exclude tree when T1/T2-only; show Focus-only helper text | **P1-6** |
| Recommendations API + “Next step” card | New (supports cockpit) |
| Align `JobRunPage` / drawer with wizard scope summary | UX consistency |

**Exit criteria:** UAT script: new operator scans 1 schema through enrich without reading docs.

### Phase 3 — Orchestration & ops hardening (2–3 weeks)

**Theme:** Chains, splits, and schedules behave predictably.

| Deliverable | Issues closed |
|-------------|----------------|
| Chain policy on `partial` (config: advance with warning vs stop) + UI message | **P0-6** |
| Wire `knowledge_sync` orchestrator to lib (or remove from UI) | **P1-19** |
| `advanceChain` / split: document + test matrix | **P2-9** |
| `claimNext` kind filter parameterized query | **P2-10** |
| Schedules panel: show scope (full source) vs ad-hoc runs | **P2-15** |
| T3: history window filters by scope; continuation retains Focus | **P2-4**, **P2-5**, **P1-12** |
| Focused T0: UI warning on drop pass; doc `last_sweep_at` behavior | **P2-1**, **P2-2** |
| Auto-exclude large catalogs: explain in UI + override | **P2-12** |

### Phase 4 — Quality & edge cases (ongoing)

| Deliverable | Issues closed |
|-------------|----------------|
| Multi-source org: source picker on launch + plan per source | **P1-14** |
| Per-object debounce scoped to object/path | **P1-15** |
| Embed skip reasons in job stats + UI | **P2-18** |
| T2 re-enrich without re-T1: explicit “force re-profile” action | **P2-14** |
| Lineage / T3 caps surfaced in run summary | **P2-6**, **P2-19** |
| Inventory soft-remove semantics in operator doc | **P2-20** |
| `silo_scan` / `recompute_entity_tags` single entry path | **P2-7**, **P2-8** |
| In-app glossary tooltips (P3-2–P3-4) | **P3-2**, **P3-3**, **P3-4** |

---

## 4. Issue coverage checklist

Every registered issue is assigned above. Quick reference:

| Tier | IDs | Phase |
|------|-----|-------|
| P0 | P0-1 … P0-9 | 0–1 |
| P1 | P1-1 … P1-20 | 0–4 |
| P2 | P2-1 … P2-20 | 1–4 |
| P3 | P3-1 … P3-4 | 2, 4 (UX/docs) |

---

## 5. Technical anchors (Phase 0–1)

### 5.1 Kind-aware plan API

```text
POST /jobs/plan { kind, sourceId, excludeSchemas, includePatterns }

t0_structural | estate_inventory → count platform_estate_objects (active)
t1_profile | t2_semantic          → count platform_context_objects (active, tier filters)
embed | t3_usage                  → dedicated estimators (rows + cost hints)
```

Return payload extension:

```json
{
  "registry": "estate" | "scanned",
  "discoveryObjects": 121,
  "scannedObjects": 0,
  "totalObjects": 121,
  "emptyScope": false,
  "humanSummary": "121 tables in Databricks will be scanned"
}
```

### 5.2 Shared module layout (proposed)

```text
src/lib/context/job-scope.ts      # JobScope, resolveJobScope, pathToPattern
src/lib/context/plan-estate.ts    # planEstateSplit (mirror planSplit API)
src/lib/estate/pipeline-health.ts # stage counts for cockpit strip
src/components/estate/launch/     # wizard steps (extract from jobs.tsx)
```

### 5.3 Test plan (minimum)

| Test | Covers |
|------|--------|
| Plan T0: estate count > 0, scanned = 0 → not emptyScope | P0-3 |
| Launch T0 with Focus glob → worker scope matches | P0-3, P1-7 |
| Orchestrator job with `path` → single table harvested | P0-1 |
| reharvest-all → T1 starts after T0 child succeeds | P0-2 |
| Chain T0→T1→T2→embed on partial T1 → policy behavior | P0-6 |
| Stub kinds not in launch dropdown snapshot | P1-4 |

---

## 6. Governance

| Role | Responsibility |
|------|----------------|
| **Eng lead** | Phase ordering, PR bundles per §3 |
| **Design** | Wizard flows, pipeline strip, copy table §2.3 |
| **Ops** | UAT on real `curated_db` schemas; sign-off on metrics §1.4 |
| **Docs** | Update `estate-jobs.md` when Phase 2 ships; keep issues register status column |

**PR bundle order (recommended):**

1. Phase 0 backend (P0-3, P0-1, P0-4/5/9, P0-2)  
2. Phase 0 UI labels + hide broken kinds  
3. Phase 1 scope resolver + T3/embed  
4. Phase 2 cockpit UI (flagged)  

---

## 7. Document history

| Date | Change |
|------|--------|
| 2026-10-24 | Initial charter: vision, cockpit UX spec, 4 engineering phases, full issue mapping, technical anchors. |
