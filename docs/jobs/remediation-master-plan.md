# Estate Jobs — master remediation plan (DET-2592)

**Status:** In progress (Phase 0 doc + Phase 1–3 partial in repo)  
**Goal:** One understandable ops experience + reliable schema pipeline (launch → worker → chain → honest UI)  
**Last updated:** 2026-10-28  

**Tracks this plan closes:**

| Track | Doc |
|-------|-----|
| Audit issues P0–P3 | [harvest-job-pipeline-issues.md](../audits/harvest-job-pipeline-issues.md) |
| Cockpit charter phases | [harvest-job-pipeline-remediation-charter.md](../audits/harvest-job-pipeline-remediation-charter.md) |
| Scanned Continue | [scanned-continue-pipeline-design.md](./scanned-continue-pipeline-design.md) |
| Ops desk / Active runs | [ops-console-gaps-and-vision.md](./ops-console-gaps-and-vision.md) |
| Living runtime truth | [current-status.md](./current-status.md) |

---

## 1. Executive summary

**Problem:** Operators cannot see all active harvest work in one place, cannot continue T1→T2→embed from Scanned without guessing job kinds, and lose trust when previews, tier chips, and chain follow-ups disagree with reality.

**Outcome:**

1. **Active runs** — single list of queued / running / orchestrating jobs (including children), with kick, cancel, retry, logs.  
2. **Continue pipeline** — from Scanned (and cockpit), run only stale tiers for selected schema(s).  
3. **Pipeline intent** — one server function drives recommendations, previews, and launch payloads.  
4. **Deploy + chain** — harvester image and ECS task def so T0→T1→T2→embed completes without relying on the web poller alone.  
5. **Charter UX** — guided launch wizard and include-first scope (replaces kind zoo + exclude-first modal over time).

**Sequencing:** Fix **chain reliability (Phase 0)** in parallel with **Active runs (Phase 1–2)** so operators are not blind while pipeline UX ships. **Continue from Scanned (Phase 3)** depends on **pipeline intent (Phase 1)**. **Full wizard (Phase 4)** can follow once intent + Active runs are stable.

**Explicit non-goals:** Inspector T4 port (P1-5), merging Automate runs into Estate Jobs (OPS-14), replacing Fargate.

---

## 2. Design principles (do not regress)

1. **One launch path** — `POST …/jobs/launch` (+ thin `pipeline/continue` wrapper); deprecate duplicate enqueue-only paths over time.  
2. **One scope model** — `JobScope` from UI → plan → launch → orchestrator → runners.  
3. **Stale-aware previews** — T1/T2 UI counts match worker skip logic.  
4. **Launch = worker** — or label “queue only.”  
5. **Fail loud, succeed honest** — EMPTY / failed, not green DONE with zero work.  
6. **Log every behavior change** — `session-log.md`, `CHANGELOG.md`, update `current-status.md`.

---

## 3. Phase 0 — Chain reliability & deploy (ops unblock)

**Theme:** Schema pipeline finishes T1→T2→embed after T0 without manual kick every time.

| # | Work | Closes | Owner |
|---|------|--------|-------|
| 0.1 | **Deploy** current web + **harvester image** + ECS task def (`infra/context/task-definition.json`, subnets, task role `RunTask` if needed) | Chain in Fargate | Eng/Ops |
| 0.2 | Verify orchestrator **in-process chain** when `RunTask` fails; document when web **`GET …/jobs/queued`** must stay up | Session log 2026-10-27 gap | Eng |
| 0.3 | Optional: enable **`--process-scheduled`** on harvester in ECS for scheduled schema drains | P2-15 partial | Ops |
| 0.4 | Runbook: stuck **running** → CloudWatch, `failStale`, DB job row, kick orphan | OPS-6 partial | Docs/Ops |

**Exit:** Re-run **Run pipeline now** on one schema in dev/prod; observe T0 succeeded → T1 running → T2 → embed without manual kick.

**Effort:** 1–3 days ops + verify (no large code if image already built).

---

## 4. Phase 1 — Backend “pipeline brain” & active jobs API

**Theme:** Server tells the UI what to run and what is active; previews become honest.

### 4.1 Pipeline intent

| # | Deliverable | Files (indicative) |
|---|-------------|-------------------|
| 1.1 | `computePipelineIntent(orgId, sourceId, scope)` — gaps, `recommendedKinds`, `sequential`, `staleEstimate`, `blockers` | `src/lib/estate/pipeline-intent.ts` |
| 1.2 | Scoped health SQL (reuse cockpit predicates + `includePatterns` / catalog / schema) | same + tests |
| 1.3 | `GET /api/agent-lab/context/pipeline/intent` | new route |
| 1.4 | Extend `GET …/jobs/cockpit` to accept optional scope query OR delegate to intent | `cockpit/route.ts` |

### 4.2 Honest plan API

| # | Deliverable | Closes |
|---|-------------|--------|
| 1.5 | Plan response: **`staleObjectCount`** for T1/T2 (same filter as `runT1Profile` / `runT2Enrich`) | P2-16, preview trust |
| 1.6 | `humanSummary` uses stale count for profile/enrich kinds | P1-1 partial |

### 4.3 Active jobs API

| # | Deliverable | Closes |
|---|-------------|--------|
| 1.7 | `listActiveJobs(orgId, { sourceId?, kind? })` — `status IN (queued, running, orchestrating)`, **include children** | OPS-1, OPS-2 |
| 1.8 | Enrich rows: `scope_summary`, `chain`, `child_counts` for parents, `source_name`, `is_stale` (running + `updated_at` / heartbeat) | OPS-4, OPS-6, OPS-12 |
| 1.9 | `GET /api/agent-lab/context/jobs/active` | OPS-1 |
| 1.10 | `findScopedLaunchConflict(patterns, kinds)` — generalize `findScopedHarvestConflict`; return 409 from launch/continue | scanned-design, OPS-11 |

### 4.4 Launch metadata

| # | Deliverable | Closes |
|---|-------------|--------|
| 1.11 | Stamp `scope.ui_surface` (`scanned_continue`, `cockpit`, `jobs_modal`, `catalog_pipeline`, …) on launch | OPS-11 |
| 1.12 | Optional `scope.pipeline_run_id` (UUID) for all jobs in one sequential chain | OPS-5 |

**Exit:** Vitest on intent + stale plan counts; API returns active jobs including queued children.

**Effort:** ~1–2 weeks eng.

---

## 5. Phase 2 — Active runs UI (one place to understand what is happening)

**Theme:** Operators live on **Active runs**, not kind → date archaeology.

| # | Deliverable | Closes |
|---|-------------|--------|
| 2.1 | Tab **Active runs** on `jobs.tsx` (feature flag ok) | OPS-1 |
| 2.2 | Table: status, kind, source, scope summary, progress (parent), updated, actions | OPS-4, OPS-12 |
| 2.3 | Actions: **View** (drawer), **Kick** (queued), **Cancel** (queued), **Logs** (task id), **Retry failed** (partial parent) | OPS-8, OPS-9 |
| 2.4 | Filters: source, kind, **Active / Failed / Partial** (failed/partial last 24h via `GET /jobs?status=`) | OPS-3, OPS-10 |
| 2.5 | **Stuck** styling when `is_stale`; link to ops runbook | OPS-6 |
| 2.6 | Button **Start waiting jobs** → explicit call to kick orphans (move logic off silent GET queued side effect optional) | OPS-2 |
| 2.7 | L1 **queued strip** links to Active runs filtered to queued | UX glue |

**Exit:** Operator finds queued T1 after T0, kicks from one screen, opens child logs without drilling T1 card → date.

**Effort:** ~1–1.5 weeks eng (after Phase 1.7–1.9).

---

## 6. Phase 3 — Scanned Continue pipeline & object UX

**Theme:** Finish pipeline from **Scanned & beyond** without T0 re-run or globs.

| # | Deliverable | Closes |
|---|-------------|--------|
| 3.1 | Facets API: per-schema **`needs_profile`, `needs_enrich`, `needs_embed`** | scanned-design §3 |
| 3.2 | Scanned **context bar** + **Continue pipeline** confirm sheet (calls intent + `jobs/launch` or `pipeline/continue`) | scanned-design |
| 3.3 | **`POST …/pipeline/continue`** wrapper (optional but recommended) | reliability |
| 3.4 | Rename/clarify catalog **Run full pipeline (from T0)** vs Continue | P1-20 partial |
| 3.5 | Tier strip: **gap labels** + filter **Needs profile** (fix `listScannedObjects` tier filter semantics) | tier confusion |
| 3.6 | **Active job banner** on Scanned when scope overlaps selection | OPS-7 |
| 3.7 | Multi-schema checkboxes on tree + capped confirm | scanned-design §3.2 |
| 3.8 | Multi-table Continue via path list in `includePatterns` | scanned-design |

**Exit:** UAT — one schema T0-only → Continue through enrich without Jobs modal; banner when job running.

**Effort:** ~1.5–2 weeks eng (after Phase 1 intent).

---

## 7. Phase 4 — Jobs cockpit & guided launch (charter Phase 2)

**Theme:** Replace confusing launch modal with intent-driven wizard; keep Advanced for power users.

| # | Deliverable | Closes |
|---|-------------|--------|
| 4.1 | 4-step wizard (intent → include tree → review → run) behind flag | P1-7, P1-8, P1-20, charter §2.2 |
| 4.2 | Include-first tree → `includePatterns`; Advanced glob editor | charter |
| 4.3 | Recommendations API scoped by source (+ optional schema) | charter §2.4 |
| 4.4 | Collapse **Advanced kinds** on L1; default path = cockpit + Continue | charter §2.1 |
| 4.5 | Copy table charter §2.3 (Discovery vs Scanned, Limit to, empty messages) | P3-1 |
| 4.6 | Run detail: plain scope sentence + technical JSON | charter §2.5 |

**Exit:** New operator scans one schema through enrich using wizard only (charter exit criteria).

**Effort:** ~2–3 weeks eng + design copy.

---

## 8. Phase 5 — Remaining audit items & hardening

**Theme:** Close partial P0/P1/P2; optional T4/T3 depth.

| ID | Work | Phase |
|----|------|-------|
| **P0-1** remainder | Migration/re-enqueue legacy jobs with raw `path` only; audit entry points still bypassing `resolveJobScope` | 5.1 |
| **P0-9** | Heartbeat on **outer** claimed job during long T0 split; parent stale monitor in Active runs | 5.2 |
| **P0-8 / P2-5** | T3 SQL pushdown when scope narrowed (warehouse pull still costly — document limits) | 5.3 |
| **P1-1 / P2-16** | Fully dual-label modal/wizard; single headline stale count | 4 + 1.5 |
| **P1-5** | T4 — keep disabled in UI until inspector port; or ship t4 handlers in prod | 5.4 (product call) |
| **P1-16** | Estate ↔ scanned link in list APIs / object drill | 5.5 |
| **P2-* ** | Charter Phase 3–4 items (schedules panel, debounce, embed skip reasons, inventory doc) | 5.6 backlog |
| **Entry points** | Unify `trigger`, object routes, catalog harvest → launch + `ui_surface` | 5.1 |

**Exit:** Audit §0 snapshot all **Fixed** or **Accepted partial** with doc; no P0 **Open**.

**Effort:** Ongoing; 2–4 weeks parallel to Phase 4.

---

## 9. Issue crosswalk (what “fix all” means)

### 9.1 OPS gaps → phases

| Gap | Phase |
|-----|-------|
| OPS-1 … OPS-6, OPS-8 … OPS-12 | 1–2 |
| OPS-7 | 3 |
| OPS-5 | 1.12 + 2 (display) |
| OPS-13 | 5.6 / charter Phase 3 |
| OPS-14 | Document boundary only |

### 9.2 Audit snapshot (2026-10-27) → phases

| Status today | Target phase |
|--------------|--------------|
| **Open** P1-5 T4 | 5.4 or defer |
| **Partial** P0-1, P0-8, P0-9, P1-1, P1-4, P1-7, P1-8, P1-10, P1-20, P2-5, P2-16 | 1, 3, 4, 5 |
| **Fixed** (verify deploy) | Phase 0 deploy sign-off |

### 9.3 DET-2592 Jira acceptance (rollup)

- [ ] Active runs tab + API  
- [ ] Continue pipeline from Scanned with stale tiers only  
- [ ] Pipeline intent drives cockpit + Continue + preview  
- [ ] Guided launch wizard (Phase 4)  
- [ ] Chain completes through embed on deploy  
- [ ] Issue register P0 none Open; partials documented  

---

## 10. PR bundles (recommended order)

| PR | Contents | Depends on |
|----|----------|------------|
| **PR-A** | Phase 0 deploy notes + verify chain in target env | — |
| **PR-B** | `pipeline-intent.ts`, tests, `GET pipeline/intent`, plan `staleObjectCount` | — |
| **PR-C** | `listActiveJobs`, `GET jobs/active`, launch conflict + `ui_surface` | PR-B |
| **PR-D** | Active runs tab UI | PR-C |
| **PR-E** | Scanned facets gaps + context bar + Continue + banner | PR-B, PR-D optional |
| **PR-F** | `POST pipeline/continue`, multi-schema select | PR-E |
| **PR-G** | Guided wizard (flagged) + copy pass | PR-B, PR-E |
| **PR-H** | P0-1 remainder, P0-9 heartbeat, entry point unification | PR-B |
| **PR-I** | T3 pushdown / schedules / P2 backlog slices | PR-H |

Keep PRs **reviewable** (~400–800 LOC each where possible).

---

## 11. Verification matrix

| Scenario | How to verify |
|----------|----------------|
| T0 done, 78 need T1 | Intent `recommendedKinds=['t1_profile']`, stale 78 |
| Continue from Scanned | One launch, no T0 job, T1 profiles stale rows |
| Chain T0→embed | Single schema, all tiers terminal, no orphaned queued |
| Active runs | Queued child visible; kick starts Fargate |
| Partial split | Retry failed relaunches children; parent orchestrating |
| Preview | Modal/wizard stale count = job stats objects_profiled ± skip |
| Double launch | 409 or UI disabled when overlap |
| failStale | Kill worker mid-run; job marked failed within 30m + Active runs stale badge |

Automate: vitest on intent, plan stale, conflict; optional Playwright on Jobs Active tab.

---

## 12. Roles & governance

| Role | Responsibility |
|------|----------------|
| **Product** | DET-2592 priority: Phase 0+2 before Phase 4 wizard; Accept T4 deferral |
| **Design** | Wizard flows, Active runs table, Scanned bar copy |
| **Eng** | PR bundles, tests, `current-status.md` after each merge |
| **Ops** | Phase 0 deploy, runbook, UAT on `curated_db` schema |
| **Agents** | [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md) on every session |

---

## 13. Timeline (rough, one squad)

| Weeks | Focus |
|-------|--------|
| 1 | Phase 0 deploy + PR-B intent/plan |
| 2 | PR-C/D Active runs |
| 3 | PR-E/F Scanned Continue |
| 4–5 | PR-G wizard + PR-H hardening |
| 6+ | PR-I P2/T3/T4 backlog |

Adjust if harvester deploy is blocked — **still ship PR-B/D** so ops visibility improves while chain is fixed.

---

## 14. Document history

| Date | Change |
|------|--------|
| 2026-10-28 | Master plan: phases 0–5, crosswalk, PR bundles, verification, timeline for DET-2592. |
