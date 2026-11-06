# 01 — Runtime Language Research: Node.js vs Python vs Rust

**Question asked:** Should the backend be migrated to Python? Would Rust optimize the agent runtime so it handles more load with less compute?

**Short answer:** Rust is genuinely more efficient per request. But our agent runtime spends almost all its time **waiting** on LLMs, Databricks and PostgreSQL, so the language is not the bottleneck. A rewrite would cost months, and the token, database and CPU waste would come with it unless fixed. **Recommended:** optimize in place first. If Python is wanted, add it as a **separate worker service**, not as an API rewrite. Use Rust only for a proven CPU hot spot.

---

## 1. What the current backend actually is

| Item | Current state | Source |
|---|---|---|
| Framework | Next.js 16 (App Router) API routes, TypeScript | `package.json`, `next.config.ts` |
| Size | About 190 API route files under `src/app/api` | repository scan |
| Process model | One `node server.js` (Next standalone) per container | `Dockerfile` |
| Host | Elastic Beanstalk, t4g.medium (ARM64 Graviton, 2 vCPU, 4 GB) | team, `docs/deploy-beanstalk.md` |
| Database | Aurora PostgreSQL + pgvector via Prisma (pool ≥15) | `src/lib/db.ts`, `prisma/schema.prisma` |
| Agent runtime | Streaming LLM loop with tools run in parallel (`Promise.all`), up to 15 (default) / 32 (max) loops | `src/lib/inspector/agent-loop.ts`, `max-loops.ts` |
| LLM providers | Bedrock, LLM Lite gateway, Azure/Foundry, xAI | `src/lib/llmlite/*`, `src/lib/bedrock/*` |
| Background jobs | Harvest T0–T4 + memory on ECS Fargate via `npx tsx scripts/context/orchestrator.ts` | `Dockerfile.harvester`, `infra/context/*` |
| Frontend | Vite SPA served from `public/spa` by the same Node process | `next.config.ts` rewrites |

---

## 2. Anatomy of one agent request (where time goes)

A typical Inspector question:

```
user question
  └─ loop 1: send prompt to LLM ──── wait 1–6 s (model thinking/streaming)
       └─ tool: run SQL on Databricks ── wait 0.5–20 s
  └─ loop 2: send prompt + result ──── wait 1–6 s
       └─ tool: describe / semantic search ── wait 50–500 ms (PostgreSQL)
  └─ loop 3…N: …
  └─ final answer streamed to browser
```

| Component | Typical share of wall time | Who controls it |
|---|---|---|
| LLM generation and network | **60–85%** | Provider (Bedrock, gateway) and token volume |
| Databricks SQL | **10–30%** | Warehouse size and query shape |
| PostgreSQL | 2–10% | Indexes and query shape |
| **Our own CPU work** (JSON, prompt building, streaming, auth) | **~1–5%** | **Language and runtime** |

These shares are engineering estimates from code structure. The repository already records `llmMs`, `toolMs` and `firstTokenMs` per loop (`LoopMetrics`), so Phase 0 can confirm them.

**Key point:** if our own CPU work is about 3% of the time, even an infinitely fast language saves only about 3% of response time. Cutting tokens, loops and waits saves far more.

---

## 3. Language comparison

### 3.1 How each runtime handles waiting (concurrency)

| | Node.js (current) | Python (FastAPI + asyncio) | Rust (Tokio + Axum) |
|---|---|---|---|
| Model | Single-threaded event loop; async I/O | Single-threaded event loop per process (asyncio) | Multi-threaded work-stealing async runtime |
| Waiting on network | Very cheap; thousands of concurrent waits | Very cheap; thousands of concurrent waits | Very cheap; tens of thousands |
| Uses multiple cores in one process | No (needs cluster or multiple processes) | No for CPU work, because of the GIL (needs multiple processes); see 3.3 | **Yes**, natively |
| CPU-heavy work (JSON, PDF, parsing) | Blocks the event loop unless moved to a worker | Blocks the event loop; GIL limits threads | Runs in parallel across cores |
| Memory per process (typical web app) | ~150–400 MB | ~80–250 MB per worker process | **~10–50 MB** |
| LLM/AI SDK ecosystem | Good (AWS SDK v3, OpenAI, Vercel AI) | **Best** (all providers, LangChain, LlamaIndex, eval tools) | Thin; often raw HTTP |
| Team skill | Existing codebase | **Team knows Python** | New skill to learn |

### 3.2 Published throughput benchmarks (simple HTTP/JSON)

From public benchmark suites such as TechEmpower Framework Benchmarks (https://www.techempower.com/benchmarks/). Absolute numbers vary by hardware and round. The **relative order** is consistent:

| Runtime/framework class | Relative plain JSON throughput |
|---|---|
| Rust (Axum, Actix) | **Highest**, often 5–10× Node frameworks |
| Node.js (Fastify, raw http) | Middle |
| Next.js API routes | Below raw Node (framework overhead) |
| Python (FastAPI/Uvicorn) | Similar to, or somewhat below, Node |
| Python (Django/Flask sync) | Lower |

**Caveat:** these benchmarks measure "hello world" or a single DB query, with **zero** LLM wait. Our requests wait seconds on an LLM, which makes the language difference shrink to a few percent of response time.

### 3.3 Python free-threading (no GIL)

- PEP 703 (https://peps.python.org/pep-0703/) made the GIL optional. Python 3.13 shipped an experimental free-threaded build. PEP 779 moved it to "supported" status in Python 3.14.
- Docs: https://docs.python.org/3/howto/free-threading-python.html
- **Practical status:** single-thread speed in the free-threaded build is somewhat slower, and some C-extension libraries are not yet compatible. For an I/O-bound web service, asyncio plus multiple processes is still the standard production pattern. Free-threading is not a reason to choose Python today.

### 3.4 Rust async (Tokio)

- Tokio (https://tokio.rs) is a multi-threaded async runtime. One process uses every core, and each task costs only a few KB of memory.
- Where Rust clearly wins:
  - very high request rates
  - CPU-heavy parsing and transformation
  - stable low latency with no GC pauses
  - very small memory footprint
- Where it does not help us:
  - LLM generation time
  - Databricks query time
  - PostgreSQL time
  - provider rate limits
  - token cost

### 3.5 What "agent runtimes are faster in Rust" really means

Articles about Rust agent runtimes usually measure **orchestration overhead**: scheduling thousands of tiny tool calls, parsing, and in-memory vector math, with the LLM mocked or local. In that setting Rust is much faster and lighter. In our setting:

- the model is remote (Bedrock or gateway) and takes seconds
- tools are remote (Databricks, PostgreSQL) and take hundreds of milliseconds to seconds
- each conversation runs 3–15 loops, not thousands

So the orchestration-overhead win is real but small relative to total time and cost.

---

## 4. What a migration would cost

| Option | Scope | Effort (rough) | Risk | Benefit for our workload |
|---|---|---|---|---|
| **A. Optimize in place (recommended)** | Phases 1–3 of this pack | Weeks, done incrementally | Low–Medium | **High**: fixes tokens, CPU use, DB and jobs |
| B. Full rewrite to Python (FastAPI) | ~190 routes, auth, Prisma → SQLAlchemy/asyncpg, streaming, jobs | **4–9 months** for a small team | High (feature freeze, regressions) | Low–Medium: team familiarity; similar speed to Node |
| C. Full rewrite to Rust (Axum) | Same as B, plus a new skill set | **6–12+ months** | Very high | Medium: lower memory, higher request rates; no change to LLM wait or token cost |
| **D. Hybrid: Python worker service** | New service for extraction, post-turn analysis, harvest helpers or evaluation | Weeks per bounded service | Low–Medium | Medium: uses Python's AI ecosystem where it helps most |
| E. Rust for a hot spot | e.g. PDF/Office parsing or large JSON transformation via a native module or sidecar | Weeks | Medium | Only if profiling shows a CPU hot spot |

---

## 5. Recommendation

1. **Do Phase 0 and Phase 1 first** ([04-implementation-plan.md](./04-implementation-plan.md)). Cheap and low risk, with the largest return.
2. **Measure** with `LoopMetrics`, CloudWatch and a k6 load test ([02-capacity-and-cost-model.md](./02-capacity-and-cost-model.md)).
3. **If Python is desired**, start with the Phase 3 **extraction / post-turn worker** as a Python service. It is self-contained, CPU-heavy, and benefits from Python's document and AI libraries. The API stays in TypeScript.
4. **Consider Rust only** if profiling after Phases 1–2 shows a specific CPU-bound hot spot that still matters.

### Gates before any rewrite is reconsidered

| Gate | Threshold |
|---|---|
| Phases 1–2 implemented and measured | Yes |
| Our own CPU time share of request time | > 25% at p95 |
| Web tier is the bottleneck, not LLM, Databricks or DB | Confirmed by load test |
| A benchmark of the same endpoint in the candidate language | > 2× throughput **and** a cost benefit that pays back the rewrite within 12 months |

---

## 6. Sources

- TechEmpower Framework Benchmarks — https://www.techempower.com/benchmarks/
- PEP 703, Making the GIL optional — https://peps.python.org/pep-0703/
- Python free-threading HOWTO — https://docs.python.org/3/howto/free-threading-python.html
- Python asyncio — https://docs.python.org/3/library/asyncio.html
- FastAPI — https://fastapi.tiangolo.com/
- Tokio — https://tokio.rs/
- Node.js cluster module — https://nodejs.org/api/cluster.html
- AWS burstable performance instances — https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances.html
- Repository files listed in §1 (verified 2026-10-31).
