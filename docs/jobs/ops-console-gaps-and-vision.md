# Estate Jobs — operations console (today, gaps, target)

**Status:** Today’s UI documented; **Active runs** / unified ops desk **not built**  
**Audience:** Operators, support, engineers  
**Last updated:** 2026-10-28  

**Related:**

- [../estate-jobs.md](../estate-jobs.md) — UI map and APIs  
- [scanned-continue-pipeline-design.md](./scanned-continue-pipeline-design.md) — Continue pipeline + Scanned banner (planned)  
- [current-status.md](./current-status.md) — runtime behavior and known gaps  
- [../audits/harvest-job-pipeline-issues.md](../audits/harvest-job-pipeline-issues.md) — issue register (P0–P3)  

---

## 1. Vision — one place to understand what is happening

Operators should open **one screen** and answer within seconds:

1. **What is running or waiting?** (all kinds, including split chunks and chain follow-ups)  
2. **What failed or is stuck?** (failed, partial, running too long, queued with no worker)  
3. **What scope does each run touch?** (source, `includePatterns`, chain)  
4. **What can I do?** (kick, cancel, retry failed chunks, open logs, jump to Scanned objects)

**Target name (product):** **Active runs** — a tab or panel on **Agent Lab → Estate → Jobs**, backed by a single API that lists non-terminal jobs across the org/source, not buried under kind → date.

---

## 2. Where to go today (before Active runs exists)

**Path:** **Agent Lab → Estate → Jobs → Job Types** (not the Scanned tab).

| Step | What to look at |
|------|------------------|
| 1 | **Pipeline health / Recommended next step** (cockpit strip at top) |
| 2 | **Aggregate stats** — **Active** = running + queued (all kinds, parent rows only in rollup) |
| 3 | **Queued strip** — top-level **queued** jobs; **×** cancels a queued job |
| 4 | **Kind card** with “N running” / “N queued” → pick **today’s date (L2)** → **run list (L3)** |
| 5 | Click a run → **drawer** or **Open full page** (`/agent-lab/estate/jobs/{id}`) |

**Scanned & beyond** shows **objects** (T0/T1 dots), not the job queue. Launching from catalog does not replace monitoring runs here.

### 2.1 When something is wrong

| Symptom | What to do |
|---------|------------|
| Job **queued**, never starts | Open run → **Launch** (kick). Stay on Jobs page (polls `GET …/jobs/queued`, which can **kick orphaned** chain jobs). |
| **Split parent** orchestrating; chunks failed | Open parent → **Child jobs** → **Retry failed** |
| **Queued** job you do not want | L1 queued chip **×** or cancel via API |
| **Kick** returns 409 | Job is not `queued` (e.g. parent **orchestrating**, already **running**) — open **child** rows for kick/logs |
| **Succeeded** but 0 objects | Check **EMPTY** / stats; read child logs for empty partition |
| **Running** for hours | Worker may be dead; orchestrator **`failStale(30)`** marks stale **running** as failed on next worker start — **no UI button** today. Check ECS `/ecs/aloft-context-harvester` logs. |
| T0 done, **T1 queued** forever | Chain follow-up / worker launch gap — see [current-status.md](./current-status.md) §6 |

### 2.2 APIs (support / scripts)

| Action | Method |
|--------|--------|
| List top-level queued | `GET /api/agent-lab/context/jobs/queued` |
| List runs (filterable) | `GET /api/agent-lab/context/jobs?kind=&status=&after=&before=` |
| Kick one queued job | `POST /api/agent-lab/context/jobs/{id}/kick` |
| Retry failed chunks | `POST /api/agent-lab/context/jobs/{id}/retry-failed` |
| Cancel queued | `DELETE /api/agent-lab/context/jobs/{id}` |
| Logs | `GET /api/agent-lab/context/jobs/{id}/logs` (needs child `fargate_task_id`) |

---

## 3. Gap register — operations & visibility

These are **additional** to the harvest pipeline issue register; focused on **“understand and manage runs in one place.”**

| ID | Gap | Impact | Target fix |
|----|-----|--------|------------|
| **OPS-1** | **No unified Active runs view** — must drill **kind → UTC day → list** | Easy to miss queued T1/T2 after T0; no cross-kind picture | **Active runs** tab: `status IN (queued, running, orchestrating)` all kinds, sort by `updated_at` |
| **OPS-2** | **L1 queued strip** uses `listQueuedJobs` — **top-level only** (`parent_job_id IS NULL`) | Child chunks queued but invisible on L1 | Active runs includes **all** queued/running rows, or parent row + “12 children queued” |
| **OPS-3** | **`GET /jobs?status=`** exists; **L3 UI never filters** by status | Cannot show “today’s failures” in one click | Status chips on Active runs: Failed / Partial / Active |
| **OPS-4** | **Parent `orchestrating`** has no Fargate task; looks “idle” on card | Operators think nothing is running while children work | Parent row shows **child progress** (running/queued/failed counts) on list and L1 |
| **OPS-5** | **Chain jobs** (T0 → T1 → T2 → embed) not shown as one **pipeline run** | Hard to see “where the pipeline stopped” | Optional **run group id** in scope + UI timeline |
| **OPS-6** | **Stuck `running`** — `failStale` only in worker; **no operator reap** | Jobs sit running until orchestrator starts | Active runs: “No heartbeat &gt; 30m” badge + optional **Mark failed** (admin) |
| **OPS-7** | **Scanned tab** has no link to jobs affecting current schema | Context switch Jobs ↔ Scanned | **Active job banner** on Scanned (see scanned-continue-pipeline-design) |
| **OPS-8** | **Logs** only on jobs with `scope.fargate_task_id` (typically **children**) | Parents show no logs — must open child | Active runs deep-link to first running child or aggregate log links |
| **OPS-9** | **Cancel** only exposed for L1 queued chips; **running** not cancellable in UI | Stuck runs need ECS/DB ops | Document; future: graceful cancel signal if supported |
| **OPS-10** | **Partial** parent status — retry exists; **not surfaced** on L1/L3 list prominently | Failed chunks missed | Failed/Partial filter + badge on kind cards |
| **OPS-11** | **Multiple launch surfaces** (Jobs modal, catalog Run pipeline, cockpit, object refresh, `trigger`, estate harvest) | Hard to correlate “who started this?” | Launch writes `ui_surface` / intent on scope; Active runs shows it |
| **OPS-12** | **Source** not always visible on L1 queued chips | Multi-source org confusion | Source name on every active row |
| **OPS-13** | **Schedules** (charter) not a first-class “what will run” panel | Ops vs ad-hoc unclear | Schedules tab (Phase 3 charter) tied to same Active runs |
| **OPS-14** | **Automate / knowledge jobs** use **different** tables and UIs | “One place” is only true for **context harvest** today | Product boundary: Estate Active runs vs Automate runs (link only) |

---

## 4. Gap register — pipeline product (cross-links)

These affect ops trust and belong in DET-2592 / [issues register](../audits/harvest-job-pipeline-issues.md):

| Theme | Gap | Doc |
|-------|-----|-----|
| Continue from Scanned | No **Continue pipeline**; catalog **Run pipeline now** starts at T0 | [scanned-continue-pipeline-design.md](./scanned-continue-pipeline-design.md) |
| Preview honesty | Plan counts **all in scope**; T1/T2 workers use **stale-only** | Same + plan API `staleObjectCount` |
| Tier chips | Completed counts, not **needs T1/T2** | scanned-continue-design §3 |
| Chain follow-up | Next tier **queued**, worker not started | [current-status.md](./current-status.md) §6 |
| Discovery vs Scanned | Two counts in one modal | P1-1, charter §2.3 |
| Entry points | Six+ launch paths | issues §9, charter Phase 1 |

---

## 5. Target — Active runs (engineering sketch)

### 5.1 UI

- New tab: **Job Types | Scanned | Active runs** (or replace L1 drill-down default when `active &gt; 0`).
- Table columns: **Status**, **Kind**, **Source**, **Scope (short)**, **Progress** (parents), **Started**, **Updated**, **Actions** (View, Kick, Cancel, Logs).
- Filters: Source, Kind, Status group (Active / Failed / Partial / Stuck).
- Empty state: “No active harvest jobs — see Job Types for history.”

### 5.2 API (proposed)

```text
GET /api/agent-lab/context/jobs/active?sourceId=&kind=
```

Returns items where `status IN ('queued','running','orchestrating')` **including child jobs**, with:

- `parent_job_id`, `child_counts` (if parent),
- `scope_summary` (human string from `includePatterns`),
- `chain` (next kinds if any),
- `last_heartbeat_at` (if stored),
- `is_stale` (running and no heartbeat &gt; N minutes).

Optionally: `POST …/jobs/active/kick-orphans` (explicit button mirroring queued GET side effect).

### 5.3 Reliability paired with UI

| Mechanism | UI exposure |
|-----------|-------------|
| `kickOrphanedQueuedJobs` | “Start waiting jobs” on Active runs |
| `failStale` | “Stale run detected” row styling |
| `retry-failed` | Row action on partial parents |
| Sequential `scope.chain` | Column “Next: T2” when T1 running |

### 5.4 Acceptance criteria

- [ ] Operator sees **all** queued/running harvest jobs in one list without picking kind first.  
- [ ] Operator can **kick** a queued child from that list.  
- [ ] Operator can open **logs** for the row that actually has a task id.  
- [ ] **Failed/partial** visible in last 24h filter without opening each kind card.  
- [ ] Scanned tab shows **banner** when a job overlaps selected schema (OPS-7).  
- [ ] Launch from Continue / cockpit records **surface** for support (OPS-11).

---

## 6. Suggested implementation order

1. **`GET jobs/active`** + minimal **Active runs** tab (read-only list + link to drawer).  
2. **Kick / cancel** actions on that list; include **child** queued rows.  
3. **Parent progress** column + **partial/failed** filters.  
4. **Scanned banner** + `computePipelineIntent` (see scanned-continue doc).  
5. **Stuck detection** + ops doc for ECS when UI flags stale.  
6. **Run grouping** for chains (optional, OPS-5).

---

## 7. Document history

| Date | Change |
|------|--------|
| 2026-10-28 | Initial ops vision, today’s playbook, OPS-1–OPS-14 gap register, Active runs sketch, DET-2592 alignment. |
