# 01 — Product capability map

## 1. Product contract

A business user describes what they want to accomplish. Studio helps them create, test, publish, operate and refine one of three assets, without learning orchestration internals:

| Asset | Meaning | Repo representation |
|---|---|---|
| **Workflow** | Versioned, deterministic process | `FlowDefinition` with no `agent` steps (`src/lib/flows/schema.ts`) |
| **Hybrid** | Durable workflow containing bounded AI steps | `FlowDefinition` with ≥1 `agent` step. `explainFlow` reports `kind: 'hybrid'` |
| **Agent** | Goal-oriented, adaptive assistant with a tool allowlist and budget | Today: `agent_catalog` + Workbench commission. Target: `AgentDefinition` (03 §3) |

Agents assist people. They do not replace employees. Sharing is private, team or organisation, plus an optional community template library. There is no paid marketplace.

## 2. Personas

These come from handbook §1, mapped to who uses ALOFT today. The mapping is an **assumption** until user research is done (10, task R1).

| Persona | Needs from Studio | First surfaces |
|---|---|---|
| Individual creator (superintendent, analyst, buyer) | Describe a goal, get a working draft, test safely | Goal box, templates, simulation |
| Team owner | Share flows, see runs, own approvals | Run history, approvals inbox (M3) |
| Enterprise admin | Grant connector and flow permissions, set egress and budgets | Governance settings (M5) |
| Compliance reviewer | See what a flow can touch, and the audit evidence | Explanation, access panel, audit (M3) |
| Developer / integration engineer | Register connections and capabilities, write contracts | Capability registry (M5), JSON definition editor |
| Business approver | Approve consequential steps with context | Approval request with evidence (M3) |
| Operator | Monitor failures, cost, retries | Runs and observability (M3/M6) |

## 3. Capability inventory

| ID | Capability | MVP | Status |
|---|---|---|---|
| C1 | Goal intake ("What would you like to accomplish?") with a template recommendation that abstains | yes | **Implemented (rules)** |
| C2 | NL → typed flow plan (LLM planner with typed patches) | yes | Proposed (M2b) |
| C3 | Agent / workflow / hybrid classification | yes | **Implemented** for flows (`kind`). Agent-vs-flow routing is proposed |
| C4 | Typed flow IR: steps, refs, conditions, budgets, triggers | yes | **Implemented** |
| C5 | Static structural validation | yes | **Implemented** |
| C6 | Capability contracts and registry (versioned, side-effect classified) | yes | **Implemented** (5 built-ins) |
| C7 | Static policy check (approvals, bindings, permissions, budget) | yes | **Implemented** |
| C8 | Runtime policy gateway (contract, egress, budget, permission re-check) | yes | **Implemented** |
| C9 | Simulation with mocked side effects and failure drills | yes | **Implemented** |
| C10 | Plain-language explanation (does, access, AI use, approvals, cost, limits) | yes | **Implemented** |
| C11 | Save drafts and immutable published versions | yes | Proposed (needs DB, M1b) |
| C12 | Durable runs, retries, idempotency, resume | yes | Core implemented. Persistence and worker proposed (M3) |
| C13 | Triggers: manual, schedule, event, webhook | yes | Schema implemented. Runtime proposed (M3) |
| C14 | Human approvals that survive the request | yes | Proposed (M3) |
| C15 | Governed ALOFT semantic query step | yes | Contract implemented. Executor proposed (M2b) |
| C16 | Agent step (bounded, read-only tools) | yes | Contract implemented. Executor proposed (M4) |
| C17 | Live connectors: REST, email, team notify, S3 list, OCR | P0 subset | Contracts implemented. Live handlers proposed (M5) |
| C18 | Connections and secrets (vault references, scopes) | yes | Proposed (M5). Databricks precedent exists |
| C19 | Skills registry and progressive loading | after MVP | Proposed (M4) |
| C20 | Goal & Progress memory | after MVP | Proposed (M4/M6) |
| C21 | Run timeline, audit, cost per outcome | yes | Simulation timeline implemented. Persisted telemetry proposed (M3) |
| C22 | Sharing: private, team, org | yes | Proposed (needs tenancy decisions) |
| C23 | Visual canvas editing (xyflow) with one source of truth | after MVP | Proposed (`@xyflow/react` and `dagre` already installed) |
| C24 | Evaluation suites as release gates | yes | Scenario and security suites implemented. Golden NL set proposed |
| C25 | Controlled learning (improvement proposals → approval) | later | Proposed (M6) |

**MVP exclusions** (handbook §1, confirmed for this repo): unrestricted autonomous writes; arbitrary user code (no step evaluates code, by construction); hundreds of shallow connectors; self-modifying production agents; multi-agent swarms; a paid marketplace; per-user warehouse identity (a separate platform project, see 06 §5).

## 4. Cross-domain proof scenarios

All five run through the **same** code path: `analyzeFlow` → `validateFlow` → `checkFlowPolicy` → `explainFlow` → `simulateFlow`. No scenario has code of its own. Each one is data in `src/lib/flows/templates.ts`.

| Scenario | Template id | Capabilities and steps used | What it proves |
|---|---|---|---|
| Procurement PO follow-up | `procurement-po-follow-up` | webhook trigger, `http.request` GET, `when`, approval, `email.send`, `notify.message`, `output` | Approval gates external sends. Recipient comes from data but is egress-checked |
| Finance variance investigation | `finance-budget-variance` | semantic `query`, `filter`, `agent` (hybrid), approval, `output`, budget | AI only runs when there is something to explain. Stated uncertainty. Budget enforced |
| HR onboarding | `hr-new-starter-onboarding` | webhook, human approval, `http.request` POST (write), `email.send`, `notify.message` | Writes need approval. Parallel-ready dependencies |
| Maritime certificate reconciliation | `maritime-certificate-reconciliation` | schedule, semantic `query`, `object_store.list`, `anti_join`, `filter`, `agent` | Reconciliation as a generic transform. Schedule preview |
| Generic custom API | `integration-order-webhook` | webhook → `http.request` → `filter` → `when` → `notify.message` → `output` | Condition-gated notification. The audit record is always written |

Evidence: `src/lib/flows/__tests__/studio.test.ts`, block "one pipeline, five business domains".

## 5. Requirements traceability matrix

Phase = milestone in [10-delivery-plan.md](10-delivery-plan.md). Tests are paths under `src/`.

| Req | Requirement (source) | Doc § | Component | Repo module | Public contract | Tests | Phase |
|---|---|---|---|---|---|---|---|
| R1 | Goal-first entry, recommendation that abstains (HB §5.1–2, brief UX) | 09 §2, 04 §5 | Solution Architect | `lib/flows/recommend.ts` | `GET /api/agent-lab/flows/catalog?goal=` | `studio.test.ts` › recommendTemplates; `routes.test.ts` | M2 ✔ |
| R2 | Typed, versionable definitions (HB §4) | 03 §2 | Definition registry | `lib/flows/schema.ts` | `FlowDefinition` (zod) | `flows.test.ts`, `studio.test.ts` | M1 ✔ (schema), M1b (store) |
| R3 | Reject cycles, unknown refs, invalid cron (HB §5.6) | 05 §3 | Static validator | `lib/flows/validate.ts` | `validateFlow` → `FlowIssue[]` | `flows.test.ts` › validateFlow | M1 ✔ |
| R4 | Capability contracts with side effects, risk, idempotency (HB §4, §9) | 03 §4, 06 §2 | Capability registry | `lib/capabilities/{types,builtin,registry}.ts` | `CapabilityDefinition`, `CapabilitySummary` | `routes.test.ts` (catalog); `studio.test.ts` | M1 ✔ |
| R5 | Missing approval before consequential action is rejected (HB §5.6, §10) | 06 §3 | Policy | `lib/flows/policy.ts` | `PolicyFinding{code:'missing_approval'}` | `studio.test.ts` › requires an approval | M1 ✔ |
| R6 | Control values cannot come from run data (HB §10 injection) | 06 §3 | Policy | `lib/flows/policy.ts` | `data_bound_control_field` | `studio.test.ts` › rejects control fields | M1 ✔ |
| R7 | Per-call authorization, no reliance on prompts (HB §9) | 06 §3 | Policy gateway | `lib/capabilities/gateway.ts` | `invokeCapability` | `studio.test.ts` › re-checks permission | M1 ✔ (live handlers M5) |
| R8 | Egress and SSRF guards (HB §9) | 06 §3 | Policy gateway | `gateway.ts` `isSafeRelativePath`, email allowlist | `PolicyDeniedError{code:'egress'}` | `studio.test.ts` › blocks a recipient; refuses a path | M1 ✔ |
| R9 | Budgets and kill on exhaustion (HB §12) | 08 §3 | Budget manager | `gateway.ts` `BudgetMeter`; `policy.ts` | `budget.maxCostUsd`; `budget_too_low` | `studio.test.ts` › rejects a budget | M1 ✔ |
| R10 | Policy denials are not retried (HB §8) | 05 §4 | Runner | `lib/flows/runner.ts` | `retryable: false` | `studio.test.ts` (attempts = 1) | M1 ✔ |
| R11 | Simulation with mocked side effects and failure injection (HB §5.7) | 05 §5 | Simulator | `lib/flows/simulate.ts` | `SimulationReport` | `studio.test.ts`; `FlowsPreviewPage.test.tsx` | M2 ✔ |
| R12 | Explain what it does, access, AI use, cost, approvals, limits (HB §14) | 09 §3 | Explainer | `lib/flows/explain.ts` | `FlowExplanation` | `studio.test.ts`; `routes.test.ts` | M2 ✔ |
| R13 | Data inserted verbatim (no re-expansion of injected refs) | 05 §2 | Resolver | `lib/flows/resolve.ts` `mapRefs` | — | `studio.test.ts` › inserts data verbatim | M1 ✔ |
| R14 | Five unrelated domains on one foundation (brief) | 01 §4 | All | `lib/flows/templates.ts` | `FlowTemplate` | `studio.test.ts` (5 × it.each) | M2 ✔ |
| R15 | Studio core independent of framework, DB and conversational runtime (brief) | ADR-001/002 | Boundary | `lib/flows`, `lib/capabilities` | — | `boundary.test.ts` | M1 ✔ |
| R16 | Always-enforced auth on Studio APIs | 06 §4 | API | `app/api/agent-lab/flows/_shared.ts` | 401/403/404 contract | `routes.test.ts` | M1 ✔ |
| R17 | UI shows results from the real API contract, light and dark | 09 | Studio web | `views/agent-lab/flows/index.tsx` | — | `FlowsPreviewPage.test.tsx` | M2 ✔ |
| R18 | Immutable published versions, rollback (HB §4, §8) | 03 §6 | Definition registry | `PlatformFlowVersion` (schema) | `POST /flows/:id/versions` (proposed) | — | M1b |
| R19 | Durable runs, crash/resume, idempotency (HB §8) | 05 §6 | Runtime | `runner.ts` + Prisma store (proposed) | `RunStore` | runner resume tests (in-memory) | M3 |
| R20 | Approvals that survive the request (HB §8) | 05 §7 | Approvals | proposed `PlatformFlowApproval` | `POST /runs/:id/steps/:step/decision` | — | M3 |
| R21 | Governed semantic data via an ALOFT adapter (HB §3) | ADR-001, 07 | ALOFT adapter | proposed `lib/flows/executors/query.ts` | `AloftSemanticPort` | — | M2b |
| R22 | Bounded agent steps (HB §6) | 04 | Agent harness | proposed `lib/agents/run-agent-once.ts` | `ModelGateway` port | — | M4 |
| R23 | Skills progressive loading (HB §7) | 04 §4 | Skills | proposed `lib/skills` | `SkillPackage` | — | M4 |
| R24 | Goal & Progress memory with scope and retention (HB §11) | 07 | Memory | proposed | `GoalRecord` | — | M4/M6 |
| R25 | Cost per successful outcome tracked (HB §12) | 08 §4 | Cost ledger | `computeCostUsd` + proposed run columns | — | — | M3 |
| R26 | Tenant isolation proven by tests (HB §20) | 06 §5 | Tenancy | `org_id` columns; single-org today | — | — | M6 (decision D3) |
