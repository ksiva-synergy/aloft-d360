# ADR-004 — Agent runtime, strategy router, model gateway, Jev-style scorer

**Status:** Proposed (needed before M4; the creation planner in M2b uses the same gateway) · **Date:** 2026-10-26

## Context

`runAgentLoop` / `dispatchAgentLoop` already handle Bedrock Converse streaming, OpenAI-compatible providers, parallel tools, `maxLoops`, abort and prompt caching (`src/lib/inspector/*`). They run inside HTTP requests, take the model the client chose, and record turn metrics. There is no plan object, budget or verifier. The brief requires Studio's own harness, without coupling to the conversational application.

## Decision (proposed)

1. **ModelGateway port** in the Studio core: `complete({model, system, messages, tools, limits, budget, signal}) → {text, toolCalls, usage, costUsd}`. One adapter wraps `dispatchAgentLoop` and does nothing else. Provider fallback, caching flags and cost logging live in the adapter. The Studio harness owns planning, budgets, checkpoints, tool brokering (through the capability gateway) and verification.
2. **Strategy router** order: deterministic rules → closed-set scorer (optional) → small model → large model → human. The rule layer exists for creation (`recommendTemplates`).
3. **Agent steps** run read-only tools only. Every tool call goes through `invokeCapability`. Limits (`maxLoops`, tool calls, `timeoutMs`, `BudgetMeter`) are enforced in code.
4. **Jev-style scorer** is optional and never authorizes anything. It is adopted only if it passes the benchmark in 04 §3: accuracy within 2 points of the small-model baseline, ≥95% precision on accepted answers at the calibrated abstain threshold, and lower p95 latency and cost per 1,000 decisions.

## Alternatives rejected

- **A second provider stack for Studio.** It duplicates the Bedrock and Foundry logic and fixes.
- **Calling the Inspector chat route from Studio.** That couples Studio to Inspector session handling and the SSE shape, and Inspector auth is observe-mode by default.
- **An agent framework dependency (e.g. a graph-agent library).** No evidence it beats a thin harness over the existing loop. It adds a supply-chain surface.

## Revisit when

A provider feature (for example server-side tool execution or native structured outputs) needs a code path the current loop can't express. Or turn metrics show the loop's overhead above 10% of p95 step latency.
