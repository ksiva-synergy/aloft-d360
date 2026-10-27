# ADR-003 — Workflow runtime: Postgres-leased worker first, Temporal on explicit triggers

**Status:** Proposed (needed before M3) · **Date:** 2026-10-26

## Context

Flows need schedules, webhooks, long approval waits, retries, idempotency, cancellation, resume after crashes, and a run timeline. The repo has a resumable runner with injected storage and executors (`src/lib/flows/runner.ts`) and an operated Postgres job pattern: `platform_context_jobs`, `FOR UPDATE SKIP LOCKED`, heartbeat, `failStale`, Fargate `RunTask` (`src/lib/context/queue.ts`, `scripts/context/orchestrator.ts`). There is no Temporal, Redis or broker.

## Options

| Criterion | Postgres-leased worker (reuse pattern) | Temporal (Cloud or self-hosted) | Custom engine beyond the runner |
|---|---|---|---|
| Long waits (approvals for days) | Run row `waiting_approval`. No process held | Native timers and signals | — |
| Replay determinism | Not needed. Steps are persisted, not replayed | Required. Workflow code must be deterministic. Our definitions are data, so an interpreter workflow is needed | — |
| Versioning running executions | Runs pin `version_id` | Worker versioning / patching | — |
| Retries / timeouts / cancellation | Runner (implemented) | Native | — |
| Schedules | One EventBridge minute tick + unique slot | Native schedules | — |
| Exactly-once side effects | Neither: idempotency keys + send markers | Neither: activities are at-least-once | — |
| Operational burden | Existing Postgres + Fargate | New cluster or a Temporal Cloud contract, plus SDK workers, monitoring and upgrades | High |
| Cost | Marginal | Temporal Cloud per-action pricing, or self-host ops time | — |
| Team familiarity | High (harvester) | None evidenced in the repo | — |

## Decision (proposed)

Build the M3 runtime as a **flows worker** that claims runs with a lease, using the existing runner behind `RunStore`/`StepExecutors`. Do not build a custom engine beyond that. Keep the core engine-agnostic, so a Temporal adapter could run each step as an activity if a trigger below fires.

## Acceptance (falsifiable, M3)

Crash and resume without re-running succeeded steps; double webhook → one run; double tick → one run; no duplicate external send after a crash between call and save; an approval wait survives restarts of the API and the worker; 2 workers × 200 queued runs → each run claimed exactly once (lease contention test).

## Benchmark to run before M3 sign-off

Use a load script with fake executors. Measure claim latency p95, runs per minute per worker, Postgres CPU and lock waits at 10, 100 and 1,000 concurrent queued runs. Run it against the dev Aurora class.

## Revisit (switch to Temporal) when any holds

- Sustained above ~50 runs per second or above 10k concurrently waiting runs, with measurable Postgres contention.
- Fan-out, sub-flow or saga requirements that need durable timers inside a step (not just between steps).
- Cross-region active-active execution.
- Lease/heartbeat bugs causing duplicate execution in more than one incident.
