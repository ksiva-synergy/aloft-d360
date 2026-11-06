# 04 — Implementation Plan

For each item: **approach**, **files**, **risk**, **rollback**, **how we verify**. IDs match the [technical audit](../audits/performance-and-cost-optimization-report.md).

Principles:
- **Measure first** (Phase 0). Change one lever at a time where possible, so each saving can be attributed.
- **Feature flags / env vars** for every behaviour change that could affect answer quality, so it can be switched off without a redeploy.
- **Small PRs**, one per item or a tightly related group, each with tests and a `docs/CHANGELOG.md` entry.
- Jobs and harvest items also follow `docs/jobs/AGENT_INSTRUCTIONS.md` and update `docs/jobs/session-log.md`.

---

## Phase 0 — Baseline (1–2 weeks, passive, no risk)

| Step | Action | Owner |
|---|---|---|
| 0.1 | Save a CloudWatch dashboard: `CPUUtilization`, `CPUCreditBalance`, `CPUSurplusCreditsCharged`, `NetworkOut`, Beanstalk p95 latency, 5xx | Cloud / DevOps |
| 0.2 | SQL report over `agent_turn_log` / `agent_loop_log`: p50/p95 input, output and cache tokens per turn; loops per turn; `llmMs`, `toolMs`, `firstTokenMs` by model | Backend |
| 0.3 | Daily LLM spend by feature (provider billing + gateway logs) | Backend / Finance |
| 0.4 | Enable `pg_stat_statements`; export the top 20 queries by total time; RDS Performance Insights snapshot | Backend / DBA |
| 0.5 | Harvest: Fargate tasks per week × average duration; Databricks warehouse hours | Backend / Data |
| 0.6 | Add counters to `LoopMetrics` (A21): system / tools / history / tool-result characters per loop; cancelled-turn flag. *(small code change; can ship with Phase 1)* | Backend |

**Exit criterion:** a "before" table filled in for §10 of the audit.

---

## Phase 1 — Quick wins (~1 week)

### 1.1 Cap model-facing tool results (A1) — **highest priority**

- **Files:** `src/lib/inspector/tools.ts` (SQL tool return), possibly other tools returning large payloads.
- **Approach:**
  1. Add `buildModelToolPayload(sqlResult)`, which returns:
     - `columns` (name, type)
     - `rowCount`
     - `truncated: true|false`
     - `sampleRows`: the first N rows (env `INSPECTOR_MODEL_SAMPLE_ROWS`, default 30)
     - simple per-column stats for numeric and date columns (min / max / sum where cheap)
     - a note that the full result is displayed to the user
  2. Enforce a hard character cap (env `INSPECTOR_MODEL_TOOL_RESULT_MAX_CHARS`, default ~12,000). If still too large, drop rows and then truncate long string cells.
  3. The UI path (`cappedRows`, 1,000) stays unchanged.
- **Risk:** the model might need specific rows beyond the sample, for example "list all 200 vessels".
  - Mitigation: the instruction tells the model to aggregate in SQL or re-query with `LIMIT`/`WHERE`.
  - Run an evaluation set of ~30 real questions before and after.
- **Rollback:** set the env cap very high (or a flag) to restore today's behaviour.
- **Verify:**
  - Unit test for the payload builder: cap respected, shape stable.
  - Compare `inputTokens` per turn in `agent_loop_log` before and after.
  - Run the evaluation set.

### 1.2 Enable prompt caching for Inspector and agent chat (A3)

- **Files:** `src/app/api/inspector/chat/route.ts` (loop params), `src/lib/inspector/agent-loop.ts`, `src/lib/agents/run-catalog-agent.ts`.
- **Approach:**
  1. Pass `cacheSystemPrompt: true` (or default it on in the loop) for Bedrock models that support caching.
  2. For LLM Lite / OpenAI-compatible providers, rely on the provider's automatic prefix caching where available. Confirm with the gateway team.
- **Risk:**
  - Low.
  - Caching writes can cost slightly more than normal input on the first call. The benefit appears from the second loop onwards.
  - Some models enforce a minimum prompt size before caching applies.
- **Rollback:** env flag `INSPECTOR_PROMPT_CACHE=0`.
- **Verify:** `cacheReadTokens > 0` on loop 2+ in `agent_loop_log`; lower first-token latency.

### 1.3 Per-phase `maxTokens` and selective thinking (A6, A7)

- **Files:** `src/lib/inspector/agent-loop.ts`.
- **Approach:**
  - `maxTokens` = `INSPECTOR_TOOL_TURN_MAX_TOKENS` (default 1,024) while tools are available and the loop budget is not exhausted.
  - `maxTokens` = 4,096 on the forced final turn, or when the model emits a final answer and is cut off. In that case, retry once with the larger limit.
  - Thinking is on only when the intent is classified "complex" (see 2.3), or via an env override.
- **Risk:** truncated answers. Mitigation: detect `stopReason === 'max_tokens'` and continue once with the larger limit.
- **Rollback:** env values.
- **Verify:** output tokens per turn ↓; count of `max_tokens` stop reasons stays low.

### 1.4 LLM client singletons (A12)

- **Files:**
  - `agent-loop.ts`
  - `chart-emitter.ts`
  - `chart-pipeline.ts`
  - `session-knowledge-llm.ts`
  - `memory/compress.ts`
  - `foer/run-cluster.ts`
  - `harvest-llm.ts`
  - `harvester-llm.ts`
  - `bedrock/mantle-openai.ts`
  - `studio/insights.ts`
  - `extraction/extract.ts`
  - `boost/scorers/llm-client.ts`
  - `providers/foundry-chat.ts`
- **Approach:** add a small `src/lib/llm/clients.ts` with lazy `getBedrockRuntime(region)` and `getOpenAICompatible(baseURL, keyId)`, cached in a `Map`. `azure/embed-client.ts` already does this for Titan and is the pattern to copy.
- **Risk:** credential rotation. Mitigation: key the cache by credential identity, or rely on the SDK's default credential provider, which refreshes itself.
- **Rollback:** revert the PR (pure refactor).
- **Verify:** unit tests; latency of the first loop ↓ slightly; fewer TLS handshakes.

### 1.5 Use both cores: two Node processes (B1, B2, B3, C12)

- **Files:** `Dockerfile`, `src/lib/db.ts`, possibly `infra/beanstalk/*`.
- **Approach options:**
  - (a) `pm2-runtime start server.js -i 2` (cluster mode shares one port).
  - (b) A tiny `cluster` wrapper script that forks 2 workers running `server.js`.

  Either way:
  - `NODE_OPTIONS=--max-old-space-size=1536`
  - base image `node:22-alpine`
  - `connection_limit` ~8 per process; `pool_timeout` 10 s. The `src/lib/db.ts` floor of 15 must be made configurable.
- **Must check (in-process state that becomes per-process):**

  | State | File | Effect with 2 processes | Action |
  |---|---|---|---|
  | Dashboard summary cache (30 s) | `src/lib/dashboard/summary.ts` | Up to 2× recomputes | Acceptable |
  | Widget cache | `src/lib/dashboards/widget-cache.ts` | Per-process cache | Acceptable |
  | Source-match cache | `src/lib/context/describe.ts` | Per-process | Acceptable |
  | Memory compress cache | `src/lib/memory/compress.ts` | Per-process | Acceptable |
  | DNS-over-HTTPS cache | `src/lib/llmlite/config.ts` | Per-process | Acceptable |
  | Model settings cache (15 s) | `src/lib/llmlite/model-settings-store.ts` | A change may show up to 15 s later on one process | Acceptable |
  | In-flight trace promises | `src/lib/memory/trace/capture.ts` | Per-process; flush on shutdown | Check graceful shutdown |
  | SSE streams | chat routes | Each stream stays on the process that opened it | OK (single request) |
  | Next.js build or ISR caches | Next runtime | Per-process | OK for API-only routes |
  | Advisory locks | `memory/lock.ts` | DB-level, so already cross-process | OK |

- **Risk:** memory. Two processes at 1.5 GB heap each, plus native memory, could approach 4 GB. Monitor RSS and lower the heap to 1.25 GB if needed.
- **Rollback:** revert the Dockerfile CMD.
- **Verify:**
  - Both cores are used under load (`top` / CloudWatch).
  - k6 throughput ↑.
  - `pg_stat_activity` connections ≤ 16 from the web tier.

### 1.6 HNSW index + cached health count (C1, C2)

- **Files:** a new Prisma migration; `src/lib/context/describe.ts`.
- **Approach:**
  1. Check production first: `\d platform_context_embeddings`. The index may already exist outside migrations.
  2. Migration: `CREATE INDEX CONCURRENTLY IF NOT EXISTS … ON platform_context_embeddings USING hnsw (embedding vector_cosine_ops);`. Prisma migrations run in a transaction, and `CONCURRENTLY` cannot. Either run it as a manual DBA step and record it in a migration marked as applied, or accept a non-concurrent build during a quiet window.
  3. Check that the embedding column has fixed dimensions; HNSW requires a dimensioned `vector(n)`.
  4. Add a btree index on `(subject_kind, subject_id)` if missing. Also helps C3.
  5. Cache the health count per org for 60–120 s.
- **Risk:**
  - Index build time and memory on large tables.
  - Filtered queries can return fewer than k results with HNSW. Mitigation: `SET hnsw.ef_search` higher, or iterative scans (pgvector ≥ 0.8). Compare result sets.
- **Rollback:** `DROP INDEX`.
- **Verify:** `EXPLAIN ANALYZE` uses the index; semantic search p95 ↓; top-k results compared on 20 sample queries.

### 1.7 Narrow selects (C5, C6, C7)

- **Files:** `src/lib/context/reads.ts`, `src/lib/agents/catalog.ts`, `src/lib/platform/agents.ts`, `src/lib/context/databricks-adapter.ts`.
- **Approach:** explicit `select`/column lists matching what callers use; move `_count` to the detail view.
- **Risk:** a caller depends on a dropped field. TypeScript will catch most cases.
- **Verify:** `npm run typecheck`, unit tests, smaller payload sizes.

### 1.8 Frontend polling and React Query defaults (E1, E4)

- **Files:**
  - `src/views/agent-lab/estate/silo.tsx`
  - `src/views/agent-lab/estate/mapper.tsx`
  - the job pollers
  - the SPA `QueryClient` setup in `web/`
- **Approach:**
  - `refetchInterval` becomes a function: 3 s for the first minute, then 10 s, then 15 s. Return `false` when the job is terminal.
  - `refetchIntervalInBackground: false`.
  - Global defaults: `staleTime: 30_000`, `refetchOnWindowFocus: false` for stable data.
- **Risk:** status appears a few seconds later. Acceptable.
- **Verify:** request count per open tab per minute (browser devtools / ALB request count) ↓.

### 1.9 Incremental context measurement (A15)

- **File:** `agent-loop.ts`. Keep a running character total as messages are appended. Pure CPU saving; very low risk.

---

## Phase 2 — Structural (2–4 weeks)

| # | Item | IDs | Approach summary | Key risk | Rollback |
|---|---|---|---|---|---|
| 2.1 | Stable / dynamic prompt split | A4 | Split the system prompt: stable instructions + tool policy → cache point → per-request context (date, user, memory, retrieved context) | Prompt ordering changes behaviour slightly | Flag |
| 2.2 | Tool subset per intent; shorter descriptions | A5 | Map intent → allowed tools | Model can't reach a needed tool | Flag; fall back to the full set |
| 2.3 | Intent classifier + loop budgets | A8, A7 | Cheap rules first (keywords, question shape), then a small model if unsure → simple / investigative / complex | Under-budgeting hard questions | Allow one "extend budget" when the model asks for it |
| 2.4 | History digests | A2 | After loop N+1, replace older tool results with digests (row count, columns, key values) | Model loses detail it needs | Keep the latest 1–2 full results; flag |
| 2.5 | Real cancellation | A13, A14, B11 | Thread an `AbortSignal` from `request.signal` into `ConverseStream`, OpenAI calls and Databricks fetch/poll; use `AbortController` timeouts | Partial writes on abort | Ensure persistence code handles aborted turns |
| 2.6 | Deterministic chart selection | A9, A10 | Rules for obvious charts; LLM only when ambiguous; send ≤10 candidate columns | Worse chart choice on edge cases | Flag |
| 2.7 | Cheap-model routing | A16, A17 | Use the Models admin page to assign small models to `boost_scorers`, `session_titles`, insights, classification; cap insights at ~700 tokens | Quality on scoring | Switch back in the admin UI |
| 2.8 | Databricks keep-alive + back-off | B13 | Shared `undici.Agent`; exponential back-off with jitter while polling statement status | Low | Revert |
| 2.9 | Caches: org id, roles, active jobs | C4, C8, C9 | In-process TTL caches (10–60 s); index `(org_id, parent_job_id, status)` | Stale role after a change (≤ TTL) | Short TTL |
| 2.10 | Shared job polling | E2, E3 | One React Query key per job/resource shared across components | Low | Revert |
| 2.11 | Precompiled harvester | D1 | esbuild/tsup bundle → `node dist/orchestrator.js`; update `Dockerfile.harvester` CMD, task definition and EventBridge overrides | Bundling issues with native or dynamic imports | Keep the old image tag |
| 2.12 | Auth resolved once per request | B8 | Helper that reads identity once; routes stop calling `getServerSession` repeatedly | Missed auth check | Tests on protected routes |
| 2.13 | Batched metrics writes | C10, C11 | Buffer loop logs; single `createMany`; small `pg.Pool` for locks | Lost metrics on crash | Flush on shutdown |

---

## Phase 3 — Architecture (1–2 months, with cloud team)

| # | Item | IDs | Approach summary | Dependency |
|---|---|---|---|---|
| 3.1 | Document/extraction worker (**Python candidate**) | B5, B6, B7 | Upload → S3 → queue (DB table or SQS) → Fargate worker → results to DB. Web tier only enqueues and polls. | Cloud team (task definition, IAM, queue) |
| 3.2 | Outbox for post-turn work | A11, B12, C10 | Chat route writes an outbox row; a worker batches session knowledge, reflection, scoring, attribution and metrics | 3.1 worker infrastructure (can be shared) |
| 3.3 | CloudFront + S3 for SPA | B4 | Build uploads `public/spa` to S3; CloudFront routes `/spa/*` and the SPA HTML; `/api/*` goes to Beanstalk | Cloud team (distribution, DNS, certificate) |
| 3.4 | Harvest worker reuse + Spot + sizing | D2, D10, D11, D12, D13 | Worker claims jobs until the queue is empty or a time limit is hit; capacity provider `FARGATE_SPOT` with on-demand fallback; per-tier task definitions; exponential retry | Cloud team; follow `docs/jobs/AGENT_INSTRUCTIONS.md` |
| 3.5 | Change-driven T1 + batched profiling | D4–D7 | Use `information_schema` + `last_altered`; one grouped profile query per table; adaptive sampling | Databricks access for testing |
| 3.6 | T2 batching + caching | D8, D9, A19, A20 | Several objects per LLM call; cache by profile hash + prompt version + model; bounded parallelism; bulk embedding upsert with `content_hash` | Evaluation of enrichment quality |
| 3.7 | SSE for job status | E2 | Server push replaces polling | 2.10 done |

---

## Testing & quality guardrails

| Guardrail | Applies to |
|---|---|
| **Answer-quality evaluation set** (~30–50 real Inspector questions with expected facts) run before and after | 1.1, 1.3, 2.1–2.4, 2.6, 2.7 |
| Unit tests for new helpers (payload builder, client cache, intent classifier, back-off) | All code items |
| `npm run typecheck` + existing test suites | All |
| k6 load test on staging | 1.5, Phase 1 exit |
| Harvest dry run on a small Limit scope, comparing outputs | 2.11, 3.4–3.6 |
| Canary: deploy to staging first, then production off-peak; watch the dashboards for 24 h | All infra changes |
