# 10 — Delivery plan

Bounded, testable vertical slices. Every milestone has falsifiable acceptance tests and a rollback. Sizes assume one engineer familiar with this repo: **S** ≤ 1 day, **M** 2–5 days, **L** 1–2 weeks. These are estimates, not commitments.

## 1. Decisions needed from owners

| ID | Decision | Needed before | Recommendation |
|---|---|---|---|
| D1 | Accept the S1–S4 fixes (code done 2026-10-26: default role `member`, session ownership, admin-only policy/catalog/connection writes, `inspector:use` for SQL) and deploy them | M1b | Confirm Entra group assignment, then merge. The behaviour changes are listed in CHANGELOG |
| D2 | Studio permissions. **Decided 2026-10-27:** the creator owns a workflow; platform admins can do everything, including `connector:write`, `connector:external` and `flow:sql` (granted in code). Other roles get no extra capability permissions. Seeding rows and sharing roles are deferred | M1b | Revisit when workflows can be shared or run |
| D3 | Multi-tenancy scope: stay single-org with `org_id` everywhere, or build memberships now | M3 | Stay single-org for MVP. Plan memberships as a platform project |
| D4 | Approve applying `prisma/migrations/20261025_flows` (create-only). **Dev: approved and applied 2026-10-27.** Staging and production pending | M1b | Apply per environment. Rollback = drop the four new tables |
| D5 | SLO and release thresholds (08 §5) | M3 | Accept as a starting point |
| D6 | Design-system radius rule (≤6px in DESIGN_SYSTEM.md vs `rounded-2xl` in shell pages) | M2b UI | Update DESIGN_SYSTEM.md to match the shell |
| D7 | Does "the conversational AI application" mean Inspector or an external product? | M4 | Either way, the boundary test keeps Studio independent |
| D8 | Three pilot workflows and the real systems behind them (ERP, HR, order API, S3 buckets, Teams/SES), with owners and scopes | M5 | Start with maritime reconciliation (internal data only), then procurement |
| D9 | Email egress domains per org (`FLOWS_EGRESS_EMAIL_DOMAINS`) | M5 | Company domains plus a reviewed supplier list |

## 2. Milestones

| Milestone | Scope | Acceptance (falsifiable) | Rollback | Size | Status |
|---|---|---|---|---|---|
| **M0** Audit and architecture | Audit, capability map, traceability, target architecture, ADR-001…007, plan | Docs reviewed by the owners. Decisions D1–D9 assigned | n/a | — | **Done** (this session). Owner review pending |
| **M1** Contracts and governance skeleton | Flow IR extensions, capability contracts, registry, static policy, runtime gateway, always-enforced routes, boundary test | Tests in 08 §1 pass. Mutation checks fail as expected | Revert commit. No DB change | M | **Done** (this session) |
| **M1b** Persistence and publish (**done on dev 2026-10-27**: save, versions, publish gate, ownership. Remaining: Prisma run store, which belongs to M3) | Apply migration (D4), `PrismaRunStore`, flow and version APIs with ETag, publish gate (no errors + passing simulation on that version), audit events, seed permissions (D2) | Crash a dev run mid-step and resume it; succeeded steps don't re-run. Publish refused with any policy error. Non-owner gets 403. Version immutability test | Feature flag off. Drop the four new tables (create-only migration) | M–L | Blocked on D1, D2, D4 |
| **M2** Creator vertical slice | Goal → template → edit → check & simulate → explanation; UI + API | 5 domain templates simulate to success. UI render tests. Typecheck and build pass | Flag off | M | **Done** (this session). Publish arrives with M1b |
| **M2b** AI planner + ALOFT data | Workbench `mode:'flow'` planner with typed patch tools; `AloftSemanticPort` + `query` executor for dry runs on real governed data (row cap); golden set of 60 goals | ≥80% of golden goals produce a valid, policy-clean flow. Adversarial goals refused or gated. A dry run reads governed rows only (non-governed model → clear failure) | Flag off. The planner is additive | L | Next |
| **M3** Durable execution | Flows worker with lease, scheduler tick, signed webhooks, approvals table + inbox UI, run history and timeline, cost per step, concurrency caps | The 5 tests in 05 §6. Lease contention test. Approval survives restarts | Pause all flows (status). Stop worker. Data stays | L | Planned |
| **M4** Agent runtime | `ModelGateway`, `agent` executor (read-only tools via the gateway), structural data fencing, skills L0–L2, Goal & Progress records, verifier for high-risk steps | Reasoning suite: grounded accuracy, abstention. Injection corpus: zero bypasses. Budgets hold under adversarial loops | Disable the `agent` executor (steps fail fast) | L | Planned |
| **M5** Secure integrations + pilots | Connection registry (`connection:manage`), Secrets Manager refs, live handlers (REST, SES, Teams, S3, OCR) in the worker, egress controls, template library, three pilots (D8) | Least-privilege tests per connection. E2E per pilot on staging systems. No secret in logs (captured-log test) | Disable the handler per capability (`not_enabled`) | L | Planned |
| **M6** Hardening + controlled learning | Threat tests, load and recovery, a11y audit, SLO dashboards, runbooks, OWASP/NIST mapping, improvement proposals with approval, outcome tracking | Pilot readiness checklist (handbook §20) signed | n/a | L | Planned |

## 3. Next five tasks (in order)

1. **N1 — Close the gates that make everything else meaningful (S/M). Done in code 2026-10-26** (CI `verify` not yet run on GitHub; lint left out of the gate because of 147 pre-existing problems). Fix S1–S4 with tests (D1). Add CI steps `npx vitest run`, `npx tsc --noEmit`, `npm run web:typecheck` and `npm run web:check-bundle` before the image push. Repair the ESLint config crash. Remove the server import from `useInspectorChatModels` (00 E21). *Done when:* CI fails on a deliberately broken test, and the bundle guard passes.
2. **N2 — Persistence and publish (M1b, M–L).** After D4: apply the migration to dev; add `PrismaRunStore` with an integration test against a throwaway database (crash/resume); add `POST /flows`, `POST /flows/:id/versions`, `POST /flows/:id/publish` with ETag and audit; a version-pinned simulation becomes the publish gate. *Done when:* the M1b acceptance tests pass.
3. **N3 — ALOFT semantic port + `query` executor (M2b, M).** Wrap `executeSemanticQuery` and connection resolution behind `AloftSemanticPort`; use it in dry runs with `maxRows`; record `context.semantic` availability. *Done when:* the maritime and finance templates dry-run against a governed dev model, and a non-governed model fails clearly.
4. **N4 — Flow planner in the Workbench (M2b, L).** `mode:'flow'` with typed patch tools that validate and policy-check every change. User locks. A 60-goal golden set with a scorer. *Done when:* the M2b creation thresholds are met on the golden set.
5. **N5 — Navigation and publish UX (S/M).** The catalog returns `enabled`. Add a nav entry under Agents only when enabled. Add Save / Publish buttons wired to N2, and a version history list.

## 4. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Building publish and run before S1–S4 are fixed | Permission checks are meaningless in production | N1 first. Publish is gated on D1 |
| Scope creep into a general workflow engine | Never ships | Closed step set. New node families only for a concrete pilot need |
| Planner produces plausible but wrong flows | Wrong automations | Validator + policy + mandatory simulation + approvals before effects + golden set |
| Shared warehouse credential | Over-broad data reach | Semantic-first. `flow:sql` admin-only. Per-user identity as a platform project |
| Connector handlers duplicate side effects | Duplicate emails or writes | Idempotency keys, send markers, M3 fault tests before M5 |
| Pre-existing quality-gate gaps (CI, lint, bundle) | Regressions ship | N1 |
