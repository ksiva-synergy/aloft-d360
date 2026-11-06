# Phase 0 — Chain reliability & deploy (PR-A)

**Goal:** After T0 succeeds on a schema, T1 → T2 → embed continue without manual kick on every tier.  
**Master plan:** [remediation-master-plan.md](./remediation-master-plan.md) §3.

---

## 0.1 Deploy checklist

| Step | Action |
|------|--------|
| 1 | Build and push **harvester image** to ECR (`aloft-context-harvester:latest` in `infra/context/task-definition.json`). |
| 2 | Register/update ECS task definition from `infra/context/task-definition.json` (Fargate, `awsvpc`, secrets from Secrets Manager). |
| 3 | Deploy **web app** that includes `kick-queued-workers` and catalog chain (T0→T1→T2→embed). |
| 4 | Confirm harvester command includes `scripts/context/orchestrator.ts` and optional `--process-scheduled` for scheduled schema drains. |
| 5 | If chain follow-up must `RunTask` from inside the worker, grant task role **`ecs:RunTask`** + pass subnet/security group env to the harvester (otherwise rely on in-process chain — see 0.2). |
| 6 | CloudWatch log group: `/ecs/aloft-context-harvester` (region in task def). |

**Sign-off:** On one dev/prod schema, **Run full pipeline (from T0)** or catalog pipeline completes through **embed** with at most one manual **Kick** on orphaned queued rows (ideally zero).

---

## 0.2 Chain behavior (code truth)

| Path | When |
|------|------|
| **Orchestrator in-process chain** | After a tier finishes, next tier in `scope.chain` runs in the **same** Fargate task when launching another task fails (no ECS `RunTask` from harvester). |
| **Web orphan kick** | `GET /api/agent-lab/context/jobs/queued` and **`POST …/jobs/kick-queued`** call `kickOrphanedQueuedJobs` — starts a worker for top-level **queued** rows with no `scope.fargate_task_id` (typical when harvester could not `RunTask` the next tier). |
| **Catalog / sequential launch** | `POST …/jobs/launch` with `sequential: true` enqueues first kind only; chain stored on job `scope.chain`. |

**When web must stay up:** Any environment where the harvester **cannot** `RunTask` the next tier depends on the web process (or explicit **Start waiting jobs** on Active Runs) to attach workers to orphaned queued jobs.

---

## 0.3 Optional: `--process-scheduled`

Task definition already passes `--process-scheduled` to the orchestrator. Verify scheduled schema harvest drains in ECS if product uses catalog schedules.

---

## 0.4 Runbook — stuck `running` / stale jobs

1. **CloudWatch** — `/ecs/aloft-context-harvester` stream for the job’s `scope.fargate_task_id` (or local task id).  
2. **DB** — `platform_context_jobs`: `status`, `updated_at`, `error`, `scope`.  
3. **Orchestrator** — calls `failStale(30)`; jobs in `running` with no heartbeat for **30 minutes** move to **failed**.  
4. **Active Runs** — rows with **stale?** badge (`is_stale`: running + `updated_at` older than 30m).  
5. **Recovery** — Fix worker/deploy, then **Retry failed** on job detail or re-launch with **Continue pipeline** / Jobs modal; use **Kick** for **queued** orphans.  
6. **Manual reap** — If needed, mark job failed in DB only after confirming the ECS task exited (avoid double workers).

---

## Verification (Phase 0 exit)

```text
[ ] T0 succeeded on test schema
[ ] T1 running or succeeded without manual kick (or one Kick from Active Runs)
[ ] T2 and embed complete
[ ] No orphaned queued rows >15m without task id (or kick-queued clears them)
```

Log deploy date and environment in [session-log.md](./session-log.md) when sign-off completes.
