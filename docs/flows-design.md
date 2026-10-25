# Flows — describe an automation, ALOFT builds and runs it

Status: **design proposal** (2026-10-25). Nothing in this document is implemented yet.

Goal: let a user describe a routine task in plain language ("every Monday, find vessels whose victualling spend is more than 20% over budget, have the analyst agent explain why, and send me the summary to approve before it goes to the fleet team"), review the generated steps, test them on sample data, and then run them manually, on a schedule, or on an event.

Inspiration: Amazon Quick Suite "Quick Flows" / "Quick Automate". Pattern: natural-language description → generated step plan → review and edit → run, schedule or trigger.

## 1. What already exists

| Need | Existing piece |
|---|---|
| Describe → build loop | Workbench chat (`src/app/api/agent-lab/workbench/chat/route.ts`), builder tools (`src/lib/construction/builder-tools.ts`), construction state (`constructionState.ts`), readiness gate (`readiness.ts`), test run, commission |
| LLM tool-calling runtime | `src/lib/inspector/agent-loop.ts` (Bedrock), with logging to `agent_turn_log`, `LlmCall`, `tool_invocation_log` |
| Data access | Databricks queries, semantic layer, knowledge base |
| Scheduling | `cron-parser` and EventBridge (`src/lib/context/schedules.ts`, `infra/context/eventbridge-rule.json`) |
| Canvas | `@xyflow/react`, `dagre` |
| Unused tables | `agent_lab_pipeline_defs`, `agent_lab_pipeline_runs`, `hitl_interrupt`. No code uses them and they have no `org_id`; leave them and create new tables |

## 2. Gaps

1. **Durable runner.** The agent loop lives inside one HTTP request (`maxDuration = 300`). Flows that wait for approval or run on a schedule need a state machine persisted in the database, so runs can resume and retry.
2. **Actions.** Only `db_query` tool-catalog entries execute today (`src/lib/inspector/tools.ts`). There is no email, Slack or webhook output, so flows could only read data.
3. **Typed steps.** The LLM composes flows from a fixed set of validated step types. It never writes free-form code.

## 3. Flow definition

A flow is versioned JSON validated by zod (new file `src/lib/flows/schema.ts`).

```
Flow
 ├─ trigger:  manual | schedule (cron) | event (e.g. harvest job finished)
 ├─ inputs:   typed parameters (optional)
 └─ steps[]:  each has id, type, config, and refs to earlier step outputs
```

Step types:

| Type | Does | Notes |
|---|---|---|
| `query` | Databricks SQL or semantic measure | Read-only guard, same as Inspector |
| `retrieve` | Knowledge-base lookup | |
| `agent` | Calls a commissioned agent, or a single prompt step | Reuses `agent-loop` |
| `transform` | Filter, threshold, branch | Declarative expressions only, no eval |
| `approval` | Pauses the run until a human approves or edits | Run status `waiting_approval` |
| `output` | Save to table, pin to dashboard, notify (email, Slack) | Notify is Phase 3 |

Step outputs are referenced by id (`{{steps.find_overspend.rows}}`). The validator rejects dangling refs, cycles and unknown step types.

## 4. Data model

New tables, all scoped by `org_id` (Prisma, `PlatformFlow*` naming like the rest of the platform models):

- `PlatformFlow`: id, org_id, name, slug, owner, status (draft/active/paused), current_version_id.
- `PlatformFlowVersion`: flow_id, version, definition (Json), created_by, created_at. Immutable once saved.
- `PlatformFlowRun`: flow_id, version_id, trigger, status (`queued`, `running`, `waiting_approval`, `succeeded`, `failed`, `cancelled`), inputs, started/finished, tokens, cost, triggered_by.
- `PlatformFlowStepRun`: run_id, step_id, status, input, output, error, attempt, timings, linked `LlmCall` id when the step used a model.

## 5. Runner

- Executes steps in dependency order, saving a `PlatformFlowStepRun` row after every step.
- A run can be resumed from its last completed step, which is how approvals and retries work.
- Retries with backoff per step; timeouts per step; a global run budget (tokens and cost), reusing `budget_config`.
- **Where it runs** (open decision 1): start in-process in the Next.js API (`src/lib/flows/runner.ts`), written as a pure function of (run state → next state) so it can move to the Fargate worker the harvester uses without a rewrite. Scheduled and long flows will need the worker.
- **Scheduling:** schedules are rows in the database; one EventBridge rule ticks every minute and enqueues due flows (cron-parser decides which). This avoids one rule per flow.

## 6. Builder

- Chat-driven, reusing the Workbench pattern: new builder tools `add_step`, `update_step`, `remove_step`, `bind_input`, `set_trigger`, `set_schedule`. The state is the flow definition, not an agent.
- UI: step list with inline editing first; canvas view (xyflow) later.
- **Dry run:** executes the flow with `query` steps limited (row cap) and `output` steps replaced by a preview. Required before a flow can be activated (mirrors the readiness gate for agents).

## 7. Governance

- Flows run as their owner, subject to RBAC and `data_level`; a step cannot reach data the owner cannot.
- Every activate, edit, run and approval is written to `AuditLog`.
- `output` steps that send data outside the platform require an `approval` step before them unless an admin allows otherwise (policy via `policy_entry`).
- Tool credentials stay server-side; the LLM sees tool names and schemas only.

## 8. Phases

1. **Core:** schema + validator, tables, runner with persisted steps, manual trigger, `query` / `agent` / `output(save)` steps, run history page.
2. **Builder:** chat builder + step list editor + dry run.
3. **Automation:** schedules, `approval` step, email (SES) and Slack notify.
4. **Polish:** canvas editor, branching, templates, event triggers.

Phase 1 alone delivers value and removes the main technical risk (the durable runner).

## 9. Open decisions

1. **Runner location:** in-process first, Fargate worker later *(proposed)*, or worker from day one.
2. **First outbound action:** email via SES *(proposed, AWS already in use)* or Slack.
3. **Navigation:** new "Flows" item under Build, next to Agents *(proposed)*.
4. **Retire the old pipeline tables?** Proposed: leave untouched now, decide later.

## 10. Risks

- Prompt injection through data read by a step (query results, KB text) steering later `output` steps. Mitigation: typed step configs the data cannot rewrite, approval before external sends.
- Cost runaway from scheduled agent steps. Mitigation: per-run and per-flow budgets, pause on repeated failure.
- Scope creep toward a general workflow engine. Mitigation: keep the step set small and typed; add steps only for concrete use cases.
