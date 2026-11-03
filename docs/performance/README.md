# Performance & Cost Optimization — Documentation Pack

**Date:** 2026-10-31
**Status:** For review. No code or infrastructure has been changed.
**Goal:** Serve more users, answer faster and spend less on AWS and LLM tokens. Do it **on the current hardware**: one Elastic Beanstalk **t4g.medium**, 2 vCPU burstable Graviton, 4 GB RAM.

---

## How to read this pack

| # | Document | What it answers | Read time |
|---|---|---|---|
| 1 | [01-runtime-language-research.md](./01-runtime-language-research.md) | Should we rewrite in Python or Rust? What does the research say? | 15 min |
| 2 | [02-capacity-and-cost-model.md](./02-capacity-and-cost-model.md) | How many users does the t4g.medium handle today, after optimization, and with Rust? Where does the money go? | 15 min |
| 3 | [03-optimizations-explained.md](./03-optimizations-explained.md) | Each optimization in plain language, with analogies and examples | 20 min |
| 4 | [../audits/performance-and-cost-optimization-report.md](../audits/performance-and-cost-optimization-report.md) | The technical audit: about 70 findings with file references, fixes, impact and effort | 30 min |
| 5 | [04-implementation-plan.md](./04-implementation-plan.md) | For each item: how it will be built, risk, rollback and how we prove it worked | 25 min |
| 6 | [05-decisions-and-next-steps.md](./05-decisions-and-next-steps.md) | **Decisions needed from you** before work starts | 5 min |

If you only have 10 minutes, read the summary below and then **document 6**.

---

## One-page summary

### The answer in three sentences

1. **Most of our cost and slowness comes from how the code uses LLMs, the database and the CPU, not from the programming language.**
2. **About a week of low-risk code changes (Phase 1) should cut token spend substantially and roughly double what the current server can handle.**
3. **A Rust or Python rewrite would take months and keep the same waste unless that waste is fixed anyway.** Fix the waste first and measure. Add Python later as a separate worker if the team prefers.

### Top five problems found

| # | Problem | Plain meaning | Where |
|---|---|---|---|
| 1 | Full SQL results are sent to the model and resent every step | We pay to send the model a whole spreadsheet five or six times when it needed a summary once | `src/lib/inspector/tools.ts`, `agent-loop.ts` |
| 2 | Prompt caching is off for Inspector chat | We pay full price for the same instructions on every step | `agent-loop.ts`; only 2 places enable it |
| 3 | Only one of two CPU cores is used | Half the server we pay for sits idle | `Dockerfile` (single `node server.js`) |
| 4 | PDF and Office processing runs on the web server | One big file slows every user | `src/lib/extraction/render.ts`, `src/lib/knowledge/readers.ts` |
| 5 | Semantic search has no index | Every search reads the whole table | `platform_context_embeddings` (no HNSW index) |

### Expected results (estimates, to be confirmed by measurement)

| Metric | Phase 1 (≈1 week) | Phases 1 + 2 (≈1 month) |
|---|---|---|
| Inspector input tokens per question | −30% to −50% | **−40% to −70%** |
| Inspector output tokens per question | −15% to −25% | **−20% to −40%** |
| Time to answer | −10% to −20% | **−15% to −35%** |
| API requests per second, same server | ~1.7–2× | **~2–3×** |
| CPU credit surplus charges | lower | near zero at today's load |
| Database load from polling and dashboards | −30% | **−50% or more** |
| Harvest Fargate and Databricks cost | small | **−30% to −60%** after Phase 3 |

A minus sign means **less cost, time or load** (savings).

### Phases

| Phase | Duration | Risk | Needs AWS or cloud team? | Delivers |
|---|---|---|---|---|
| 0 — Baseline | 1–2 weeks (passive) | None | Read access to CloudWatch | "Before" numbers |
| 1 — Quick wins | ~1 week | Low | One Dockerfile change and one DB index | Most token savings, ~2× capacity |
| 2 — Structural | 2–4 weeks | Medium | No | Deeper token and latency savings, less DB load |
| 3 — Architecture | 1–2 months | Medium | **Yes** (CloudFront, worker, Fargate Spot) | Harvest savings, CPU isolation |
