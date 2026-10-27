# Business AI Studio — working documents

Living design and status documents for Business AI Studio, built in this repository (`aloft-d360`) on the ALOFT foundation. The target direction comes from the *Business AI Studio Architecture, Harness Engineering & Implementation Handbook* v1.0 (26 Oct 2026). The handbook says where we want to go. It is not evidence about the code. These documents say what is true today and how we get there.

**Start here:** [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). It covers what runs, what is proposed, the test evidence and the next tasks.

| # | Document | Answers |
|---|---|---|
| 00 | [Current-state audit](00-current-state-audit.md) | What exists, with file evidence, and where the code and the handbook disagree |
| 01 | [Product capability map](01-product-capability-map.md) | Personas, cross-domain jobs, MVP scope, and the **requirements traceability matrix** |
| 02 | [Target architecture](02-target-architecture.md) | Components, trust boundaries, interfaces, deployment, failure modes |
| 03 | [Domain contracts](03-domain-contracts.md) | Typed definitions, example JSON, versioning, API, persistence |
| 04 | [Harness, skills, reasoning](04-harness-skills-reasoning.md) | Strategy router, skills, tool broker, budgets, the creation harness |
| 05 | [Workflow engine](05-workflow-engine.md) | Flow IR semantics, validation, simulation, runtime choice, recovery |
| 06 | [Connectors and security](06-connectors-security.md) | Capability contracts, policy gateway, secrets, tenancy, threat model |
| 07 | [Memory and learning](07-memory-learning.md) | Memory classes, Goal & Progress memory, boundaries with ALOFT learning |
| 08 | [Evaluations, cost, SLOs](08-evaluations-cost-slos.md) | Measured baselines, eval suites, cost model, release thresholds |
| 09 | [UX and information architecture](09-ux-information-architecture.md) | Journeys, screens, states, accessibility |
| 10 | [Delivery plan](10-delivery-plan.md) | Milestones, exit gates, decisions needed, next tasks |
| — | [ADRs](adr/README.md) | Decisions with evidence, options and revisit conditions |

Related, older documents that remain valid and are referenced rather than repeated:

- [docs/audits/business-ai-studio-current-state.md](../audits/business-ai-studio-current-state.md): a static audit from 24 Oct 2026, with the security findings S1–S15 and reliability findings R1–R8.
- [docs/flows-architecture.md](../flows-architecture.md) and [docs/flows-design.md](../flows-design.md): the Flows plan that the Studio workflow layer extends.
- [docs/data-access-control-design.md](../data-access-control-design.md): the proposed data-access model.

**Labels used throughout:** **Implemented** means the code is in the repo and covered by tests listed here. **Proposed** means it is designed but has no code. **Decision needed** means a human owner must choose. **Unverified** means it cannot be confirmed from the repository.
