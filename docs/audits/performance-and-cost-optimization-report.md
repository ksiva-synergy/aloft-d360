# Performance & Cost Optimization Report

**Date:** 2026-10-31
**Scope:** Whole platform — web/API server, LLM token spend, database, background jobs (harvest/memory), frontend network behaviour.
**Constraint:** Improve performance and reduce cost **on the current hardware** (one Elastic Beanstalk **t4g.medium**: 2 vCPU burstable Graviton, 4 GB RAM). No instance upsizing.
**Status:** Analysis only. Nothing in this report has been implemented yet.
**Part of:** [Performance documentation pack](../performance/README.md). It covers research, the capacity model, plain-language explanations, the implementation plan and decisions.

---

## Contents

1. [Executive summary](#1-executive-summary)
2. [How the platform spends resources today](#2-how-the-platform-spends-resources-today)
3. [Top 15 actions (ranked)](#3-top-15-actions-ranked)
4. [Area A — LLM token spend & latency](#4-area-a--llm-token-spend--latency)
5. [Area B — Web server runtime (t4g.medium)](#5-area-b--web-server-runtime-t4gmedium)
6. [Area C — Database (Aurora PostgreSQL + Prisma)](#6-area-c--database-aurora-postgresql--prisma)
7. [Area D — Background jobs (harvest T0–T4, memory)](#7-area-d--background-jobs-harvest-t0t4-memory)
8. [Area E — Frontend network behaviour](#8-area-e--frontend-network-behaviour)
9. [Phased roadmap](#9-phased-roadmap)
10. [Measurement plan (prove the savings)](#10-measurement-plan-prove-the-savings)
11. [Rust / Python question — conclusion](#11-rust--python-question--conclusion)
12. [Method, verification & corrections](#12-method-verification--corrections)

---

## 1. Executive summary

**The biggest savings are in how the code uses LLMs, the database and the CPU, not in the programming language.** Five problems account for most of the avoidable cost:

| # | Problem | Where | What it costs |
|---|---|---|---|
| 1 | **Full SQL results are sent to the model, then resent on every later loop** | `src/lib/inspector/tools.ts` (`return JSON.stringify(sqlResult)`) + `agent-loop.ts` | Largest single source of wasted input tokens; slower answers |
| 2 | **Prompt caching is off for Inspector chat** | Only 2 call sites set `cacheSystemPrompt: true` (flows copilot, blueprint) | System prompt and tool schemas paid in full on every loop |
| 3 | **Only one of two CPU cores is used** | `Dockerfile` → single `node server.js` | Half the instance is idle while requests queue |
| 4 | **Heavy CPU work (PDF/Office parsing, rendering) runs on the web server** | `src/lib/extraction/render.ts`, `src/lib/knowledge/readers.ts` | One big PDF slows every user |
| 5 | **Vector search has no index on the hot table** | `src/lib/context/describe.ts` → `platform_context_embeddings` (no HNSW in migrations) | Full scan + distance math per semantic request |

**Expected combined effect, if Phases 1–2 of the roadmap are done** (engineering estimates; Section 10 shows how to measure them):

| Metric | Estimated change |
|---|---|
| Inspector input tokens per question | **−40% to −70%** (result capping + history trimming + prompt caching) |
| Inspector output tokens per question | **−20% to −40%** (per-phase `maxTokens`, thinking only when needed) |
| Time to answer (Inspector) | **−15% to −35%** |
| API requests/second on the same t4g.medium | **~2–3×** |
| CPU-credit drain / surplus charges | Substantially lower |
| DB load from polling and dashboards | **−50% or more** |
| Fargate minutes & Databricks warehouse time for harvest | **−30% to −60%** (change-driven T1, worker reuse, batched queries) |

---

## 2. How the platform spends resources today

```
Browser (Vite SPA)
   │  every page asset + every API call + 3–5 s polling
   ▼
ONE Node process on t4g.medium  (uses 1 of 2 vCPUs)
   ├─ serves SPA static files + compression
   ├─ ~190 API route files, auth (JWT in proxy + getServerSession again in routes)
   ├─ Inspector / agent chat loops (stream, up to 15–32 LLM loops)
   ├─ PDF/Office parsing + canvas rendering (CPU heavy)
   ├─ fire-and-forget post-turn work (scoring, attribution, memory)
   └─ Prisma pool = 15 connections (+ raw pg connections for locks)
        │
        ├─► Aurora PostgreSQL + pgvector
        ├─► LLMs: Bedrock, LLM Lite gateway, Foundry/Azure, xAI  (new client per call)
        └─► Databricks SQL (plain fetch, no shared keep-alive agent)

EventBridge / web launch ─► ECS Fargate (0.5 vCPU / 1 GB)  `npx tsx orchestrator.ts`
                             one task per job / child job (up to 5 parallel)
```

**Key facts used throughout this report:**

- t4g.medium sustains only **~20% per vCPU** (≈0.4 vCPU total) without spending CPU credits. In unlimited mode, sustained load above that is billed as surplus credits. **Every CPU-second saved on the web server is a direct cost saving.**
- One agent question = up to 15 (default) or 32 (max) LLM calls, and each call resends the whole conversation. **Token cost per question grows faster than linearly with loop count.**
- A platform model registry already exists (`src/lib/llmlite/model-registry.ts`, `MODEL_FEATURES`). It is the natural place to route cheap tasks to cheap models.
- Per-loop token metrics (`LoopMetrics` in `agent-loop.ts`, stored via `record-turn-metrics.ts`) already exist. They are enough to measure most of the changes below.

---

## 3. Top 15 actions (ranked)

Ranked by **value ÷ effort**. Effort: S ≈ under a day, M ≈ 1–3 days, L ≈ a week or more.

| Rank | Action | Area | Saves | Effort |
|---|---|---|---|---|
| 1 | Cap model-facing tool results (rows, columns, characters); summarise instead of raw rows | LLM | Tokens, latency | **S** |
| 2 | Turn on prompt caching for Inspector/agent chat; put the cache point after the *stable* part of the prompt | LLM | Tokens, latency | **S–M** |
| 3 | Run 2 Node processes (one per vCPU); split DB pool ~8 + 8 | Runtime | CPU, throughput | **S** |
| 4 | Reuse one LLM client per provider (Bedrock/OpenAI singletons) | LLM/Runtime | Latency, CPU | **S** |
| 5 | Add HNSW index on `platform_context_embeddings.embedding`; cache the "index health" count query | DB | DB CPU, latency | **S** |
| 6 | Per-phase `maxTokens` (≈1K for tool turns, 4K only for final answer) and thinking only for complex intents | LLM | Output tokens | **S–M** |
| 7 | Intent-based loop budgets (3–5 simple / 8–10 investigative / 15 complex) | LLM | Tokens, latency | **M** |
| 8 | Real cancellation: pass `AbortSignal` into LLM + Databricks calls when the user disconnects or times out | LLM/Runtime | Tokens, CPU | **M** |
| 9 | Trim conversation history between loops (keep latest tool turn, summarise older ones) | LLM | Tokens | **M** |
| 10 | Slow down and share polling (3 s → back-off 5–15 s, pause when tab hidden, one shared query per job) | Frontend/DB | DB, CPU | **S–M** |
| 11 | Narrow `select` on JSON-heavy list queries (`agent_catalog`, context reads `SELECT *`) | DB | DB, memory | **S** |
| 12 | Move PDF/Office extraction and server-side chart rendering to the Fargate worker | Runtime | CPU, tail latency | **M–L** |
| 13 | Precompile the harvester (esbuild/tsup → `node dist/…`) instead of `npx tsx` at runtime | Jobs | Fargate time | **M** |
| 14 | Make weekly T1 change-driven; batch Databricks metadata/profile queries | Jobs | Databricks + Fargate | **M–L** |
| 15 | Serve SPA assets from CloudFront/S3 (or nginx), not Node | Runtime | CPU, bandwidth | **M** |

---

## 4. Area A — LLM token spend & latency

### 4.1 Where LLMs are called

| Feature | Call | Location |
|---|---|---|
| Inspector chat (main loop) | Bedrock `ConverseStream`, or Foundry/xAI/LLM Lite equivalents | `src/lib/inspector/agent-loop.ts`, `src/lib/inspector/providers/foundry-chat.ts` |
| Chart generation (+ repair) | Separate forced-tool call | `src/lib/inspector/chart-emitter.ts`, `chart-pipeline.ts` |
| Session knowledge | Separate call per turn | `src/lib/inspector/session-knowledge-llm.ts` |
| Memory compression (optional) | Bedrock | `src/lib/memory/compress.ts` |
| Harvest T2/T3/T4 | LLM Lite (Grok 4.7 default) / Bedrock | `src/lib/context/harvest-llm.ts`, `harvester-llm.ts`, `enrich.ts` |
| Embeddings | Titan / Azure `text-embedding-3-large` | `src/lib/azure/embed-client.ts`, `src/lib/context/embed.ts` |
| Boost scorers | OpenAI-compatible | `src/lib/boost/scorers/llm-client.ts` |
| FOER clustering | Bedrock | `src/lib/foer/run-cluster.ts` |
| Document extraction | xAI | `src/lib/extraction/extract.ts` |
| Studio insights | OpenAI-compatible | `src/lib/studio/insights.ts` |
| Catalog agents, flows copilot, dashboard blueprint, titles | Various | `src/lib/agents/run-catalog-agent.ts`, `src/lib/flows-copilot/propose.ts`, `src/lib/dashboards/blueprint-propose.ts`, … |

### 4.2 How one Inspector question spends tokens (illustrative)

A question that takes **6 loops** and runs one SQL query returning **500 rows × 10 columns** (~60 KB JSON ≈ ~15,000 tokens):

| Loop | Sent to model | Note |
|---|---|---|
| 1 | system + tools + question | |
| 2 | … + SQL tool call + **15K-token result** | result added |
| 3–6 | … + the same **15K tokens again, each loop** | +60K tokens resent |

**About 75,000 input tokens are spent on one result set the model only needed to see once, in summary form.** With result capping (≈2–3K tokens) and history trimming, the same question costs roughly 10–15K tokens for that data. That is a **~80% reduction on this part**, before prompt caching.

### 4.3 Findings

| ID | Finding | Evidence | Fix | Impact | Effort |
|---|---|---|---|---|---|
| A1 ✅ | **Full SQL result returned to the model.** UI gets ≤1,000 rows; the model gets the entire `sqlResult`. | `src/lib/inspector/tools.ts` — `cappedRows = rows.slice(0, 1000)` for UI, but `return JSON.stringify(sqlResult)` | Return a model-facing summary: column list + types, row count, first ~20–50 rows, simple aggregates; hard cap ~8–12 KB. Tell the model the full data is in the UI / CSV tool. | **Very high** | S |
| A2 ✅ | **Tool results are resent on every later loop.** Trajectory is trimmed to 2,000 chars, but the message history keeps the full result. | `agent-loop.ts` — `toolResult` pushed unchanged into `messages`; `output.slice(0, 2000)` only for trajectory | After the model has used a result, replace it in history with a short digest (row count, columns, key values). | **High** | M |
| A3 ✅ | **Prompt caching off for Inspector/agent chat.** | `cacheSystemPrompt: true` only in `flows-copilot/propose.ts` and `inspector/semantic/[modelId]/blueprint/route.ts` | Enable for Inspector and catalog agents. | **High** | S |
| A4 | **Cache boundary is after the *whole* system prompt.** Any per-request text (date, user, retrieved context, memory bullets) inside it breaks the cache. | `agent-loop.ts` (system = `[{text}, {cachePoint}]`) | Split into a stable prefix (instructions + tool policy), then cachePoint, then dynamic context. | **High** | M |
| A5 | **Tool schemas resent every loop** and not trimmed per intent. | `agent-loop.ts` (`toolConfig: tools`), `chart-emitter.ts` (full chart DSL schema) | Cache tools; send only the tools relevant to the intent; shorten descriptions. | **High** | M |
| A6 ✅ | **`maxTokens: 4096` on every loop**, including tool-selection turns that need ~100–300 tokens. | `agent-loop.ts` `inferenceConfig.maxTokens: 4096` | ~1,024 for tool turns; 2–4K only for the final answer. | **High** | S |
| A7 ✅ | **Thinking enabled (1,024 budget, temperature 1) for every eligible turn.** | `agent-loop.ts` `thinking: { budget_tokens: 1024 }` | Disable for simple lookups and tool-only turns; keep for complex investigations. | **High** | M |
| A8 ✅ | **High default loop budget** (15, max 32). | `src/lib/inspector/max-loops.ts` | Classify intent first: simple 3–5, investigative 8–10, complex 15. | **High** | M |
| A9 | **Chart generation is a second LLM call** (plus a possible repair call) after the main loop. | `chart-emitter.ts`, `chart-pipeline.ts` | Pick chart type deterministically first (column kinds → bar/line/table); only call the LLM when ambiguous, or have the main loop emit the chart spec. | **High** for chart questions | M |
| A10 | **Chart prompt lists every column profile.** | `chart-emitter.ts` | Send only candidate dimensions/measures (≤10). | Med–High | S |
| A11 | **Several post-turn LLM calls per question** (session knowledge, reflection, memory, scoring). | `session-knowledge-llm.ts`, chat route post-turn blocks | Return the answer first; run one batched post-turn job asynchronously; skip when nothing changed. | **High** (latency), Med–High (tokens) | L |
| A12 ✅ | **New LLM client per call** in ~14 files (no connection reuse). | `new BedrockRuntimeClient(` / `new OpenAI(` in `agent-loop.ts`, `chart-emitter.ts`, `chart-pipeline.ts`, `session-knowledge-llm.ts`, `memory/compress.ts`, `foer/run-cluster.ts`, `harvest-llm.ts`, `harvester-llm.ts`, `mantle-openai.ts`, `studio/insights.ts`, `extraction/extract.ts`, `boost/scorers/llm-client.ts`, `providers/foundry-chat.ts` | Module-level lazy singleton per provider/region/endpoint. | Med (latency/CPU) | S |
| A13 ✅ | **Abort is a boolean flag, not a real cancel.** The provider request keeps generating (and billing) until the next chunk or timeout. | Chat route sets `closed.value = true` on `request.signal` abort; `agent-loop.ts` checks the flag | Pass a real `AbortSignal` to `client.send(…, { abortSignal })` and to OpenAI/Databricks calls. | **High** for abandoned chats | M |
| A14 | **Timeouts don't cancel the underlying request.** | `providers/foundry-chat.ts` `withTimeout()` | Use `AbortController` with timeout. | Med–High | M |
| A15 | **`measureContext` re-serialises the whole conversation each loop** just to count characters. | `agent-loop.ts` `measureContext` | Keep a running total as messages are appended. | Low–Med (CPU) | S |
| A16 | **Cheap tasks may use expensive models** (scoring, titles, summaries, classification, insights). | `boost/scorers/llm-client.ts`, title route, `studio/insights.ts` | Use the existing model registry to assign a small/fast model per feature; temperature 0; short outputs. | **High** for evaluation-heavy use | S–M |
| A17 | **Studio insights allows 2,048 output tokens, keeps 5 items.** | `studio/insights.ts` | Cap ~600–800 tokens; ask for exactly 5 concise items. | Med | S |
| A18 | **Memory compression can call an LLM**; cache is in-process and lost on restart. | `memory/compress.ts` | Prefer the deterministic path; persist cache by content hash. | Med | S |
| A19 | **Harvest T2 may make 2 LLM calls per object** (generate + repair), objects processed one by one. | `context/enrich.ts` | Batch several objects per call; structured output; compact repair prompt only on parse failure; cache by profile hash + prompt version + model. | **High** for harvest | M–L |
| A20 | **Embedding writes are row-by-row; no explicit content hash/model version.** Text-equality skip exists (good). | `context/embed.ts`, `azure/embed-client.ts` | Store `content_hash` + model version; bulk upsert. Keep the dimension fixed (e.g. 1024). | Med–High | M |
| A21 | **Metrics don't break input down** into system / tools / history / tool results. | `LoopMetrics` | Add these counters plus cancellation/retry counts and estimated cost per turn. | High leverage | S |

---

## 5. Area B — Web server runtime (t4g.medium)

| ID | Finding | Evidence | Fix | Impact | Effort |
|---|---|---|---|---|---|
| B1 ✅ | **Single Node process → 1 of 2 vCPUs used.** | `Dockerfile` `CMD ["node", "server.js"]` | Two processes (PM2 / cluster wrapper); `connection_limit` ≈ 8 per process. | **High** | S |
| B2 ✅ | **No heap limit / runtime tuning.** | `Dockerfile` sets only `NODE_ENV`, `PORT` | `NODE_OPTIONS=--max-old-space-size=1536` per process (2 × 1.5 GB fits in 4 GB with OS headroom); monitor RSS and event-loop delay. | Med (stability) | S |
| B3 | **Node 20.** | `Dockerfile` `node:20-alpine` | Node 22 LTS — typically a modest free speed-up. | Low–Med | S |
| B4 ✅ | **SPA static files served and compressed by Node.** | `next.config.ts` (rewrites to `/spa/index.html`, `/spa/assets/*` immutable headers are already good) | CloudFront + S3 for `/spa/*`, or nginx serves `public/spa` directly. | **High** under UI traffic | M |
| B5 | **PDF rendering on the web tier** (`pdfjs-dist` + `@napi-rs/canvas`, page by page). | `src/lib/extraction/render.ts` | Queue to Fargate worker; cap pages/bytes/concurrency meanwhile. | **High** | M |
| B6 | **Office/PDF parsing in-process** (JSZip, mammoth, pdf-inspector, regex over whole document). | `src/lib/knowledge/readers.ts` | Same: workerise; cap archive expansion and text size. | **High** | M |
| B7 | **Server-side chart rendering** (`@resvg/resvg-js`, ECharts SSR) on the web tier. | `src/lib/studio/ssr-render.ts`, `src/lib/studio/echartsCore.ts` | Worker, or render client-side where possible. | Med | M |
| B8 | **Auth checked twice per request**: JWT decode in proxy, then `getServerSession` in routes (some routes call it several times). | `src/proxy.ts`, e.g. `src/app/api/agent-lab/workbench/sessions/route.ts` | Resolve identity once per request; pass it down. | Med | M |
| B9 | **bcrypt cost 12 on a 2-vCPU host.** | `src/lib/auth-credentials.ts` | Keep cost (security) but rate-limit login; it is break-glass only. | Low–Med | S |
| B10 | **600 s proxy timeout for all routes.** | `infra/beanstalk/.platform/nginx/conf.d/timeouts.conf` | Long timeout only on streaming routes; normal API ~60 s. | Med | S |
| B11 | **Streams keep full history/reply in memory; agent work continues after disconnect.** | `src/app/api/agent-lab/agents/chat/route.ts` | Real abort (A13); cap history/reply bytes; max stream duration and concurrent streams per user. | Med–High | M |
| B12 | **Fire-and-forget post-response work on the web process** (scoring, attribution, trace, memory updates). | `src/app/api/inspector/chat/route.ts`, `src/lib/memory/retrieve.ts` | Outbox table → worker; protects web latency and avoids lost work on restart. | Med | M |
| B13 | **Databricks calls use plain `fetch`** with no shared keep-alive agent; polling without back-off. | `src/lib/databricks/execute.ts` | One process-wide `undici.Agent` (keep-alive, bounded connections); exponential back-off with jitter; abort on disconnect. | Med | S–M |
| B14 | **179 `console.*` calls across 59 files**, some in hot loops. | `context/harvest.ts`, `databricks-adapter.ts`, memory synthesis | Levelled logger; no debug in production; don't log large objects. | Low–Med | S |
| B15 | **Module-level Maps that only grow** (idle chats, listener sets — browser side). | `src/lib/agents/agent-use-chat-stream.ts` | Delete empty listener sets; TTL/LRU idle chats. | Low (client memory) | S |

---

## 6. Area C — Database (Aurora PostgreSQL + Prisma)

| ID | Finding | Evidence | Fix | Impact | Effort |
|---|---|---|---|---|---|
| C1 ✅ | **No ANN index on `platform_context_embeddings`.** Only `knowledge_chunks` has HNSW. | `src/lib/context/describe.ts` `ORDER BY e.embedding <=> …`; `prisma/migrations/20261028_knowledge_phase0/migration.sql` (HNSW only for `knowledge_chunks`) | `CREATE INDEX … USING hnsw (embedding vector_cosine_ops)`; check with `EXPLAIN ANALYZE` that filters (`org_id`, `subject_kind`, `model_id`) still use it. | **High** | S |
| C2 ✅ | **"Index health" count query runs before every semantic search.** | `describe.ts` — `count(*)` join over objects + embeddings per request | Cache 60–120 s per org, or move to a stats endpoint. | **High** | S |
| C3 ✅ | **Dashboard summary runs heavy `COUNT(*)` aggregates**, including a per-object `EXISTS` on `platform_context_embeddings`. *A 30 s in-process cache already exists* (`SUMMARY_CACHE_TTL_MS`), so cost is one run per org per 30 s per process. | `src/lib/dashboard/summary.ts` | Make sure `platform_context_embeddings (subject_kind, subject_id)` is indexed. Optionally raise the TTL to 60–120 s or maintain counters. With 2 processes, the cache is per process (2× runs). | Med | S |
| C4 | **Active-jobs query aggregates all child jobs on every poll.** | `src/lib/context/active-jobs.ts` | Composite index `(org_id, parent_job_id, status)`; cache a few seconds. | **High** with polling | S |
| C5 | **`SELECT *` on wide context tables / Databricks sample.** | `src/lib/context/reads.ts`, `databricks-adapter.ts` | Explicit column lists. | **High** where JSON columns are large | M |
| C6 | **Catalog list/status reads full JSON-heavy rows** (up to 300 / 1,000 rows). | `src/lib/agents/catalog.ts`, `agent_catalog` model | `select` only needed fields. | Med–High | S |
| C7 | **Agent list includes `_count` of runs on every request.** | `src/lib/platform/agents.ts` `listAgents` | Count on detail only, or denormalised counter. | Med | S |
| C8 | **`resolveDefaultOrgId()` hits the DB every call.** | `src/lib/platform/agents.ts` | Cache in process. | Med | S |
| C9 | **JWT refresh may reload user + roles graph.** | `src/lib/auth.ts` jwt callback | Short TTL cache; narrow `select`; role version in token. | Med–High | M |
| C10 | **Turn metrics written in a transaction after every chat turn**, one row per loop. | `src/lib/agent-ops/record-turn-metrics.ts` | Buffer + batch insert; retention policy for `agent_loop_log`. | Med | M |
| C11 | **Advisory-lock code opens a raw `pg` connection per lock**, outside the Prisma pool. | `src/lib/memory/lock.ts` | Small dedicated `pg.Pool` (max 2–3). | Med | M |
| C12 | **Pool forced to ≥15 with 30 s wait.** | `src/lib/db.ts` | With 2 processes: ~8 each; shorter `pool_timeout` (10 s) so overload fails fast instead of piling up. Verify with `pg_stat_activity`. | Med | S |
| C13 | **Knowledge job queue index lacks `org_id`.** | `knowledge_phase0` migration `(status, run_after)` | Match the worker's predicate, e.g. partial index on runnable jobs. | Med | S |
| C14 | **Audit log: 4 small queries per request** (already bounded, take 10–20 each). | `src/app/api/audit-log/route.ts` | Optional: one `UNION ALL`. Low priority. | Low | M |
| C15 | **`agent_catalog.slug` indexed but not unique.** | `prisma/schema.prisma`, `run-catalog-agent.ts` `findFirst({ where: { slug } })` | Partial unique index if slugs are unique. | Low (correctness) | S |

---

## 7. Area D — Background jobs (harvest T0–T4, memory)

These run on **Fargate**, not the web server, so they don't affect web capacity, but they drive **Fargate, Databricks warehouse and LLM cost**.

| ID | Finding | Evidence | Fix | Impact | Effort |
|---|---|---|---|---|---|
| D1 ✅ | **Every task starts with `npx tsx`** (TypeScript compiled at start-up; `tsx` + full source in image). | `Dockerfile.harvester` CMD; `infra/context/task-definition.json`; EventBridge overrides | Bundle with esbuild/tsup → `node dist/orchestrator.js`; slimmer image. | **High** | M |
| D2 | **One Fargate task per child job** (up to 5 in parallel). Each pays cold start. | `src/lib/context/queue.ts` | A worker drains several queued jobs before exiting (bounded claims). | **High** | L |
| D3 | **Fan-out bursts** hit Databricks, DB and LLM at the same time. | `queue.ts` concurrency limits per kind | Shared per-org/warehouse limiter; back off on 429/slow queries. | **High** | M |
| D4 | **T1 profiling: several queries per object / per column.** | `src/lib/context/databricks-adapter.ts` (DESCRIBE DETAIL, column loops, sampled queries) | Batch metadata from `information_schema`; one grouped profile query per table. | **High** | L |
| D5 | **Scope discovery uses repeated `LIMIT/OFFSET` pages per catalog.** | `databricks-adapter.ts` | One `information_schema.tables` query with keyset paging; cache inventory; use `last_altered` deltas. | **High** for large estates | M |
| D6 | **Weekly T1 is a full sweep.** | `infra/context/eventbridge-rule.json` | Change-driven: only objects with changed schema / `last_altered`; full re-profile monthly. | **High** | M |
| D7 | **Large sample sizes (2K–10K rows).** | `databricks-adapter.ts` | Adaptive sampling by table size/cardinality; use table stats when present. | Med–High | M |
| D8 | **T2 prompt includes verbose profile + sibling context.** | `context/enrich.ts` | Compact profiles; cap top-k/samples; only relevant siblings. | **High** | M |
| D9 | **Objects processed sequentially in T2.** | `enrich.ts` main loop | Bounded parallelism (3–8) with separate LLM and Databricks limits. | Med–High (fewer Fargate minutes) | M |
| D10 | **Task size fixed at 0.5 vCPU / 1 GB for all tiers.** | `infra/context/task-definition.json` | Measure per tier; small definition for T0/inventory, larger for T2/T4. | Med | M |
| D11 | **All tasks on on-demand Fargate.** | `launch-harvester.ts`, EventBridge targets | **Fargate Spot** for scheduled/backfill jobs (jobs are already resumable child units); on-demand fallback. | **High** (Spot is typically far cheaper) | M |
| D12 | **Separate EventBridge rules wake the warehouse several times.** | `eventbridge-rule.json` | Chain tiers on completion; skip empty runs. | Med–High | M |
| D13 | **Launch retries without back-off.** | `queue.ts` retry/rollback | `next_attempt_at` with exponential back-off; classify permanent errors. | Med | M |
| D14 | **Memory DAG holds an advisory lock for the whole run.** | `src/lib/memory/orchestrate.ts` | Short lock for acquisition only; durable step leases. | Med | M–L |
| D15 ✅ | **Good pattern to keep:** source refresh API queues work and returns 202 (no inline harvest on the web tier). | `src/app/api/agent-lab/context/sources/[id]/refresh/route.ts` | Add a lint rule preventing `src/app/api` from importing orchestrator/enrich execution. | Regression guard | S |

---

## 8. Area E — Frontend network behaviour

| ID | Finding | Evidence | Fix | Impact | Effort |
|---|---|---|---|---|---|
| E1 | **Job status polled every 3 s.** 20 open tabs ≈ 400 requests/minute. | `src/views/agent-lab/estate/silo.tsx`, `mapper.tsx` | Back-off (3 s → 15 s), pause when tab hidden, stop when job finishes. | **High** | S |
| E2 | **Several components poll the same job independently.** | `JobRunPage.tsx`, `JobDetailDrawer.tsx`, `ChildJobsPanel.tsx`, `jobs.tsx`, `knowledge/detail.tsx` | One shared React Query key per job. Later: SSE push. | **High** | M |
| E3 | **Dashboards with 3–4 periodic queries + 1 s UI timer; reflections poll every 5 s.** | `FoerOpsDashboard.tsx`, `useReflections.ts`, `useInspectorChatModels.ts` | One batched endpoint; longer intervals; pause when hidden. | Med | S–M |
| E4 ✅ | **No app-wide React Query defaults.** Only two dashboards create a `QueryClient` with `staleTime: 60_000`. | `FoerStoryDashboard.tsx`, `FoerOpsDashboard.tsx` | One global client: `staleTime` 30–60 s, `refetchOnWindowFocus: false` for stable data, retry with back-off. | Med–High | S |
| E5 | **Large list payloads** (sessions: 200 per user, 1,000 for admins). | `src/app/api/agent-lab/workbench/sessions/route.ts` | Cursor pagination; summary fields only. | Med | M |
| E6 | **Both ECharts and Recharts shipped.** | `next.config.ts` `optimizePackageImports`, `src/lib/studio/echartsCore.ts` | Lazy-load chart modules per route; standardise on one library over time. | Med (bandwidth, browser CPU) | M |

---

## 9. Phased roadmap

### Phase 1 — Quick wins (≈1 week, code only, low risk)

| Item | IDs |
|---|---|
| Cap model-facing SQL/tool results | A1 |
| Enable prompt caching for Inspector + agents | A3 |
| Per-phase `maxTokens`; thinking only for complex intents | A6, A7 |
| LLM client singletons | A12 |
| 2 Node processes + heap limit + Node 22; pool 8 per process | B1, B2, B3, C12 |
| HNSW index on `platform_context_embeddings`; cache health count | C1, C2 |
| Narrow selects on catalog/context reads | C5, C6 |
| Global React Query defaults; polling back-off and pause-when-hidden | E1, E4 |
| Running-total `measureContext` | A15 |

**Expected result:** most of the token saving and roughly double web capacity.

### Phase 2 — Structural (≈2–4 weeks)

| Item | IDs |
|---|---|
| Split stable vs dynamic system prompt; trim tools per intent | A4, A5 |
| History trimming/digests between loops | A2 |
| Intent-based loop budgets | A8 |
| Real cancellation (`AbortSignal`) end-to-end | A13, A14, B11 |
| Deterministic chart selection first; fewer chart LLM calls | A9, A10 |
| Cheap-model routing for scorers/titles/insights via model registry | A16, A17 |
| Shared Databricks keep-alive agent + back-off | B13 |
| Caches: org id, auth roles, dashboard summary, active jobs | C3, C4, C8, C9 |
| Shared job polling | E2, E3 |
| Precompiled harvester image | D1 |

### Phase 3 — Architecture (≈1–2 months, with cloud team)

| Item | IDs |
|---|---|
| Move PDF/Office extraction and SSR chart rendering to a worker | B5, B6, B7 |
| Outbox for post-turn work (scoring, knowledge, attribution, metrics) | A11, B12, C10 |
| CloudFront/S3 for SPA assets | B4 |
| Worker reuse instead of one task per child; Fargate Spot; per-tier sizing | D2, D10, D11 |
| Change-driven T1; batched Databricks profiling; T2 batching + caching | D4–D9, A19 |
| SSE for job status instead of polling | E2 |

---

## 10. Measurement plan (prove the savings)

Capture a **1–2 week baseline before Phase 1**, then compare after each phase.

| What | Source | Target direction |
|---|---|---|
| Input/output tokens per Inspector turn (p50/p95) | `agent_turn_log`, `agent_loop_log` (`LoopMetrics`) | ↓ |
| Cache read tokens ÷ input tokens | `cacheReadTokens` in `LoopMetrics` | ↑ (aim > 50% on multi-loop turns) |
| Loops per turn, distribution | `agent_loop_log` | ↓ for simple questions |
| Time to first token, total turn time | `firstTokenMs`, `llmMs`, `toolMs` | ↓ |
| LLM spend per day, per feature | Provider billing + model registry feature tags | ↓ |
| `CPUUtilization`, `CPUCreditBalance`, `CPUSurplusCreditsCharged` | CloudWatch (EC2) | Balance stable; surplus → 0 |
| API p95 latency, 5xx rate | ALB / Beanstalk enhanced health | ↓ |
| Event-loop delay, RSS per process | Node `perf_hooks.monitorEventLoopDelay`, process metrics | Low, stable |
| DB CPU, active connections, slow queries | RDS Performance Insights, `pg_stat_statements` | ↓ |
| Fargate task-minutes per harvest run; Databricks warehouse hours | ECS / Databricks billing | ↓ |

**Load test (after Phase 1):** k6 against a staging copy with the LLM replaced by a stub that streams for a realistic 3–8 s. Ramp 10 → 200 virtual users and record the point where p95 or errors break. That gives a measured "users per t4g.medium" figure, replacing estimates.

---

## 11. Rust / Python question — conclusion

- The dominant costs found in this audit are **token volume, repeated LLM calls, unindexed/over-fetching queries, polling and blocking CPU work.** All of these are fixed in the current TypeScript code. Rewriting in Rust or Python would carry the same problems unless they are fixed anyway.
- After Phases 1–2, the web server spends most of its time **waiting** on LLMs and Databricks. Rust would mainly reduce memory per process. It would not meaningfully increase how many agent conversations can run at once, because those are limited by provider quotas, the Databricks warehouse and the DB pool.
- **Recommendation:** do Phases 1–2 first and measure. If Python is preferred for team reasons, introduce it as a **separate worker** (Phase 3 outbox/extraction worker is a natural first candidate), not as a rewrite of the API.

---

## 12. Method, verification & corrections

**Method.** Static review of the repository in four parallel tracks (LLM/tokens, web runtime, database, background jobs), followed by direct verification of the highest-impact claims.

**Verified directly (marked ✅ in the tables):**

- A1 — `tools.ts` returns `JSON.stringify(sqlResult)` (full result) to the model while the UI gets ≤1,000 rows.
- A3 — `cacheSystemPrompt: true` appears only in flows copilot and semantic blueprint.
- A6, A7, A8 — `maxTokens: 4096`, thinking budget 1,024, loop defaults 15 / max 32.
- A12 — new client construction in the listed files.
- A13 — abort is a `{ value: boolean }` flag set from `request.signal`.
- B1, B2, B4 — `Dockerfile` and `next.config.ts` as described.
- C1, C2 — no HNSW/IVFFlat on `platform_context_embeddings` in `prisma/migrations`, `scripts` or `infra`; count query runs before the vector query in `describe.ts`.
- D1 — `npx tsx` entrypoint in `Dockerfile.harvester`.
- E4 — only two local `QueryClient`s with `staleTime`.

**Not yet verified (from static review; confirm before implementing):** all other rows. Line-level details may have shifted. In particular:

- C1: the index may exist in the live database even though it is not in migrations. Check with `\d platform_context_embeddings`.
- C9: how often the JWT callback really hits the DB depends on the NextAuth session settings.
- D-series costs depend on actual estate size and schedule.

**Corrections to audit-agent claims:**

- *"Dashboard summary runs COUNT(*) on every load."* **Partly incorrect.** `summary.ts` already caches results for 30 s (`SUMMARY_CACHE_TTL_MS`). Downgraded to Medium (C3).
- *"Audit-log endpoint issues five unbounded queries."* **Incorrect.** It issues **four** queries, each bounded (`take` 10–20) with narrow `select`. Downgraded to Low (C14).
- `docs/deploy-beanstalk.md` mentions both `t3.medium` (console walkthrough) and `t4g.medium` (CLI/CI). The CI image targets arm64/t4g. This report assumes **t4g.medium**, as stated by the team.

**Estimates.** Percentages and multipliers in this report are engineering estimates from code structure, not measurements. Use Section 10 to replace them with measured numbers.
