# 02 — Capacity & Cost Model (t4g.medium)

**Question asked:** How many users can the current t4g.medium handle with today's code? How many after optimization? How many with Rust? And how do we improve without upsizing, to save cost?

> **All numbers in this document are engineering estimates** from code structure and typical behaviour. They are **not measured**. §6 explains how to replace them with real numbers.

---

## 1. The hardware we have

| Property | t4g.medium | Why it matters |
|---|---|---|
| vCPU | 2 (Graviton2, ARM64) | We use only one today (single Node process) |
| RAM | 4 GB | Enough for 2 Node processes with heap limits |
| CPU model | **Burstable**: baseline **20% per vCPU** | Sustained use above ~0.4 vCPU total spends CPU credits |
| Credits | Earns 24 credits/hour; max balance 576 | One credit = one vCPU at 100% for 1 minute |
| Unlimited mode (default for T4g) | Above-baseline use after credits run out is billed as **surplus credits** | **Wasted CPU time is billed money** |

Source: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances.html

**What this means for us:** a burstable instance is cheap only while average CPU stays near the 20% baseline. Any CPU we waste, such as compressing static files, parsing PDFs, JSON-stringifying large SQL results or answering polling, either drains credits (slower when exhausted in standard mode) or adds surplus charges (unlimited mode).

---

## 2. What limits how many users we can serve

Different limits apply to different kinds of work:

| Type of work | Example | The real limit today |
|---|---|---|
| **Agent conversations** (Inspector, agents) | A user asks a question; 3–15 LLM loops | LLM provider quotas and latency, the Databricks warehouse, the DB pool (15) |
| **Light API calls** | Lists, details, job status, dashboards | **Single-core CPU**, auth overhead, DB queries |
| **Static assets** | SPA JavaScript, CSS, images | Node CPU (compression) and bandwidth |
| **Heavy CPU tasks** | PDF/Office upload, SSR chart rendering | **One core, shared with everyone** |
| **Polling** | Job status every 3 s, dashboards every 5–60 s | Multiplies light API calls per open tab |

---

## 3. Estimated capacity today vs after optimization vs Rust

"Concurrent agent runs" means conversations actively generating at the same moment. "Active users" means people using the app over the same few minutes. Most are reading, not generating.

| Metric | Today (1 process) | After Phase 1 | After Phases 1–3 | Rust rewrite (same hardware, no other fixes) |
|---|---|---|---|---|
| Concurrent agent runs | ~10–30 | ~20–40 | ~30–60 | ~10–30 (same external limits) |
| Active chatting users | ~40–120 | ~80–200 | ~120–300 | ~40–120 |
| Light API requests/second | ~300–1,000 | ~600–2,000 | ~1,000–3,000 | ~3,000–10,000+ |
| Memory used by the app | ~300–600 MB | ~600 MB–1.2 GB (2 processes) | same | ~30–80 MB |
| One large PDF upload | Slows **everyone** | Slows half | **Isolated** (worker) | Slows less (parallel cores) |
| Token cost per question | 100% (baseline) | ~50–70% | ~30–60% | **100%** (unchanged) |

### Why agent concurrency is similar in Rust and Node

An agent run spends seconds **waiting**. Node and Rust can both wait on thousands of connections cheaply. What stops us running more agents at once:

- Bedrock / gateway **rate limits** (tokens per minute, requests per minute)
- Databricks **warehouse concurrency** (queued queries)
- **DB pool** size (15 connections)
- Token **budget** (money)

None of these change with the language. They **do** change when each run uses fewer tokens, fewer loops and fewer queries, which is what Phases 1–2 do.

---

## 4. Where the money goes (cost model)

### 4.1 Cost categories

| Category | Drivers | How we reduce it |
|---|---|---|
| **LLM tokens** (likely the largest variable cost) | Input tokens × loops; output tokens; post-turn calls; harvest T2/T3/T4 | Cap tool results, prompt caching, history trimming, loop budgets, `maxTokens`, cheap-model routing |
| EC2 t4g.medium | Fixed hourly + **surplus CPU credits** | Use both cores efficiently, move CPU work off, serve static files via CDN |
| Databricks SQL warehouse | Running hours (warehouse awake) | Fewer, batched queries; change-driven harvest; fewer wake-ups |
| ECS Fargate (harvest) | vCPU-seconds + GB-seconds per task, including startup | Precompiled image, worker reuse, Spot, right-sizing |
| Aurora PostgreSQL | Instance size / ACUs, I/O | Indexes, less polling, narrow selects, caching |
| Data transfer | SPA assets, large JSON responses | CloudFront caching, pagination |

### 4.2 Worked example — token cost of one Inspector question

Assumptions:
- 6 loops
- system prompt + tool schemas ≈ 6,000 tokens
- one SQL result of 500 rows × 10 columns ≈ 15,000 tokens, returned in loop 2
- other context ≈ 2,000 tokens growing per loop

| Scenario | Approx. input tokens | vs today |
|---|---|---|
| **Today** (no caching, full result kept in history) | 6 × 6K (prompt) + 5 × 15K (result resent) + ~20K other ≈ **~131K** | 100% |
| + cap model-facing result to ~2.5K tokens | 36K + 5 × 2.5K + 20K ≈ **~69K** | ~53% |
| + prompt caching (cached reads billed at a fraction of normal input price) | prompt portion mostly billed at the cached rate ≈ **~40–45K effective** | ~30–35% |
| + intent loop budget (simple question finishes in 3 loops) | ≈ **~20–25K effective** | ~15–20% |

Bedrock prompt caching: https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html. AWS states cached input is billed at a reduced rate and lowers latency. The exact discount and the minimum cacheable prompt size depend on the model. Confirm for the models we route to, including through the LLM Lite gateway.

**Monthly impact formula** (fill in with Phase 0 data):

```
monthly_token_cost = questions_per_month
                   × avg_input_tokens × input_price
                   + questions_per_month × avg_output_tokens × output_price
savings = monthly_token_cost × (1 − new_tokens / old_tokens)
```

### 4.3 Worked example — harvest (Fargate + Databricks)

| Lever | Mechanism | Typical saving on that portion |
|---|---|---|
| Precompiled harvester (no `npx tsx`) | Shorter startup per task | Startup time per task (tens of seconds × number of tasks) |
| Worker reuse | One task processes several child jobs | Removes repeated cold starts |
| **Fargate Spot** for scheduled/backfill jobs | Spare-capacity pricing | AWS advertises **up to 70%** off on-demand (https://aws.amazon.com/fargate/pricing/) |
| Change-driven weekly T1 | Only changed tables re-profiled | Proportional to the unchanged share of the estate (often most of it) |
| Batched Databricks profiling | Fewer queries per table | Shorter warehouse awake time |

Combined, these give the **−30% to −60%** estimate for harvest cost. **Minus means a saving.**

---

## 5. Why not just upsize?

| Option | Monthly cost change | Fixes token waste? | Fixes one PDF slowing everyone? |
|---|---|---|---|
| t4g.medium → t4g.large (8 GB) | Roughly 2× instance cost | No | No (still one process unless changed) |
| t4g.medium → t4g.xlarge | Roughly 4× | No | No |
| **Optimize (this plan)** | **Lower**: fewer tokens, fewer surplus credits | **Yes** | **Yes** (Phase 3) |

Upsizing hides the waste, and costs more every month. Optimizing removes it.

---

## 6. How we will measure real capacity

### 6.1 Baseline (Phase 0) — collect for 1–2 weeks

| Metric | Source |
|---|---|
| `CPUUtilization`, `CPUCreditBalance`, `CPUCreditUsage`, `CPUSurplusCreditsCharged`, `CPUSurplusCreditBalance` | CloudWatch → EC2 (instance) |
| p50 / p95 / p99 latency, 4xx/5xx | Beanstalk enhanced health / ALB metrics |
| Memory (RSS) | Beanstalk enhanced health or a `/api/health` metrics extension |
| Tokens per turn (input, output, cache read/write), loops per turn, `llmMs`, `toolMs`, `firstTokenMs` | `agent_turn_log`, `agent_loop_log` |
| Daily LLM spend by feature | Provider billing + model registry feature mapping |
| DB CPU, connections, top queries | RDS Performance Insights, `pg_stat_statements` |
| Fargate task count × duration; Databricks warehouse hours | ECS console / Cost Explorer; Databricks billing |

### 6.2 Load test (after Phase 1, on staging)

- **Tool:** k6 (https://k6.io).
- **LLM stub:** replace the provider with a fake that streams a realistic answer over 3–8 seconds and returns realistic token counts. This avoids real token cost and provider limits during the test.
- **Mix:** 70% light API calls (lists, job status), 20% agent chat, 10% dashboards.
- **Ramp:** 10 → 200 virtual users over 20 minutes.
- **Record:** the user count where p95 latency exceeds the target (for example 2 s for light APIs) or the error rate exceeds 1%.
- **Result:** a measured "users per t4g.medium" figure, before vs after.
