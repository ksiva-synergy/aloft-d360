# 04 — Agent harness, skills and reasoning

**Principle:** the model proposes and the harness decides. Limits, permissions and approvals are enforced in code (gateway, runner, budget meter). Prompts never enforce them.

## 1. What exists today

| Piece | Where | What it does | Gap for Studio |
|---|---|---|---|
| Tool loop | `src/lib/inspector/agent-loop.ts` `runAgentLoop`; `providers/factory.ts` `dispatchAgentLoop` | One model, parallel tool calls, `maxLoops`, abort flag, optional system-prompt cache point | Lives inside an HTTP request. No plan object, checkpoints, per-run budget, verifier or typed result |
| Per-surface tool allowlists | `agents/chat/route.ts` (`describe_schema`, `execute_tool`), test-run read-only tools | Hard-coded sets | Not data-driven. Not tied to capability contracts |
| Builder (creation) harness | `src/lib/construction/*` patch tools, `readiness`, user locks; commission route | LLM patches a typed draft. A readiness gate controls commission | Agent-only. No multi-step process |
| Model choice | the client sends `model`. `PlatformAgent.routing_mode` is never read | — | No routing by cost or task |
| Cost | `computeCostUsd` (static price table) | — | Workbench and agent chat don't log cost |

## 2. Studio harness modules

| Module | Responsibility | Status |
|---|---|---|
| Strategy router | Pick a strategy per task: rules → closed-set scorer → small model → large model → human | Rules layer implemented for creation (`recommend.ts`). Rest proposed |
| Context assembler | Build the minimal context: goal, pinned skill L1/L2, capability L0 for allowed tools, compact semantic context, checkpoint summary. Untrusted data is fenced | Proposed |
| Skill selector and loader | L0 catalog → L1 manifest → L2 instructions on demand (§4) | Proposed |
| Planner | Typed plan (FlowDefinition patches) with bounded revisions, each validated | Proposed (M2b) |
| Tool broker | **The capability gateway** (`invokeCapability`): contract, egress, budget, permission, idempotency key | **Implemented** |
| Bounded loop | Max model turns, tool calls, wall time and dollars, all enforced in code | Budget implemented for flows. Loop caps exist in `runAgentLoop`. Proposed: unify under one `RunLimits` |
| Verifier / critic | Selective, independent check for high-risk conclusions. Never replaces policy | Proposed |
| Checkpoint store | `RunStore` (step state); goal/progress records (07) | Runner store implemented. Goal store proposed |
| Budget manager | `BudgetMeter`; static worst-case analysis in `checkFlowPolicy` | **Implemented** for flows |
| Evaluator | Scenario and security suites; golden NL set | Partly implemented (08) |

## 3. Strategies

| Strategy | Used for | Guardrails in code |
|---|---|---|
| Direct / rules | Published flows (deterministic steps); template matching | No LLM. `transform` is pure code |
| Closed-set scorer | Low-risk routing, e.g. picking a template or a step type | Must abstain below a calibrated threshold. Never authorizes anything |
| Plan-and-execute | Creating and editing flows (Solution Architect) | Output = typed patches → `validateFlow` + `checkFlowPolicy`. Max N revisions (proposal: 4) |
| Bounded ReAct | `agent` steps that investigate unknowns (finance variance) | Read-only tool allowlist, `maxLoops`, step `timeoutMs`, `BudgetMeter`. Output reviewed by an `approval` step where consequential |
| Reflection / critic | High-risk conclusions only | Separate call with its own budget. Its verdict is evidence, not a permission |

**Jev-style closed-choice scorer.** Optional and never a dependency. Adopt it only if a benchmark on the golden routing set (08 §2) shows all of these against the small-model baseline: (a) top-1 accuracy within 2 points, (b) a calibrated abstain at ≥95% precision on accepted answers, (c) lower p95 latency and total cost per 1,000 decisions. A score is not a probability. Calibrate it on held-out data before using it as confidence.

## 4. Skills

**Package format (proposed).** One directory per skill, versioned with semver:

```yaml
# skill.yaml (L1 manifest; small enough to load for every candidate)
id: finance.variance-explainer
version: 1.2.0
summary: Explain budget variance from cost lines with stated uncertainty.
applies_to: { step_types: [agent], tags: [finance, budget, variance] }
requires:
  capabilities: []            # a skill cannot grant tools; listed for validation only
  semantic: [model.finance_budget]
inputs: { rows: "array of cost lines" }
output_contract: { text: string, confidence: "low|medium|high", evidence: "array of account ids" }
instructions: instructions.md # L2, loaded only when selected
references: [examples/*.md]   # L3, loaded on demand
tests: tests/*.json           # golden cases run before publish
provenance: { author: "…", approved_by: "…", approved_at: "…" }
```

**Loading rules.** Select by deterministic tags first, then retrieval over summaries. Load L1 for at most k candidates (proposal: 5) and L2 for the chosen one. Load L3/L4 only when a tool asks for them. Security rules live in code (gateway, policy), not in skill text. **Skills cannot grant capabilities, permissions or budget.** The validator rejects a skill whose `requires.capabilities` are not on the agent's allowlist.

**Lifecycle.** Author → lint (schema) → dependency check → sandbox tests (simulation) → eval suite → security review → approve → publish → monitor → deprecate. Pin versions per published agent or flow. An upgrade requires a passing regression run on the pinned fixtures.

## 5. Creation harness (Solution Architect)

| Step (handbook §5) | Implementation |
|---|---|
| Intake | Goal box (UI). Clarifying questions only for missing required bindings (connection, approver) |
| Classify | Rules: a flow with an `agent` step is hybrid. A goal with no repeatable trigger is an agent. Ambiguous → ask. Implemented for flows; agent-vs-flow is proposed |
| Discover | Template match (`recommendTemplates`, implemented). Capability L0 catalog (`/catalog`). ALOFT governed models via `buildSemanticContext` (proposed, M2b) |
| Plan | **Proposed (M2b):** a `mode: 'flow'` in workbench chat with tools `set_trigger`, `add_step`, `update_step`, `remove_step`, `add_input`, `set_budget`, `validate_flow` (see flows-architecture §10). Every tool call applies a patch, then runs `validateFlow` + `checkFlowPolicy`, and returns the issues so the model self-corrects |
| Compile | The definition *is* the IR. Publish pins capability versions and resolves template bindings |
| Validate | `validateFlow` + `checkFlowPolicy` (**implemented**) |
| Simulate | `simulateFlow` (**implemented**), with fixtures and failure drills |
| Publish | Proposed M1b: explicit creator approval, plus elevated approval when any step is `risk: high` |

The model never emits free text that becomes executable. It can only produce values that pass the zod schema, the validator and the policy check.

## 6. Context and cost tactics

- **Prompt caching:** `runAgentLoop` already supports `cacheSystemPrompt`. Use it for stable planner system prompts that contain the capability L0 catalog and the step-type guide. Cache hits must be measured from `agent_loop_log` cache-read tokens, not assumed.
- **Compact context:** pass checkpoint summaries and evidence ids, not full transcripts. Cap fenced data blocks (the step output cap is 4,000 characters in simulation; 1 MB is proposed for persisted runs).
- **Untrusted data fencing:** step outputs embedded in an `agent` prompt are wrapped as delimited data with an explicit "data, not instructions" note (templates already say this in prose). The proposed `agent` executor adds structural delimiters. Retrieved documents, email and web content never change the definition. The definition is immutable per version, and every control field is `literal`.
- **Model selection:** default to the cheapest model that passes the eval set for that skill. Escalate on low confidence or verifier disagreement, and record the escalation reason.
