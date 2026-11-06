# 05 — Workflow engine

The flow definition is the intermediate representation (IR). It is a DAG of typed steps that can be validated, diffed, versioned, simulated and executed by the same runner. This document describes the semantics as implemented in `src/lib/flows/`, and what is left to build.

## 1. Pipeline

```
goal ──► template match / planner ──► FlowDefinition (IR)
                                         │
                       validateFlow ─────┤  structure, refs, cron, cycles → order
                    checkFlowPolicy ─────┤  capabilities, bindings, permissions, approvals, budget
                        explainFlow ─────┤  plain-language summary
                       simulateFlow ─────┘  real runner + real transforms + gateway, mocked I/O
                                         │
                         publish (M1b) ──► immutable version ──► runs (M3: worker)
```

`analyzeFlow` (`src/lib/flows/analyze.ts`) runs the first four steps in one call.

## 2. Execution semantics (implemented)

| Concern | Rule | Code |
|---|---|---|
| Order | Topological order (Kahn). Ready steps are taken in definition order, so runs are deterministic. Dependencies are `dependsOn`, every `{{steps.x…}}` ref in config, and refs in `when.ref` or `when.value` | `validate.ts` `stepDependencies`, `topologicalOrder` |
| Concurrency | **One step at a time.** Independent steps are not parallel yet | `runner.ts` |
| Refs | A whole-string ref keeps its type. Embedded refs are stringified in a single pass. An unresolvable ref fails the step | `resolve.ts` `resolveString`, `mapRefs` |
| Conditions | `when {ref, operator, value}`. False → step `skipped` (`condition not met`). Any step depending on a skipped step is `skipped` (`upstream step "x" was skipped`). A ref error in a condition fails the run | `runner.ts`, `resolve.ts` `evaluateCondition` |
| Comparison | Ordering operators compare as numbers (non-numeric → false). `eq`/`neq` compare numerically when both sides are numeric, else as strings. `contains` checks array membership or substring | `resolve.ts` `compare` (shared with `filter`) |
| Retries | `retries` 0–5, exponential backoff (`retryBaseDelayMs · 2^(n-1)`, default 1 s). Errors with `retryable: false` (policy, budget) stop at once | `runner.ts` |
| Timeouts | `timeoutMs` per attempt. An `AbortSignal` is passed to the executor | `runner.ts` `withTimeout` |
| Approval | Executor returns `wait_approval` → step and run `waiting_approval`. Resume = call `executeRun` again once the step is `succeeded` | `runner.ts` |
| Resume | Saved `succeeded` steps are skipped and their outputs restored into context | `runner.ts` |
| Cancellation | Checked between steps. Remaining steps are `skipped` (`run cancelled`) | `runner.ts` |
| Failure | Failed step → remaining steps `skipped` (`step "x" failed`) → run `failed` with the step id | `runner.ts` |
| Inputs | Declared, typed, required or defaulted. For webhooks, extra payload fields are ignored | `resolve.ts` `applyInputs` |

## 3. Validation rules

| Rule | Where | Severity |
|---|---|---|
| Schema (types, limits, enums, ids, semver, capability id format) | zod | invalid |
| Duplicate step ids or input names; unknown `dependsOn`; self-dependency | `validateFlow` | invalid |
| Unknown ref scope, unknown step or input in a ref; a ref to its own step | `validateFlow` | invalid |
| `when.ref` is not exactly one ref | `validateFlow` | invalid |
| Invalid cron | `validateFlow` | invalid |
| Dependency cycle (no unbounded loops can exist: DAG only, ≤40 steps) | `validateFlow` | invalid |
| `query` sets both or neither of `semantic`/`sql` | zod refine | invalid |
| Unknown capability or version; unknown or missing capability field | `checkFlowPolicy` | error |
| Literal field bound to data; agent or model bound to data | `checkFlowPolicy` | error |
| Missing permission for any step | `checkFlowPolicy` | error (blocks publish) |
| Write or external side effect without an upstream approval (rule `required`) | `checkFlowPolicy` | error |
| Expected cost > budget | `checkFlowPolicy` | error |
| Raw SQL; worst-case cost > budget; no budget with paid steps; egress allowlist empty | `checkFlowPolicy` | warning |

## 4. Node families (handbook §8) → IR

| Family | IR today | Next |
|---|---|---|
| Triggers | `manual`, `schedule`, `event`, `webhook` (schema) | Scheduler tick, event emit, signed webhook route (M3) |
| Semantic / data query | `query.semantic`, `query.sql`, `retrieve` | Executors via the ALOFT port (M2b) |
| Transforms | `filter`, `limit`, `count`, `anti_join` (pure) | `map`/`pick` fields, `group_count` only for concrete use cases |
| Connectors | `tool` + capability contract | Live handlers in the worker (M5) |
| AI / agent | `agent` | Executor via `ModelGateway` (M4) |
| Conditions | `when` on any step | — |
| Loops / batches | Not supported (DAG only) | Bounded `for_each` with a max item count and a per-item budget, only for a concrete need |
| Parallel | Not supported (sequential) | Run ready steps concurrently with a per-run cap (M3) |
| Waits / approvals | `approval` | Timed `wait` step and approval expiry (M3) |
| Notifications | `notify.message`, `email.send` | — |
| Sub-workflows | Not supported | Call a published flow version as a step (later). Scope = intersection of permissions |
| Error handling | Retries, fail-fast | `on_failure` branch to a compensation step (M3/M5) |
| Evidence | Outputs saved per step | `Evidence` records with provenance (M4) |
| Cost controls | `budget.maxCostUsd`, `BudgetMeter` | Per-tenant daily quota (M6) |

## 5. Simulation (implemented)

- **Real code:** runner, ref resolution, conditions, transforms, the capability gateway (input contract, egress, budget), timeouts and retries.
- **Mocked:** `query`/`retrieve` (fixtures, or empty results), `agent` (fixture or placeholder text, cost still charged), `tool` handlers (`simulate()` or a fixture *after* gateway checks), `approval` (auto-approved, marked `simulated`), `output` (preview, not saved).
- **Failure drills:** `faults: {stepId: {failAttempts, message}}`. The step throws on its first N attempts, which previews retry and fail-fast paths.
- **Not simulated:** permission denial at call time (reported statically instead, because simulation reaches no real system), concurrency, wall-clock waits, real data shapes beyond fixtures.

## 6. Durable runtime (proposed M3)

Recommendation (ADR-003): **a Postgres-leased worker** that reuses the harvester's proven pattern, behind the existing `RunStore` and `StepExecutors` ports. Temporal stays the documented alternative, with explicit triggers for switching.

| Need | Design |
|---|---|
| Persisted state | `PrismaRunStore`: upsert `(run_id, step_id)`, one short statement per call |
| Exactly-one worker per run | `UPDATE … SET locked_by, locked_until WHERE id = $1 AND (locked_until IS NULL OR locked_until < now())`. Heartbeat renews it. An expired lease is resumable |
| Schedules | One EventBridge minute tick → insert runs with unique `(flow_id, scheduled_for)`. A missed window runs **once** |
| Webhooks | `POST /webhooks/:name` with HMAC over the body plus a timestamp (replay window 5 min). Payload validated against declared inputs. Delivery id dedupes |
| Idempotency | Request `Idempotency-Key` for manual runs. Capability calls get `runId:stepId` (+ attempt for non-idempotent providers). Handlers record a send marker before external sends |
| Rate limits | Per connection (token bucket in Postgres or in-memory per worker), plus a per-org concurrent-run cap. Default: 1 active run per flow |
| Cancellation | Status `cancelled`. The worker checks between steps, and the abort signal reaches the in-flight executor |
| Compensation | Explicit `on_failure` steps. Never automatic rollback of external effects |
| Version migration | Runs finish on the version they started on. A breaking capability removal fails new runs with a clear reason |
| Observability | Run and step rows, a run timeline UI, `writeAudit` events (`flow.run.started/finished/cancelled`, `flow.approval.decided`), cost per step |

**Acceptance tests (falsifiable):** (1) kill the worker mid-step; a second worker resumes and the succeeded steps are not re-run. (2) Deliver the same webhook twice; one run. (3) Double tick at the same minute; one run. (4) An external send after a crash is not duplicated (a handler double counts calls). (5) An approval wait survives restarts of the API and the worker.

## 7. Known limits today

Sequential execution only; no loops or sub-flows; no persistence (simulation is in memory); outputs capped at 4,000 characters in previews; and the `agent`, `query` and `retrieve` executors exist only as mocks.
