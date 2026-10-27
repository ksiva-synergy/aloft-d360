# 03 — Domain contracts

Every contract below is validated with zod at the boundary where it enters. Published artifacts are immutable. Every persisted record carries the tenant (`org_id`). No definition holds secret material.

## 1. Schema principles

1. **Stable ids, immutable published versions.** Editing makes a new version. Runs reference the exact version id.
2. **Closed vocabularies.** Step types, operators, side-effect classes and risk tiers are enums. No step evaluates code.
3. **Explicit side effects.** Every operation is classified `none | read | write | external`, with a risk tier and an approval rule.
4. **Binding rules on inputs.** Each capability field is `literal` (fixed at authoring) or `data` (may be filled from run data).
5. **Provenance.** Generated artifacts record their origin (`template`, `planner:<model>`, `user`). Proposed for M1b.
6. **Backward compatibility.** Flow schema changes must be additive while any published version exists. Before then (today) the schema may change freely. A breaking change after that needs a migration function `vN → vN+1` plus tests.

## 2. FlowDefinition — **Implemented** (`src/lib/flows/schema.ts`)

| Field | Type | Notes |
|---|---|---|
| `name`, `description?` | string | ≤120 / ≤1000 chars |
| `trigger` | `manual` \| `schedule{cron}` \| `event{name}` \| `webhook{name}` | Cron is 5-field UTC. Webhook payloads are accepted only as the declared typed `inputs` |
| `inputs[]` | `{name, type: string\|number\|boolean, required, default?, description?}` | ≤20 |
| `budget?` | `{maxCostUsd}` | Per-run limit enforced before each paid call |
| `steps[]` | 1–40 steps | See below |

Common step fields: `id` (`^[a-z][a-z0-9_]{0,39}$`), `name?`, `dependsOn[]`, `retries` (0–5), `timeoutMs` (1 s–5 min), and `when?` = `{ref: "{{…}}", operator, value}`.

| Step `type` | `config` | Side effect |
|---|---|---|
| `query` | exactly one of `semantic` (mirrors `SemanticQuery`) or `sql`; `connection?`; `maxRows` | read |
| `retrieve` | `query`, `namespace?`, `topK` | read |
| `agent` | `agentSlug?` (literal), `prompt`, `model?` (literal) | read (read-only tools), uses AI |
| `transform` | `filter` \| `limit` \| `count` \| `anti_join` | none |
| `approval` | `message`, `assignee?` (email) | none (pauses) |
| `output` | `kind: 'save'`, `title`, `content` | write (internal) |
| `tool` | `capability`, `version?`, `input{}` | from the capability contract |

References: `{{inputs.<name>}}` and `{{steps.<id>.<path>}}`, allowed in any string. A string that is exactly one ref keeps the value's type. Embedded refs are stringified in a **single pass**, so data is never re-scanned for refs or `$`-patterns.

Example (the generic custom-API template, trimmed):

```json
{
  "name": "Order status webhook to REST and alert",
  "trigger": { "type": "webhook", "name": "order-status-changed" },
  "inputs": [{ "name": "order_id", "type": "string" }, { "name": "status", "type": "string" }],
  "steps": [
    { "id": "fetch_order", "type": "tool", "retries": 2,
      "config": { "capability": "http.request",
                  "input": { "connection": "orders-api", "method": "GET", "path": "/orders/{{inputs.order_id}}" } } },
    { "id": "backordered", "type": "transform",
      "config": { "op": "filter", "input": "{{steps.fetch_order.body.lines}}", "field": "status", "operator": "eq", "value": "backordered" } },
    { "id": "alert", "type": "tool",
      "when": { "ref": "{{steps.backordered.rowCount}}", "operator": "gt", "value": 0 },
      "config": { "capability": "notify.message",
                  "input": { "channel": "order-desk", "text": "Order {{inputs.order_id}} has {{steps.backordered.rowCount}} backordered line(s)" } } },
    { "id": "audit", "type": "output", "dependsOn": ["backordered"],
      "config": { "kind": "save", "title": "Order {{inputs.order_id}} → {{inputs.status}}", "content": "{{steps.backordered.rowCount}} backordered" } }
  ]
}
```

## 3. Proposed contracts

| Entity | Minimum fields | Persistence | Phase |
|---|---|---|---|
| **AgentDefinition** | id, version, goal, instructionsRef, skillRefs[] (pinned), toolAllowlist[] (capability@version), modelPolicy `{default, escalation[], maxLoops}`, memoryPolicy, budget, risk, owner, org_id | new `studio_agent_definitions` + `_versions`. Migrate from `agent_catalog` by import, never by sharing the table | M4 |
| **SkillPackage** | id, semver, manifest (L1), instructions (L2), references (L3), artifacts (L4), dependencies, tests, scope, provenance, approval | `studio_skills` + object storage for L3/L4 | M4 |
| **Connection** | id, org_id, provider, authMode (`iam_role`\|`oauth`\|`secret_ref`), secretRef, resourceScope, allowedCapabilities[], owner, status, rotatedAt | `studio_connections` (secret value stays in Secrets Manager) | M5 |
| **Template** | id, domain, definition, sampleInputs, fixtures, bindings[], visibility (`org`\|`community`) | code today (`templates.ts`), later `studio_templates` | M5 |
| **Run (Execution)** | id, org_id, flow_id, version_id, trigger, status, inputs, triggered_by, correlation_id, cost_usd, total_tokens, timestamps; lease `{locked_by, locked_until}` | `platform_flow_runs` (exists in schema) + lease columns | M3 |
| **StepRun** | run_id, step_id, status, attempt, output (capped 1 MB), error, skip_reason, llm_call_id, cost_usd, idempotency_key | `platform_flow_step_runs` (exists) + `skip_reason`, `cost_usd`, `idempotency_key` | M3 |
| **Approval** | id, run_id, step_id, assignee (user or role), message, evidence refs, status, decided_by, decided_at, note, expires_at | new `platform_flow_approvals` | M3 |
| **Evidence** | id, source (step/run/doc), version, location/span, provenance, access scope, verification status | new `studio_evidence` | M4 |
| **Evaluation** | suite id, case id, input, expected shape, scorer, result, model/skill versions | new `studio_eval_*` (do not reuse unused `agent_eval_*` until inspected) | M2b/M6 |
| **Goal/Progress record** | owner, scope, goal, plan, checkpoints[], decisions[], blockers, outcome, evidence refs, ttl | new `studio_goals` | M4/M6 |

## 4. CapabilityDefinition — **Implemented** (`src/lib/capabilities/types.ts`)

`id`, `version` (semver), `title`, `description`, `provider`, `tags[]`, `sideEffect`, `risk`, `approval` (`required`|`recommended`|`none`), `requiredPermission`, `classify?(literalInput)` (e.g. GET is a read, POST a write), `fields{name: {binding, required?, egress?, description}}`, `input` (zod, checked at call time), `estimatedCostUsd`, `idempotency` (`natural`|`key`), `describe(input)`, and `simulate(input)` (a pure mock).

Built-ins (`src/lib/capabilities/builtin.ts`):

| Capability | Side effect | Risk | Approval | Permission | Literal fields |
|---|---|---|---|---|---|
| `http.request@1.0.0` | read (GET), write (POST/PUT/PATCH), write/high (DELETE) | low / medium / high | none / required / required | `inspector:use` / `connector:write` | `connection`, `method` |
| `email.send@1.0.0` | external | high | required | `connector:external` | — (recipient is data, egress-checked) |
| `notify.message@1.0.0` | external | low | none | `connector:external` | `channel` |
| `object_store.list@1.0.0` | read | low | none | `inspector:use` | `connection`, `maxKeys` |
| `document.extract@1.0.0` | read | low | none | `inspector:use` | `connection`, `schema` |

`connector:write` and `connector:external` are **proposed and not seeded** (decision D2 in 10).

## 5. Analysis outputs — **Implemented**

- `PolicyFinding {severity: error|warning, code, message, stepId?}`. Codes: `unknown_capability`, `unknown_field`, `missing_field`, `data_bound_control_field`, `missing_permission`, `missing_approval`, `raw_sql` (warning), `egress_unconfigured` (warning), `budget_too_low`, `budget_may_stop_run` (warning), `no_budget` (warning).
- `FlowExplanation {name, kind, trigger, nextRuns[], steps[], aiSteps[], approvals[], externalEffects[], access{permissions, connections, capabilities}, cost{expectedUsd, worstCaseUsd, budgetUsd?}, limitations[]}`.
- `SimulationReport {notice, status, error?, steps[{stepId, type, status, attempts, skipReason?, error?, input?, output?, mocked, effect?, costUsd, durationMs}], totals}`. Inputs and outputs are capped at 4,000 characters each.
- `FlowAnalysis = {ok:false, issues} | {ok:true, flow, order, findings, cost, explanation, simulation?, readyToPublish}`.

## 6. Versioning and lifecycle

| Artifact | Version scheme | Lifecycle | Rules |
|---|---|---|---|
| Flow | integer per flow (`platform_flow_versions.version`) | draft → validated → simulated → approved → published → paused/retired | Publish requires zero policy errors and a successful simulation **on that version**. Runs pin `version_id`. Running executions finish on their version. Migration of in-flight runs is never automatic |
| Capability | semver | registered → deprecated → removed | A flow step pins `version` at publish. A breaking contract change is a major bump. Removing a version blocks publishes that reference it and flags running flows |
| Skill | semver | author → lint → test → eval → review → approve → publish → deprecate | Pinned per agent or flow version. Upgrades need a passing regression run |
| Template | id + content hash | — | Templates are copied into a new flow, never referenced live |

## 7. API

All under `/api/agent-lab/flows`. Every route calls `resolveAuth` + `requirePermission` (always enforced) and returns JSON errors `{error, details?}`.

| Method & path | Status | Purpose | Permission |
|---|---|---|---|
| `GET /catalog[?goal=]` | **Implemented** | Capabilities (L0), templates, goal matches, egress allowlist, publishing status | `inspector:use` |
| `POST /simulate` | **Implemented** | `{definition, inputs?, fixtures?, faults?}` → `FlowAnalysis`. 422 when invalid, 413 above 256 KB | `inspector:use` |
| `GET /`, `POST /` | Proposed M1b | List and create flows | `flow:read` / `flow:write` |
| `POST /:id/versions` | Proposed M1b | Save an immutable version (validated + policy-checked). `If-Match` ETag | `flow:write` |
| `POST /:id/publish` | Proposed M1b | Requires zero errors plus a passing simulation on that version. Writes audit | `flow:publish` (+ capability permissions) |
| `POST /:id/run` | Proposed M3 | `Idempotency-Key` header required | `flow:run` |
| `GET /:id/runs`, `GET /runs/:runId` | Proposed M3 | Run history and timeline | `flow:read` |
| `POST /runs/:runId/cancel` | Proposed M3 | — | `flow:run` |
| `POST /runs/:runId/steps/:stepId/decision` | Proposed M3 | Approve or reject with a note. Only the assignee or role | `flow:approve` |
| `POST /webhooks/:name` | Proposed M3 | HMAC-signed. Payload validated against declared inputs | signature, no session |

## 8. Persistence mapping

| Contract | Table | State |
|---|---|---|
| Flow, FlowVersion, Run, StepRun | `platform_flows`, `platform_flow_versions`, `platform_flow_runs`, `platform_flow_step_runs` | In `schema.prisma` and `migrations/20261025_flows`. **Not applied (unverified)** |
| Schedule, Approval, run lease | `platform_flow_schedules`, `platform_flow_approvals`, lease columns | Proposed |
| Audit | `AuditLog` via `writeAudit` | Exists |
| LLM usage and cost | `agent_turn_log`, `agent_loop_log`, `LlmCall`, `agent_cost_log` | Exists. Flows will reference them by id |
