# 05 — Decisions Needed & Next Steps

Please review the pack and decide the items below. Recommended defaults are marked **(recommended)**.

---

## Decisions

| # | Decision | Options | Recommendation | Why it matters |
|---|---|---|---|---|
| 1 | Overall direction | (a) Optimize in place; (b) Python rewrite; (c) Rust rewrite | **(a)**, with Python for new worker services | See [01-runtime-language-research.md](./01-runtime-language-research.md): the language is not the bottleneck |
| 2 | Start Phase 0 baseline now? | Yes / No | **Yes** | Without "before" numbers, savings can't be proven |
| 3 | Phase 1 scope | All 9 items / a subset | **All**, in the order of [04-implementation-plan.md](./04-implementation-plan.md) §Phase 1 | Most of the value, low risk |
| 4 | Model-facing SQL sample size | 20 / 30 / 50 rows; cap 8K / 12K / 16K characters | **30 rows, 12K characters** (env-tunable) | Balances token saving against answer quality |
| 5 | Run 2 processes on the instance | pm2 / custom cluster wrapper / keep 1 | **pm2-runtime** | Simple, well known, restarts crashed workers |
| 6 | Node version | Stay on 20 / move to 22 | **22 LTS** | Free performance; Node 20 nears end of life |
| 7 | HNSW index creation | Manual `CONCURRENTLY` by DBA / normal migration in a quiet window | **Manual `CONCURRENTLY`**, recorded in a migration | No table lock in production |
| 8 | Who builds the answer-quality evaluation set? | Product / Backend / both | **Both**: product supplies questions, backend automates | Guards token cuts against quality loss |
| 9 | Phase 3 worker language | TypeScript / **Python** | Team's choice: **Python** fits extraction and AI libraries | Lets the team use Python where it helps most |
| 10 | Cloud team availability for Phase 3 | Dates | — | CloudFront, Fargate Spot, worker infrastructure |
| 11 | Budget for a staging load test | Yes / No | **Yes** (k6 + stubbed LLM: no token cost) | Turns estimates into measured capacity |

---

## Proposed timeline (after approval)

| Week | Work | Output |
|---|---|---|
| 1–2 | Phase 0 baseline (passive); build the evaluation set; add the A21 metrics counters | "Before" table |
| 2 | Phase 1 items 1.1–1.4 (token + client changes) behind flags | PRs + evaluation results |
| 3 | Phase 1 items 1.5–1.9 (2 processes, Node 22, index, selects, polling) | PRs + k6 result |
| 4 | Compare before/after; decide on Phase 2 | Results report |
| 5–8 | Phase 2 | PRs |
| 9+ | Phase 3 with the cloud team | Infra + worker |

---

## What I need from you to start

1. A **go / no-go** on decisions 1–3.
2. Answers or defaults for decisions 4–8.
3. Read access, or someone who can export, CloudWatch and `agent_turn_log` data for Phase 0.

Once approved, implementation starts with **1.1: cap model-facing SQL results**. It is the single largest token saving, and a flag can switch it off.
