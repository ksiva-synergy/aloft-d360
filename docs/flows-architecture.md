# Flows — proposed architecture and build plan

Status: **proposal** (2026-10-25). Companion to [flows-design.md](flows-design.md) (the short design). This document is the detailed version: how Flows fits into ALOFT, how each part works, what must be built, in what order, and how we will know it works.

Branch: `feature/flows`. Phase 1 foundation (schema, validator, runner core, tables) is committed there; everything else below is not built.

---

## 1. Purpose and scope

**Goal.** A user describes a routine task in plain language. ALOFT turns it into a reviewable list of steps, lets the user test it on sample data, and then runs it manually, on a schedule, or on an event, using ALOFT's own governed data, agents and audit trail.

**Example.** "Every Monday, find vessels whose victualling spend is more than 20% over budget, have the analyst agent explain why, and let me approve the summary before it is saved for the fleet team."

**In scope:** typed flows, a durable runner, data/agent/approval/output steps, a chat builder inside the Workbench, schedules, run history, governance and audit.

**Out of scope (for now):** a general connector catalog (Slack, Jira, SharePoint and similar), arbitrary code steps, a free-form drag-and-drop workflow engine, a Hono/other framework migration (see §17), multi-org tenancy redesign.

**Why build here instead of using AWS Quick.** The value is in ALOFT's governed semantic layer, agents, memory, login and audit. A flow running inside ALOFT uses them directly. Quick suits internal employee automations over third-party tools; the two can coexist (Quick can call ALOFT through an API/MCP tool later).

## 2. What a user sees

1. **Describe.** In the Workbench the user starts a session in *Flow* mode and types what they want.
2. **Review.** The AI proposes steps from a fixed set of types and asks for anything missing (which agent, who approves). The steps appear as an editable list beside the chat.
3. **Test.** *Dry run* executes the flow on a limited sample and shows each step's input and output.
4. **Activate.** The user chooses manual, schedule (cron) or event trigger.
5. **Operate.** A run history page shows every run, step status, tokens, cost and errors. Approval steps pause the run until an authorised person approves in ALOFT.

## 3. Design principles

1. **Typed, declarative steps only.** The AI composes flows from a closed set of step types. No step evaluates code. A flow is data that can be validated, diffed, versioned and audited.
2. **Reuse, don't re-implement.** Data access, agents, auth, audit and tracing already exist; steps call them.
3. **Durable by construction.** State is saved after every step. A run can resume after a restart, an approval or a retry.
4. **Framework-free core.** All logic lives in `src/lib/flows/` with no Next.js imports; API routes are thin. A later move to a worker or another web framework does not touch the core.
5. **Least privilege.** A flow acts with its owner's rights, never more. Anything that leaves the platform needs an explicit approval or admin policy.
6. **Honest failure.** A step either succeeds with an output or fails with an error; runs never report success on partial work.

## 4. System overview

```
                     ┌──────────────────────────── Browser (Vite SPA) ───────────────────────────┐
                     │  Workbench (Flow mode)     Flows list / editor      Run history / approvals │
                     └───────────────┬─────────────────────┬──────────────────────┬──────────────┘
                                     │ chat (SSE)          │ REST                 │ REST
                     ┌───────────────▼─────────────────────▼──────────────────────▼──────────────┐
                     │                 Next.js API routes (thin: auth, validate, call lib)         │
                     │   /api/agent-lab/flows/**                                                   │
                     └───────────────┬─────────────────────────────────────────────┬──────────────┘
                                     │                                             │
             ┌───────────────────────▼──────────────┐                ┌─────────────▼─────────────┐
             │       src/lib/flows  (framework-free) │                │  Scheduler tick (1/min)   │
             │  schema · validate · resolve · runner │◄───enqueue─────│  finds due flows (cron)   │
             │  executors · prisma-store · builder   │                └───────────────────────────┘
             └──────┬───────────┬──────────┬─────────┘
                    │           │          │
        ┌───────────▼──┐  ┌─────▼──────┐  ┌▼───────────────┐  ┌───────────────────┐
        │ Semantic layer│  │ Agent loop │  │ Knowledge base │  │ writeAudit / LLM  │
        │ + Databricks  │  │ (Bedrock)  │  │ (retrieve)     │  │ logs / cost logs  │
        └───────────────┘  └────────────┘  └────────────────┘  └───────────────────┘
                    │
              Aurora PostgreSQL: platform_flows · _versions · _runs · _step_runs
```

Execution happens in one of two places behind the same `executeRun` function: the Next.js API process (short, interactive runs and dry runs) or a worker (scheduled and long runs, §9).

## 5. Components

### 5.1 Flow definition — built
`src/lib/flows/schema.ts`. Versioned JSON validated by zod.

- **Trigger:** `manual`, `schedule` (5-field cron, UTC), `event` (named).
- **Inputs:** typed (`string`/`number`/`boolean`), required or defaulted.
- **Steps:** `query`, `retrieve`, `agent`, `transform` (`filter`/`limit`/`count`), `approval`, `output` (`save` only so far). Each has `id`, `dependsOn`, `retries` (0–5), `timeoutMs` (1s–5min).
- **References:** `{{steps.<id>.<path>}}` and `{{inputs.<name>}}` inside any string of a step's config.

### 5.2 Validator — built
`src/lib/flows/validate.ts`. `validateFlow(raw)` never throws. It rejects duplicate ids, unknown step/input references, reference scopes other than `steps.`/`inputs.`, self-references, invalid cron and dependency cycles, and returns a deterministic execution order (references and `dependsOn` both create dependencies).

### 5.3 Reference resolution — built
`src/lib/flows/resolve.ts`. A string that is exactly one reference keeps the referenced value's type (an array of rows stays an array); embedded references are stringified. A reference that cannot be resolved fails the step. `applyInputs` merges provided inputs over defaults and checks required/type.

### 5.4 Runner — built (core only)
`src/lib/flows/runner.ts`. `executeRun({ flow, order, inputs, store, executors })`:

- Loads saved step states; skips steps already `succeeded` (this is how resume works).
- Runs steps one at a time in order; saves each state change before moving on.
- Per step: resolves references, runs the executor under a timeout and `AbortSignal`, retries with exponential backoff.
- On failure: marks the step `failed`, remaining steps `skipped`, run `failed` with the step id in the error.
- `wait_approval` result: marks the step and run `waiting_approval` and returns. Resuming = calling `executeRun` again after the approval step has been marked `succeeded`.
- Checks `store.isCancelled()` between steps.
- Storage and execution are injected (`RunStore`, `StepExecutors`), so the runner has no database or network dependency.

Known limits of the current runner (to address in Phase 1b): steps run **sequentially** even when independent; no per-run token/cost budget enforcement yet; no distributed lock, so two workers could resume the same run (see §8.3).

### 5.5 Step executors — to build
One executor per step type, in `src/lib/flows/executors/`. Each receives the resolved step and returns `{ kind: 'done', output }` or `{ kind: 'wait_approval' }`.

| Step | Calls | Notes |
|---|---|---|
| `query` | `executeSemanticQuery(query, connectionId, opts)` ([semantic/execute.ts](../src/lib/semantic/execute.ts)); raw SQL via `executeDatabricksSQL` ([databricks/execute.ts](../src/lib/databricks/execute.ts)) | See §7.1. Both enforce read-only; `executeDatabricksSQL` calls `enforceReadOnly` internally so cron callers get it automatically. Output `{ columns, rows, rowCount, sql }` capped by `maxRows`. |
| `retrieve` | Knowledge-base retrieval used by the Inspector | Output `{ chunks: [{ text, source, score }] }`. |
| `agent` | A new reusable `runAgentOnce({ agentSlug, prompt, model })` | See §7.2. Output `{ text, usage }`. |
| `transform` | Pure functions in `executors/transform.ts` | No I/O, no eval. Operators fixed (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`). |
| `approval` | Creates an approval request and returns `wait_approval` | Resolved by the approval endpoint (§11), which marks the step `succeeded` with `{ approved, by, at, note }`. |
| `output` (`save`) | Inserts a result row (new `PlatformFlowOutput` or a column on the step run) | `notify` (email via SES, Slack) is Phase 3 and a separate `kind`. |

### 5.6 Prisma run store — to build
`src/lib/flows/prisma-store.ts` implements `RunStore` on top of `PlatformFlowRun` / `PlatformFlowStepRun`: `loadStepRuns`, `saveStepRun` (upsert on `(run_id, step_id)`), `setRunStatus` (also sets `started_at`/`finished_at`), `isCancelled` (reads run status). Every call is one short query; no long transactions.

### 5.7 Flow service — to build
`src/lib/flows/service.ts`: create/update flow (new immutable version per save), activate/pause, start run (validate → create run row → execute or enqueue), cancel run, approve/reject, list/get. Routes call this; nothing else touches the tables.

### 5.8 Builder (Workbench Flow mode) — to build
See §10.

### 5.9 Scheduler — to build
See §9.

## 6. Data model

New tables (migration `prisma/migrations/20261025_flows/migration.sql`, **written, not applied**). All carry `org_id` where it makes sense; the older `agent_lab_pipeline_*` and `hitl_interrupt` tables are left untouched (unused, no `org_id`).

| Table | Purpose | Key columns |
|---|---|---|
| `platform_flows` | A flow | `org_id`, `name`, `slug` (unique per org), `owner`, `status` (draft/active/paused), `current_version_id` |
| `platform_flow_versions` | Immutable definitions | `flow_id`, `version` (unique with flow), `definition` JSONB, `created_by` |
| `platform_flow_runs` | One execution | `org_id`, `flow_id`, `version_id`, `trigger`, `status`, `inputs`, `error`, `triggered_by`, `total_tokens`, `cost_usd`, timestamps |
| `platform_flow_step_runs` | One step of one run | `run_id`, `step_id` (unique with run), `status`, `attempt`, `output` JSONB, `error`, `llm_call_id`, timestamps |

Planned additions (Phase 1b/3): `PlatformFlowSchedule` (`flow_id`, `cron`, `next_run_at`, `last_run_at`, `enabled`), `PlatformFlowApproval` (`run_id`, `step_id`, `assignee`, `message`, `status`, `decided_by`, `decided_at`, `note`), and a lease on runs (`locked_by`, `locked_until`) for §8.3.

Run status: `queued → running → (waiting_approval ↔ running) → succeeded | failed | cancelled`. Step status: `pending, running, succeeded, failed, skipped, waiting_approval`.

Data sizes: step `output` is stored inline. Cap it (proposal: 1 MB per step; larger results are truncated with a flag and `rowCount`), because later steps and the history page read it.

## 7. Integration with existing ALOFT code

### 7.1 Data: the `query` step
Findings from the code:

- `executeSemanticQuery(query, connectionId, opts?)` loads the model for the **default org**, allows only **governed** models on the default path, compiles SQL, resolves credentials and returns `{ sql, columns, rows, rowCount, isDraft }`. This is the governed path the Inspector and dashboards use.
- `executeDatabricksSQL` enforces read-only, single-statement SQL itself ("Any future caller (workbench execute_tool, cron jobs, etc.) goes through this function").
- The connection comes from `resolveToolCatalogEntry('')` → `config.connection_id`, i.e. **one shared warehouse credential**, not a per-user one.

Decisions:

1. **Add a `semantic` mode to the `query` step** (`{ mode: 'semantic', query: SemanticQuery }`) and make it the default the builder uses. It carries governance with it (governed definitions, labels, lineage).
2. **Keep raw `sql` mode but restrict it**: require a permission (§12), apply `maxRows`, and run only through `executeDatabricksSQL`. Consider an allowlist of schemas per org.
3. The step schema currently has only `sql`; this change is a schema revision (still Phase 1 — no flows exist yet).

### 7.2 Agents: the `agent` step
The only code that runs a saved agent today is the HTTP route [agents/chat/route.ts](../src/app/api/agent-lab/agents/chat/route.ts): it loads the agent from `agent_catalog`, builds a prompt with `runtimeBriefFromCatalog` + `buildRuntimeSystemPrompt`, then streams `runAgentLoop` over SSE with `describe_schema` and `execute_tool`. There is no reusable "run once, return text" function.

Plan: extract a function `runAgentOnce({ agentSlug?, prompt, model, signal })` into `src/lib/agents/run-agent-once.ts` that returns `{ text, toolCalls, usage }`, and have both the route and the flow executor call it. With no `agentSlug`, it is a plain prompt step with no persona. Tool use inside the step is limited to the same allowlist the route uses (`describe_schema`, `execute_tool`). Logging uses the existing `withAgentOpsToolLog`/`TurnMetricsRecorder` so costs show up in the same tables.

### 7.3 Auth and principal
- Interactive routes call `getServerSession` / `guardInspectorChat`-style checks. **`INSPECTOR_AUTH_ENFORCE` defaults to observe-only** ([session-auth.ts](../src/lib/inspector/session-auth.ts)); Flows routes must always enforce, not follow that flag.
- Scheduled and worker runs have no browser session. `session-auth.ts` already defines a service principal (`INSPECTOR_SERVICE_TOKEN`); a scheduled run executes **as the flow owner's identity recorded on the flow** (not as an unrestricted service), see §12.

### 7.4 Audit, tracing, cost
- `writeAudit({ actorId, action, entityType, entityId, metadata })` for: `flow.created`, `flow.version.saved`, `flow.activated`, `flow.paused`, `flow.run.started`, `flow.run.finished`, `flow.run.cancelled`, `flow.approval.decided`.
- Model calls inside `agent` steps are already written to `LlmCall`/`agent_turn_log`; the step run stores the id in `llm_call_id`.
- Run totals (`total_tokens`, `cost_usd`) are the sum over step runs.

## 8. Execution model

### 8.1 Lifecycle of a run
1. Service validates the version, applies inputs, creates a `queued` run.
2. Execution is started (in-process for dry/manual short runs, or enqueued for the worker).
3. `executeRun` walks the order; each step writes `running` then its final state.
4. Pauses at approval; a decision resumes execution (call `executeRun` again).
5. Terminal status is written once, with the run's `finished_at`.

### 8.2 Idempotency and retries
- A resumed run never re-executes a `succeeded` step.
- A step that crashed mid-flight is left `running`; on resume it is retried (counts as a new attempt). Therefore **executors must be idempotent or detect their own prior effect**: `save` uses a deterministic key `(run_id, step_id)` with upsert; future `notify` steps must record a send marker before sending, and treat "marker exists" as done.

### 8.3 Concurrency
- Add a lease: a worker claims a run by setting `locked_by`/`locked_until` in a single conditional `UPDATE`, renews it while running, and treats an expired lease as abandoned. This mirrors the harvest job queue's `claimNext`/`heartbeat`/`failStale` ([context/queue.ts](../src/lib/context/queue.ts)); reuse the pattern, not the table.
- Global caps: max concurrent runs per org and per flow (default 1 active run per flow; configurable) to prevent a slow schedule from stacking up.

### 8.4 Limits
Per step: `timeoutMs` (default 60 s, max 300 s), `retries` (max 5). Per flow: max 40 steps. Per run (to build): max tokens and max cost, checked before each `agent` step, reading the existing `budget_config` model. Exceeding a budget fails the run with a clear reason.

### 8.5 Failure handling
| Situation | Behaviour |
|---|---|
| Executor throws / times out | Retry up to `retries`, then step `failed`, rest `skipped`, run `failed` |
| Reference cannot be resolved | Step fails (not retried usefully) |
| Process dies mid-run | Lease expires; another worker resumes from saved state |
| Approval never decided | Run stays `waiting_approval`; optional expiry (proposal: 7 days → `cancelled`) |
| Owner deactivated | Scheduled runs fail fast with `owner inactive`; flow auto-paused after N consecutive failures |

## 9. Triggers, scheduling and the worker

### 9.1 Manual
`POST …/flows/:id/run` (user clicks Run). Executes in-process when the flow has no approval step and a small expected duration; otherwise enqueues.

### 9.2 Schedule
One tick, not one rule per flow:

- A single EventBridge rule fires every minute (same mechanism and infra files as the harvester: [infra/context/eventbridge-rule.json](../infra/context/eventbridge-rule.json), [schedules.ts](../src/lib/context/schedules.ts)), starting a `flows-tick` entry point.
- The tick selects active flows whose schedule `next_run_at <= now()`, creates a `queued` run for each (guarded by a unique `(flow_id, scheduled_for)` so a double tick cannot double-run), and advances `next_run_at` using `cron-parser`.
- Cron is evaluated in **UTC**. The UI shows the next 3 fire times in the user's timezone.
- Misfires: if the tick was down, run **once** for the missed window, not once per missed slot.

### 9.3 Event
Named events (for example `harvest.job.finished`) are emitted by existing code through `emitFlowEvent(name, payload)`, which creates runs for active flows subscribed to that name. Phase 4; the harvester can emit first.

### 9.4 Where runs execute
- **Phase 1–2:** in the Next.js API process, started with a non-blocking call; acceptable for short flows. Beanstalk runs a long-lived Node server, so background promises survive the request, but a deploy or instance restart interrupts them — resume covers it.
- **Phase 3:** a worker for scheduled and long flows. Reuse the existing Fargate task pattern ([launch-harvester.ts](../src/lib/context/launch-harvester.ts)): a `flows-worker` command that claims queued runs with a lease and calls the same `executeRun`.
- The Hono question is deliberately out of scope (§17): the core is framework-free so it is unaffected either way.

## 10. The chat builder (Workbench Flow mode)

Today the Workbench builds **agents**: the AI patches a `ConstructionState` with tools such as `update_agent_draft`, `add_assumption`, `add_datasource` ([builder-tools.ts](../src/lib/construction/builder-tools.ts)), progress is gated by `deriveReadiness`, and *commission* saves the agent to the catalog ([commission/route.ts](../src/app/api/agent-lab/workbench/commission/route.ts)). That is one agent, not an ordered multi-step process.

Flow mode reuses the session, streaming, model selection, test-run and commission scaffolding and swaps four things:

1. **State:** a `FlowDraftState` holding the flow definition under construction, user-lock markers (same idea as `userLockFor`, so the AI does not overwrite a field the user edited) and a readiness value.
2. **Tools** (`flow-builder-tools.ts`): `set_trigger`, `add_input`, `add_step`, `update_step`, `remove_step`, `reorder_step`, `add_assumption`, `list_available_agents`, `list_semantic_models`, `validate_flow`. Each applies a patch, runs `validateFlow`, and returns the issues to the model so it self-corrects.
3. **System prompt:** teaches the six step types, the reference syntax, and the rules (always include an approval before any external send; prefer `semantic` queries; ask when an agent/approver is ambiguous).
4. **Readiness gate:** a flow can be saved as draft any time, but can be **activated** only if it validates and has a successful dry run on the current version.

The AI never emits free text that becomes executable: it can only produce values that pass the zod schema and the validator.

**Dry run.** Runs the same `executeRun` with executors in `dryRun` mode: `query`/`retrieve` run with a small row cap, `agent` runs normally (it is read-only), `approval` auto-approves in a clearly marked simulated way, `output` returns a preview instead of writing. The result is stored as a run with `trigger = 'dry_run'` and is excluded from production metrics.

## 11. API surface (proposed)

All under `/api/agent-lab/flows`. Handlers authenticate, check permission, validate input with zod, call `src/lib/flows/service.ts`, and return JSON. Next.js route conventions in this repo differ from older Next versions; read the guide in `node_modules/next/dist/docs/` before writing handlers (project rule in `AGENTS.md`).

| Method & path | Purpose | Permission |
|---|---|---|
| `GET /flows` | List flows (org-scoped) | `flow:read` |
| `POST /flows` | Create flow from a definition | `flow:write` |
| `GET /flows/:id` | Flow + current version | `flow:read` |
| `POST /flows/:id/versions` | Save a new version (validated) | `flow:write` (owner or admin) |
| `POST /flows/:id/validate` | Validate without saving | `flow:read` |
| `POST /flows/:id/activate` / `pause` | Change status; activation requires a passing dry run | `flow:write` |
| `POST /flows/:id/run` | Start a run (manual or dry) | `flow:run` |
| `GET /flows/:id/runs` | Run history | `flow:read` |
| `GET /runs/:runId` | Run + step runs | `flow:read` |
| `POST /runs/:runId/cancel` | Cancel | `flow:run` (owner or admin) |
| `POST /runs/:runId/steps/:stepId/decision` | Approve/reject (+ note) | `flow:approve` and matches assignee |
| `POST /flows/tick` | Scheduler entry (service principal only) | service token |
| `/workbench/chat` (existing) | Flow mode via `mode: 'flow'` | `inspector:use` |

## 12. Security and governance

### 12.1 What exists today (important)
Read from the code, not assumed:

- **Authorization is coarse.** `PERMISSIONS` in [rbac.ts](../src/lib/rbac.ts) has no per-dataset or per-table permission; `inspector:use` gates the Inspector as a whole. `data_level` appears only on `PlatformAgent` ([platform/agents.ts](../src/lib/platform/agents.ts)) and is not used to restrict data access.
- **Queries use one shared Databricks credential** (§7.1). Databricks itself cannot tell which ALOFT user asked.
- **Org resolution is single-org:** `getDefaultOrg()` reads `DEFAULT_ORG_SLUG`.
- **Route auth can be observe-only** via `INSPECTOR_AUTH_ENFORCE`.

Consequence: "a flow can only see what its owner can see" is **not automatically true**. It will be true only for what we enforce in ALOFT, which today is: governed semantic definitions (drafts are owner-only), read-only SQL, and route-level login.

### 12.2 Controls Flows adds
1. **New permissions:** `flow:read`, `flow:write`, `flow:run`, `flow:approve`, `flow:sql` (raw SQL steps). Seed them into `Role`/`Permission`; default only admins get `flow:sql`.
2. **Semantic-first data access.** The builder defaults to `semantic` queries (governed models only). Raw SQL is permission-gated, read-only, row-capped, and optionally restricted to an allowlist of catalogs/schemas per org.
3. **Owner identity on every run.** A run records `triggered_by` and runs under the flow owner's permissions; permissions are re-checked at **run time**, not just at creation, so a revoked user's flows stop.
4. **Always-enforced route auth** for Flows (not tied to `INSPECTOR_AUTH_ENFORCE`).
5. **Outbound safety.** Any step that sends data outside the platform (`notify`) must come after an `approval` step unless an admin policy (`policy_entry`) exempts it; recipients limited to an allowed domain list.
6. **Prompt-injection containment.** Data returned by queries or documents is passed to agent steps as data inside a delimited block, never merged into step configs; step configs are fixed by the saved version, so injected text cannot add steps or change recipients. Agent steps get only the read-only tool allowlist.
7. **Secrets.** Tool credentials stay server-side; the model sees tool names and schemas only. Logs redact via existing `redact.ts` helpers.
8. **Audit** for every mutation and run event (§7.4). Audit write failures are logged but never block a run (existing `writeAudit` behaviour).

### 12.3 Threats and mitigations
| Threat | Mitigation |
|---|---|
| User builds a flow to read data they should not see | Semantic-only by default; raw SQL gated; run-time permission checks; allowlist |
| Injection via data alters behaviour | Typed configs, data fencing, read-only agent tools, approval before send |
| Runaway cost from a schedule | Per-run/flow budgets, concurrency cap, auto-pause after repeated failures |
| Duplicate side effects after crash | Idempotent executors, send markers, leases |
| Stale owner / orphaned flows | Run-time owner check; auto-pause; admin reassignment |
| Large outputs exhaust DB/memory | Row caps, output size cap with truncation flag |

## 13. Observability and UI

**Run history page** (`/agent-lab/flows/:id/runs`): table of runs (status, trigger, started, duration, cost) → run detail with a step timeline: status, attempts, input (resolved), output preview, error, linked LLM call. Approval requests show Approve/Reject with a note.

**Flows list:** name, owner, trigger summary, status, last run result, next run time.

**Metrics** (reuse existing logging): success rate, p50/p95 duration, cost per run, steps failing most often. Alerts: flow auto-paused; run stuck > 2× expected duration.

**Navigation:** a "Flows" item under Build next to Agents ([agents-routes.ts](../src/lib/navigation/agents-routes.ts) and `nav-config.ts` hold the structure). The UI is the Vite SPA in `web/` with pages in `src/views/`; typography must follow `docs/DESIGN_SYSTEM.md` tokens.

## 14. Testing strategy

| Level | What | Status |
|---|---|---|
| Unit | schema, validator, resolution, runner (retry, timeout, resume, cancel, approval, input defaults) | 18 tests, passing |
| Unit | each executor with mocked backends; transform operators; idempotent `save` | to write |
| Integration | Prisma store against a throwaway database: create run → crash mid-step → resume | to write |
| Contract | route handlers: auth, permission, validation errors, org scoping | to write |
| Security | user without `flow:sql` cannot save a raw-SQL step; non-owner cannot approve; revoked owner's schedule does not run; injection fixture cannot change recipients | to write |
| End to end | create flow → dry run → activate → scheduled tick → approval → output, against stubbed Databricks/Bedrock | to write |
| Builder evals | a set of natural-language prompts → expected flow shape; score by validity and structural match | to write |

Quality bar for each phase: `tsc --noEmit` clean, flows tests green, no regressions in the existing suite.

## 15. Build plan

Sizes: S ≈ a day or less, M ≈ a few days, L ≈ a week or more, for one engineer familiar with the code. These are rough.

### Phase 0 — foundation (done)
Schema, validator, resolution, runner core, tables, migration file, design docs. Branch `feature/flows`, commit `e031520`. *Remaining:* apply the migration in a dev database and run `prisma generate`.

### Phase 1 — a flow can run on real data (target: developer-usable)
| # | Task | Files | Size | Done when |
|---|---|---|---|---|
| 1.1 | Apply migration (dev), `prisma generate` | `prisma/` | S | tables exist; client has the models |
| 1.2 | Add `semantic` mode to `query` step; schema + validator + tests | `flows/schema.ts`, tests | S | semantic and sql modes validate; mixed invalid configs rejected |
| 1.3 | Prisma `RunStore` + integration test (crash/resume) | `flows/prisma-store.ts` | M | resumed run skips finished steps in a real DB |
| 1.4 | `query` executor (semantic + gated SQL) | `flows/executors/query.ts` | M | returns capped rows; read-only violation surfaces as step error |
| 1.5 | Extract `runAgentOnce`; refactor `agents/chat` to use it; `agent` executor | `lib/agents/run-agent-once.ts` | M | chat route behaviour unchanged; executor returns text + usage |
| 1.6 | `transform` and `output(save)` executors | `flows/executors/*` | S | unit tests; save is idempotent |
| 1.7 | Flow service + audit events | `flows/service.ts` | M | create/version/run/cancel covered by tests |
| 1.8 | Permissions + seed; API routes; always-enforced auth | `app/api/agent-lab/flows/**`, `rbac.ts` | M | contract + security tests pass |
| 1.9 | Minimal UI: flows list, JSON/step-list editor, run button, run history | `src/views/agent-lab/flows/*`, nav | M–L | a user runs the victualling example end to end |

**Exit criteria:** the example flow (query → agent → save) runs from the UI on a dev database and the run is visible with steps, tokens and cost; a user without `flow:run` is refused; killing the server mid-run and resuming completes it.

### Phase 2 — describe it in chat
| # | Task | Size |
|---|---|---|
| 2.1 | `FlowDraftState`, builder tools, system prompt, `mode: 'flow'` in workbench chat | L |
| 2.2 | Step-list editor with inline edit and user locks | M |
| 2.3 | Dry run (executor `dryRun` mode, preview output, `dry_run` trigger) | M |
| 2.4 | Activation gate (validates + passing dry run on this version) | S |
| 2.5 | Builder eval set (≥ 25 prompts) and tuning | M |

**Exit:** a non-technical user builds the example by chatting, dry-runs it, and activates it without touching JSON.

### Phase 3 — automatic and safe
| # | Task | Size |
|---|---|---|
| 3.1 | `PlatformFlowSchedule`, tick endpoint, EventBridge minute rule, unique `(flow_id, scheduled_for)` | M |
| 3.2 | Worker entry point on Fargate with run leases and heartbeat | L |
| 3.3 | `PlatformFlowApproval`, approval inbox UI, expiry | M |
| 3.4 | `notify` output: email via SES first (recipient allowlist, approval-before-send) | M |
| 3.5 | Budgets (tokens/cost), concurrency caps, auto-pause on repeated failure | M |

**Exit:** the weekly example runs unattended, pauses for approval, and emails the approved summary exactly once even if the worker restarts mid-run.

### Phase 4 — polish
Slack notify, event triggers, canvas view (`@xyflow/react`, `dagre`), branching, templates library, import/export, parallel steps in the runner, per-schema allowlists in admin UI.

## 16. Rollout

- Feature flag `FLOWS_ENABLED` (env, default off) hides navigation and routes until Phase 1 is accepted.
- Migration is applied manually per repo convention (`prisma db execute`, then `prisma migrate resolve --applied`), dev first, then staging; it only creates tables so rollback is dropping them.
- Pilot with one team and 2–3 flows; review run history and cost weekly before opening wider.
- Docs to update on each phase: `docs/CHANGELOG.md` (required by `CLAUDE.md`), `ARCHITECTURE.md` (new subsystem section), `docs/api-routes.generated.md` (regenerate), this file's status lines.

## 17. Decisions, risks, open questions

**Decided.** Build inside ALOFT; stay on the current Next.js API for now (a Hono migration is out of scope; an earlier audit, [business-ai-studio-current-state.md](audits/business-ai-studio-current-state.md), advised against it, and the framework-free core keeps the option open); new tables rather than reusing `agent_lab_pipeline_*`.

**Open — need an owner's answer before the phase that depends on them**

| # | Question | Needed by | Proposal |
|---|---|---|---|
| 1 | Should flows run with per-user Databricks identity, or keep the shared credential plus ALOFT-level checks? | Phase 1.4 | Shared credential + semantic-first + gated SQL now; per-user pass-through is a separate platform project |
| 2 | Is raw SQL allowed at all for non-admins? | 1.4 | No (admin-only `flow:sql`) |
| 3 | First outbound channel: email (SES) or Slack? | 3.4 | SES |
| 4 | Who may approve: owner only, named user, or a role? | 3.3 | Named user or role, set per step |
| 5 | Single org or multi-org soon? | Phase 1 | Single org; keep `org_id` on every row |
| 6 | Where do outputs live (table, dashboard pin, file)? | 1.6 | Start with a stored result row viewable in run history |
| 7 | Should scheduled runs be allowed to call agents that use tools beyond `describe_schema`/`execute_tool`? | 3.1 | No |

**Risks**

| Risk | Impact | Mitigation |
|---|---|---|
| Shared warehouse credential weakens "owner's rights" | Data exposure | §12.2 controls; call it out to stakeholders; revisit per-user identity |
| Agent step refactor changes chat behaviour | Regression in Use Agent | Extract with tests first; keep route output identical |
| In-process runs interrupted by deploys | Lost work until resumed | Resume on boot scan of `running` runs with expired lease; move to worker in Phase 3 |
| Scope creep into a general workflow engine | Never ships | Closed step set; add steps only for concrete use cases |
| LLM builder produces plausible but wrong flows | Wrong automations | Validator + mandatory dry run + approval before send + eval set |
| Cost of agent steps on schedules | Budget overrun | Budgets, caps, auto-pause, cost shown on the flow list |

## 18. Code map

Existing code this plan depends on:

| Concern | File |
|---|---|
| Agent loop (Bedrock, tools, streaming) | `src/lib/inspector/agent-loop.ts` |
| Run a saved agent (HTTP/SSE today) | `src/app/api/agent-lab/agents/chat/route.ts` |
| Builder tools / state / readiness / commission | `src/lib/construction/*`, `src/app/api/agent-lab/workbench/*` |
| Governed query execution | `src/lib/semantic/execute.ts`, `compiler.ts` |
| Databricks SQL (read-only enforced) | `src/lib/databricks/execute.ts`, `connections.ts` |
| Tool catalog / connection resolution | `src/lib/inspector/tools.ts` (`resolveToolCatalogEntry`) |
| Auth, service principal | `src/lib/inspector/session-auth.ts`, `src/lib/auth.ts`, `src/lib/rbac.ts` |
| Audit | `src/lib/audit.ts` |
| Tool/turn/LLM logging | `src/lib/agent-ops/*`, `src/lib/llm-tracing.ts` |
| Job queue, leases, ECS launch (pattern to reuse) | `src/lib/context/queue.ts`, `launch-harvester.ts` |
| Schedules / EventBridge | `src/lib/context/schedules.ts`, `infra/context/eventbridge-rule.json` |
| Org resolution | `src/lib/platform/agents.ts` (`getDefaultOrg`), `src/lib/org.ts` |

New code (this plan): `src/lib/flows/**` (schema, validate, resolve, runner — done; executors, prisma-store, service, builder — to build), `src/lib/agents/run-agent-once.ts`, `src/app/api/agent-lab/flows/**`, `src/views/agent-lab/flows/**`.
