# ADR-006 — Tenancy and authorization for Studio

**Status:** Proposed. Blocked on decisions D1 (fix S1–S4) and D3 (multi-tenancy scope) · **Date:** 2026-10-26

## Context

There is one org per deployment (`DEFAULT_ORG_ID`, `getDefaultOrg`). New users are created as `admin` (`src/lib/rbac.ts:19`). Several mutating routes check only that a session exists (S2–S4). Warehouse access uses one service principal.

## Decision (proposed)

1. **Studio routes always enforce** `resolveAuth` + `requirePermission`. They never follow `INSPECTOR_AUTH_ENFORCE`. Implemented for the preview routes.
2. **Permissions** (seeded via `prisma/seed.ts` and a data migration, after D2): `flow:read`, `flow:write`, `flow:publish`, `flow:run`, `flow:approve`, `flow:sql`, `connector:write`, `connector:external`, `connection:manage`. Suggested default grants: member gets read, write and run; admin gets everything except `flow:sql`, which only platform_admin gets.
3. **Run identity** = flow owner. Permissions are re-checked on every capability call at run time. An owner who is deactivated or demoted causes fast failure, and the flow auto-pauses after N failures.
4. **Tenant scope:** every Studio table carries `org_id`. Every query filters by the org resolved from the session once memberships exist. Until then it uses the env org. Add cross-tenant negative tests the day a second org exists.
5. **Approvers:** a named user or a role per approval step (open question 4 in flows-architecture §17). Only the assignee or a holder of the role can decide.

## Preconditions

S1 (default role) must be fixed first. While every new user is an admin, permission checks give no protection in production.

## Revisit when

Multi-org memberships are introduced (D3), or per-user warehouse identity becomes available.
