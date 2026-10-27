# ADR-005 — Capability contracts and a single policy gateway

**Status:** Accepted (provisional) · **Date:** 2026-10-26

## Context

The five proof scenarios need REST calls, email, team notifications, object-store listing and document extraction. Today only Databricks queries execute (`execute_tool`). Tools are hard-coded per route. Policy rows (`policy_entry`) are never read. The handbook asks for a tool gateway that authorizes every call, egress and SSRF guards, and no credentials in prompts.

## Options

1. **Step type per integration** (`email`, `slack`, `s3`, …). Simple, but every new integration means new schema, validator and UI code, and domain-specific code paths multiply.
2. **Generic `tool` step + versioned capability contracts + one gateway.** Integrations become data (contracts) plus a handler. Policy is uniform.
3. **Pass-through MCP/OpenAPI tools.** Fast to add, but side effects and risk are unknown, and every operation becomes available.

## Decision

Option 2, implemented in `src/lib/capabilities/` and `src/lib/flows/policy.ts`:

- A contract declares side effect, risk, approval rule, required permission, field binding (`literal` vs `data`), egress class, input schema, cost, idempotency, `describe()` and `simulate()`.
- **Static checks** at authoring and publish: unknown capability or field, missing field, literal-field binding, permission, approval ancestor, budget.
- **Runtime gateway** on every call: live-mode permission re-check, input contract, egress (email domain allowlist, relative HTTP paths), budget charge, idempotency key to the handler, and no execution without a registered live handler.
- MCP and OpenAPI operations enter only as reviewed contracts (Option 3 is rejected as a pass-through; ADR-012).

## Consequences

New integrations need a contract plus a handler, with no change to schema or UI. Simulation and live runs share one code path, so simulated policy behaviour is the real behaviour. The proposed permissions (`connector:write`, `connector:external`) must be seeded before publishing (D2).

## Evidence

`studio.test.ts` (static policy gate, runtime gateway blocks); mutation checks in 08 §1.
