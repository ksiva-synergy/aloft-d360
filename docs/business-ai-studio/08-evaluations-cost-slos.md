# 08 — Evaluations, cost and SLOs

## 1. Measured baselines (26 Oct 2026, Windows 11, Node v24.18.1)

| Measurement | Before this session | After | Command |
|---|---|---|---|
| Unit and integration tests | 80 files / 617 tests pass | **84 files / 655 tests pass** | `npx vitest run` |
| Flow core tests | 1 file / 18 tests | 3 files / 47 tests | `npx vitest run src/lib/flows` |
| Studio API contract tests | — | 5 tests | `npx vitest run src/app/api/agent-lab/flows` |
| Studio UI render tests | — | 4 tests | `npx vitest run src/views/agent-lab/flows` |
| Root typecheck | exit 0 | exit 0 | `npx tsc --noEmit` |
| Web typecheck | (not run before) | exit 0 | `npx tsc -p web/tsconfig.json --noEmit` |
| Typography guard | passes | passes (23 tests) | `npx vitest run src/lib/typography` |
| SPA production build | — | succeeds (57 s). Flows chunk 18 KB, zero server markers | `npm run web:build` |
| Bundle guard | — | **fails for a pre-existing reason** (00 E21). The Flows chunk is clean | `npm run web:check-bundle` |
| Lint | **crashes** (00 E20) | crashes (unchanged) | `npx eslint <file>` |
| Mutation: disable egress check | — | 2 tests fail (expected) | manual edit, then restored |
| Mutation: revert single-pass resolver | — | 1 test fails (expected) | manual edit, then restored |
| Mutation: drop condition-value ref validation | — | 1 test fails (expected) | manual edit, then restored |

**Deterministic pipeline latency** (`analyzeFlow` = validate + policy + explain + simulate, 300 iterations after 20 warm-up, in-process):

| Template | p50 | p95 |
|---|---|---|
| procurement-po-follow-up | 0.47 ms | 1.24 ms |
| finance-budget-variance | 0.39 ms | 1.05 ms |
| hr-new-starter-onboarding | 0.35 ms | 0.88 ms |
| maritime-certificate-reconciliation | 1.26 ms | 2.55 ms (includes cron next-run computation) |
| integration-order-webhook | 0.24 ms | 0.71 ms |

**Not measured:** model latency and tokens (no LLM call is made by anything built so far), real connector latency, worker throughput (ADR-003 benchmark), and real cache hit rates.

## 2. Evaluation suites

| Suite | Cases today | Release metric | Status |
|---|---|---|---|
| Cross-domain creation (templates → valid, policy-clean, simulated) | 5 domains + 2 branch variants | 100% valid and simulated on pinned fixtures | **Implemented** (`studio.test.ts`) |
| Security fixtures (approval bypass, data-bound controls, unknown capability/fields, permissions, raw SQL, budget, injected recipient, verbatim data, SSRF, contract break, live permission re-check) | 11 | Zero bypasses | **Implemented** |
| Workflow reliability (retry, fail-fast, skip propagation, resume, timeout, cancel) | 10+ in-memory | All pass; crash/resume on a real DB in M3 | **Implemented** (in-memory) |
| NL creation golden set (goal → flow) | 0 | Runnable-graph rate; structural match to expected; correct agent/workflow/hybrid choice | Proposed M2b: start with **60 goals** (12 per domain, including 10 unsupported or adversarial), grow to hundreds. Two labellers; report inter-rater agreement |
| Template routing (goal → template or abstain) | 6 assertions | Top-1 accuracy, abstain precision | Implemented as a smoke test. Becomes the routing benchmark for any scorer (04 §3) |
| Agent-step reasoning (finance variance, certificate summary) | 0 | Grounded accuracy (cites provided rows only), abstention when evidence is missing | Proposed M4 |
| UX (novice creator tasks) | 0 | Time to first successful simulation; task completion | Proposed M6 (moderated sessions) |
| Operations (worker loss, DB failover, model outage) | 0 | RTO/RPO, SLO attainment | Proposed M6 |

Rule: every change to a model, skill, capability contract or engine runs these suites against pinned fixtures. A regression blocks release.

## 3. Cost model

**Unit of value:** cost per *successful* run (run `succeeded` and, where the flow has approvals, approved). It is not cost per token.

| Cost source | How it is estimated today | How it will be measured |
|---|---|---|
| AI step | `computeCostUsd(model ?? 'claude-sonnet-4', 6000 in, 1000 out)` = **$0.033** at the repo's list prices (`src/lib/lifecycle/log-agent-cost.ts`). The flow core default without a price function is $0.05 | Actual `usage` per call → `agent_turn_log` / `agent_cost_log`, summed onto the step and run |
| Capability calls | `estimatedCostUsd` per contract (email $0.0001, S3 list $0.000005, OCR $0.05 per document, an assumption) | Provider billing tags per connection |
| Compute | Not estimated (negligible for deterministic steps: ~1 ms) | Worker task-seconds |
| Retries | Worst case = Σ cost × (retries + 1) | Attempt counts per step |

Example estimates (from the templates): finance variance ≈ **$0.033 per run** (one AI step) against a $0.50 budget. Maritime reconciliation ≈ $0.033 against $0.25. Procurement ≈ $0.0001. These are list-price planning numbers, not observations.

**Tactics** (AI only where it adds value): deterministic transforms for filtering and reconciliation (no model), `when` conditions that skip AI when there is nothing to explain (the finance template skips the agent at threshold 30%: tested cost $0), prompt caching for stable planner prompts, cached extraction of unchanged documents keyed by `(tenant, content hash, schema, model/prompt version)`. Caches must respect authorization and never bypass access checks.

## 4. Telemetry to add (M3)

Per run and per step: status, attempts, duration, input/output/cached tokens, model, cost, connector, retries, approval wait time, outcome. Attribute by tenant, flow, version, step and model. Reuse `agent_turn_log`/`LlmCall` ids rather than a new LLM log. Dashboards: success rate, p50/p95 duration, cost per successful run, top failing steps, budget stops.

## 5. Proposed SLOs and release thresholds (to confirm, D5)

| Area | Target (proposal) |
|---|---|
| Simulate API | p95 < 500 ms server time for ≤40 steps (measured core: < 3 ms p95) |
| Run start latency (manual) | p95 < 5 s from request to first step running |
| Scheduled run punctuality | 99% start within 2 min of the slot |
| Run correctness | 0 duplicate external side effects in the fault-injection suite; 100% resume after worker kill |
| Availability (control plane) | 99.5% monthly (same as the web app) |
| Creation quality (M2b gate) | ≥80% of golden goals produce a valid, policy-clean flow; ≥90% correct workflow/hybrid/agent choice; 100% of adversarial goals refused or gated |
| Security gate | Zero critical bypasses in the security suite; S1–S4 closed |
| Cost | Cost per successful run reported for 100% of runs; no run exceeds its budget |
