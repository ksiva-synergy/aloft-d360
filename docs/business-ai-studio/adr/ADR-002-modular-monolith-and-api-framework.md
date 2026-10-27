# ADR-002 — Modular monolith on the existing Next API; Hono deferred

**Status:** Accepted (provisional) · **Date:** 2026-10-26

## Context

The UI is a Vite + React Router 7 SPA. The API is 160 Next.js 16 route handlers, with NextAuth (Entra) cookies, SSE streaming and Prisma, served from one standalone container that also serves the SPA (`next.config.ts`). The brief lists Hono as a candidate. The 24 Oct audit recommended against migrating (Part 7). Nothing in the repo prototypes Hono.

## Options

| Option | Benefit | Cost / risk |
|---|---|---|
| A. Studio routes as Next route handlers (thin), core framework-free | Zero migration; reuses `resolveAuth`, `handle()`, `writeAudit`; same deploy | Next is heavier than needed for an API |
| B. Separate Hono API for Studio only | Small explicit middleware; a clean contract layer | Second auth stack (NextAuth cookies are Next-shaped), second deploy, CORS or proxy work, duplicate error handling |
| C. Migrate the whole API to Hono | One lighter framework | Rewrite of 160 routes + auth + SSE, high regression risk, and it fixes none of S1–S4 or durability |

## Decision

Option A now. Route handlers stay thin: authenticate → validate (zod) → call the core → JSON (see `src/app/api/agent-lab/flows/*`). Execution that must outlive a request goes to a worker process (ADR-003), not to a different HTTP framework.

## Benchmark that would change this

A framework micro-benchmark would say nothing useful here. Simulation costs 0.24–1.26 ms p50 per flow (08 §1), while live runs will be dominated by model and warehouse latency (seconds). Measure these instead, and adopt B if any holds for two consecutive releases:

1. Studio API p95 overhead above 50 ms attributable to Next routing or middleware, after the handler is excluded.
2. A requirement to deploy the Studio API independently (separate scaling or compliance boundary).
3. External (non-browser) API clients needing an OpenAPI-first contract that Next route handlers can't reasonably provide.

## Consequences

Studio inherits the Next deployment, including its gaps (no tests in CI, see 00 §6). The framework-free core keeps B and C cheap later.
