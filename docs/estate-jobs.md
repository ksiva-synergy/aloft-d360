# Estate Jobs — mental model and UI map

**Extended docs (status, schema harvest, agent logging):** [jobs/README.md](./jobs/README.md)

## What the Jobs section is

**Agent Lab → Estate → Jobs** is the control plane for **harvest workers** (Fargate `aloft-context-harvester` or local orchestrator). It does not query Databricks directly from the browser; it enqueues rows in `platform_context_jobs` and starts ECS tasks that run `scripts/context/orchestrator.ts`.

| UI area | Purpose |
|--------|---------|
| **L1 — kind cards** | Rollup per `job_kind` (T0, T1, inventory, …) |
| **L2 — dates** | Runs grouped by UTC day |
| **L3 — run list** | Individual job rows for one kind + day |
| **Scanned & beyond tab** | Objects with T0 (`platform_context_object`), not the job queue |
| **Launch modal** | `POST /api/agent-lab/context/jobs/launch` |
| **Job drawer / job detail** | One row: timings, scope, logs, kick |

## Job kinds (harvest pipeline)

| Kind | Reads | Writes |
|------|--------|--------|
| `estate_inventory` | Databricks `information_schema` | `platform_estate_objects` (Discovery) |
| `t0_structural` | Databricks + source scope | `platform_context_object` (Scanned) |
| `t1_profile` | **Scanned objects only** | Column profiles |
| `t2_semantic` | Profiled objects | LLM enrichment |
| … | | |

**Catalog Discovery ≠ T1 input.** T1 only sees rows in **Scanned & beyond** (T0 registry).

## Launch flow

1. User picks kinds + optional **Focus** (`includePatterns`, globs like `curated_db.my_schema.*`).
2. **Exclude tree** applies only to **Estate Inventory** and **T0** (estate discovery scope). T1/T2 use Focus only.
3. For T0/T1/T2, `planSplit()` may create a **parent** (`status=orchestrating`) + **N children** (`queued`).
4. `launchHarvesterTask` / `launchChildTask` starts workers; `advanceChildren()` drains the queue.

## Parent vs child jobs

| | Parent (`orchestrating`) | Child (`queued` → `running` → terminal) |
|--|--------------------------|----------------------------------------|
| Fargate task | No | Yes |
| CloudWatch logs | No | Yes (`scope.fargate_task_id`) |
| Kick | **409** — not kickable | Yes when `queued` |
| UI | Expand row on L3 list, Overview on detail, `ChildJobsPanel` | Open job detail for logs |

## API routes (reference)

| Route | Role |
|-------|------|
| `GET /jobs/summary` | L1 cards |
| `GET /jobs/dates?kind=` | L2 |
| `GET /jobs?kind=&status=&page=` | L3 (hides children; parents only) |
| `POST /jobs/launch` | Enqueue + Fargate |
| `POST /jobs/plan` | Split preview for modal |
| `GET /jobs/:id/children` | Chunk list + counts |
| `POST /jobs/:id/kick` | Start worker for one queued job |
| `POST /jobs/:id/retry-failed` | Re-queue failed children of a parent |
| `GET /jobs/:id/logs` | CloudWatch via `fargate_task_id` |

## Common failure modes

| Symptom | Cause |
|---------|--------|
| T1 `0 objects matched` | No T0 for that schema — run T0, check Scanned tab |
| `406 excluded` in scope | Exclude tree used on T1 (now stripped server-side) |
| 52+ chunks | Wide Focus or many schemas in context DB; split is per-schema when over budget |
| DONE + `0 swept` in ~1s | Empty partition or failed fast — read child logs |
| Kick 409 | Job not `queued` (parent orchestrating, or already running) |

## Recommended operator playbook

1. **Inventory** once (source `scope_include` correct).
2. Per target schema: **T0** with Focus `catalog.schema.*`, no excludes.
3. Confirm **Scanned & beyond**.
4. **T1** with same Focus (or T0→T1 sequential chain).
5. For large runs: read **chunk count** in launch modal before confirming.
