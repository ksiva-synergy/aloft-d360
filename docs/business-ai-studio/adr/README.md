# Architecture decision records

Format: context → options → decision → consequences → evidence → revisit when. A decision marked **Accepted (provisional)** is in effect for the current milestone and needs owner sign-off before M1b (publish). A decision marked **Proposed** needs that sign-off before its milestone starts.

| ADR | Title | Status |
|---|---|---|
| [001](ADR-001-studio-boundary-and-aloft-adapter.md) | Studio boundary inside aloft-d360; ALOFT consumed through ports | Accepted (provisional) |
| [002](ADR-002-modular-monolith-and-api-framework.md) | Modular monolith on the existing Next API; Hono deferred | Accepted (provisional) |
| [003](ADR-003-workflow-runtime.md) | Workflow runtime: Postgres-leased worker first, Temporal on explicit triggers | Proposed |
| [004](ADR-004-agent-runtime-and-model-routing.md) | Agent runtime, strategy router, model gateway, Jev-style scorer | Proposed |
| [005](ADR-005-capability-contracts-and-policy-gateway.md) | Capability contracts and a single policy gateway | Accepted (provisional) |
| [006](ADR-006-tenancy-and-authorization.md) | Tenancy and authorization for Studio | Proposed (blocked on D1, D3) |
| [007](ADR-007-secrets-and-egress.md) | Secrets, connector isolation and egress | Proposed |
| [013](ADR-013-document-extraction.md) | Document extraction: Grok directly now, the DATA360 OCR gateway later (with plans for both gateway options) | Accepted (provisional) |

Not yet written. Each is due before its milestone:

| ADR | Topic | Due |
|---|---|---|
| 008 | Skill package format and progressive loading (draft in 04 §4) | M4 |
| 009 | Memory scopes, retention and learning approval (draft in 07) | M4 |
| 010 | Immutable definition versioning and migration (draft in 03 §6) | M1b |
| 011 | Observability, evaluation and release gates (draft in 08) | M3 |
| 012 | MCP and OpenAPI import of capability contracts | M5 |
