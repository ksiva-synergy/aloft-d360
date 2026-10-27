# ADR-001 — Studio boundary inside aloft-d360; ALOFT consumed through ports

**Status:** Accepted (provisional) · **Date:** 2026-10-26

## Context

The brief asks for an independent Business AI Studio that consumes ALOFT's governed semantic layer and learning services through explicit interfaces, without duplicating them and without coupling to "the conversational AI application". In the repository, ALOFT is not a separate service. The semantic layer (`src/lib/semantic`), memory (`src/lib/memory`) and the conversational analyst (`src/lib/inspector`) are in-process modules of one Next.js application (00 §2). A Flows core already exists in `src/lib/flows` with no framework imports.

## Options

1. **New repository or service for Studio**, calling ALOFT over HTTP. Strong isolation. But ALOFT has no service API, so one would have to be built first, plus a second auth, deploy and on-call surface. Months before the first user value.
2. **New workspace package** (`packages/studio-core`). Compile-time isolation. Needs changes to tsconfig, the vitest and Next transpile setup, and the build for a team that ships one image today. The isolation it buys can be had more cheaply (option 3).
3. **Modules in `src/lib` with an enforced import boundary** (`src/lib/flows`, `src/lib/capabilities`), ports for ALOFT and model access, and adapters in the API layer.

## Decision

Option 3. The Studio core (`flows`, `capabilities`, and later `skills`, `goals`) must not import Next, NextAuth, Prisma, the AWS SDK, `@/lib/inspector`, `@/lib/construction` or `@/middleware`. `src/lib/flows/__tests__/boundary.test.ts` enforces this. ALOFT capabilities are reached only through ports implemented in adapters:

- `AloftSemanticPort` → `executeSemanticQuery`, `buildSemanticContext` (read only).
- `AloftMemoryPort` → `selectMemoryAll` / `formatForInjection` (read only, flag-gated).
- `ModelGateway` → `dispatchAgentLoop` (provider calls only; ADR-004).
- Pricing → `computeCostUsd`, injected as a function.

Studio never writes semantic mappings, taught rules or FOER memory (07).

## Consequences

- The core can move to a worker or another HTTP framework without change (ADR-002, ADR-003).
- One provider stack is shared with Inspector. The coupling is one adapter file per port.
- If the conversational AI product named in the brief is an external system, nothing here depends on it. If it means Inspector, the boundary test already prevents imports.

## Evidence

`src/lib/flows/__tests__/boundary.test.ts` passes. Every current Studio core file imports only zod, cron-parser and other core modules. 00 §8 has the reuse table.

## Revisit when

Studio needs separate scaling, release cadence or a separate security boundary (for example, untrusted connector code). Then extract `src/lib/flows` + `src/lib/capabilities` into a package or service. The ports are already the seam.
