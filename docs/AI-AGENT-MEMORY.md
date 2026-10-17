# ALOFT D360 — AI, Agent & Memory Deep Dive

> Plain-English explanation of how the three most important intelligence systems work: the **AI layer**, the **Agent runtime**, and the **Memory system**.

Related: [Creating agents](./creating-agents.md) (catalog vs platform vs Inspector; domain-scoped chat options).

---

## Table of Contents

1. [Overview — How They Work Together](#1-overview--how-they-work-together)
2. [AI Layer](#2-ai-layer)
3. [Agent Runtime](#3-agent-runtime)
4. [Memory System](#4-memory-system)
5. [End-to-End Example](#5-end-to-end-example)
6. [Configuration & Feature Flags](#6-configuration--feature-flags)
7. [Key Source Files](#7-key-source-files)

---

## 1. Overview — How They Work Together

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER ASKS A QUESTION                            │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
         ┌───────────────────────▼────────────────────────┐
         │              MEMORY SYSTEM                      │
         │  "What did we learn before about this topic?"   │
         │  → Retrieves relevant rules from past sessions   │
         │  → Injects them into the AI prompt               │
         └───────────────────────┬────────────────────────┘
                                 │
         ┌───────────────────────▼────────────────────────┐
         │              AI LAYER (AWS Bedrock)               │
         │  Claude reads: question + memory + schema       │
         │  → Decides what tools to call                     │
         │  → Streams answer text back live                  │
         └───────────────────────┬────────────────────────┘
                                 │
         ┌───────────────────────▼────────────────────────┐
         │              AGENT RUNTIME                      │
         │  Executes tools: SQL, charts, schema lookup     │
         │  → Records every step in a trace graph          │
         │  → Scores run quality, logs cost                │
         └───────────────────────┬────────────────────────┘
                                 │
         ┌───────────────────────▼────────────────────────┐
         │         MEMORY SYSTEM (overnight)               │
         │  Reviews today's traces → extracts new rules    │
         │  → Stores them for tomorrow's questions         │
         └─────────────────────────────────────────────────┘
```

**Why this matters:** The AI is not stateless. Every session makes the system smarter. Memory feeds the AI. The Agent executes safely. The loop closes overnight.

---

## 2. AI Layer

The AI layer is everything that talks to large language models (LLMs). It does **not** run queries or store data — it **thinks** and **plans**.

### 2.1 What It Does

| Responsibility | Plain English |
|---|---|
| Understand questions | Reads natural language like "show revenue by month" |
| Plan tool calls | Decides whether to search schema, run SQL, or draw a chart |
| Generate answers | Writes human-readable summaries of query results |
| Learn from context | Uses injected memory rules and semantic definitions |
| Stream responses | Sends text word-by-word so the UI feels instant |

### 2.2 Where It Lives

| File | Role |
|---|---|
| `src/lib/inspector/agent-loop.ts` | Core loop — calls Bedrock, handles tool rounds |
| `src/lib/inspector/providers/factory.ts` | Routes to Bedrock or Azure Foundry |
| `src/lib/inspector/providers/foundry-chat.ts` | Azure AI Foundry adapter |
| `src/lib/inspector/prompts.ts` | System prompts and tool definitions |
| `src/app/api/inspector/chat/route.ts` | HTTP entry point — wires everything together |
| `src/lib/context/embed.ts` | Titan embeddings for memory search |
| `src/lib/memory/synthesis/reflect.ts` | LLM that extracts memory rules from sessions |

### 2.3 LLM Providers

**Primary: AWS Bedrock** (`ConverseStreamCommand`)

All Inspector chat goes through Bedrock's streaming API. Credentials come from `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` and region from `BEDROCK_REGION`.

**Optional: Azure AI Foundry**

Models like GPT-5.4, Grok, Kimi, DeepSeek-V4 route through `dispatchAgentLoop()` when `apiType === 'foundry'`.

### 2.4 Supported Models

Defined in `chat/route.ts` as `MODELS_MAP`:

| Model Key | Provider | Tool Support | Thinking Mode |
|---|---|---|---|
| `sonnet-4-6` (default) | Bedrock Claude | ✅ | ✅ |
| `opus-4-6` | Bedrock Claude | ✅ | ✅ |
| `haiku-4-5` | Bedrock Claude | ✅ | ❌ |
| `nova-premier/pro/lite/micro` | Amazon Nova | ✅ | ❌ |
| `mistral-l3` | Mistral | ✅ | ❌ |
| `qwen3-32b` | Qwen | ✅ | ❌ |
| `deepseek-r1` | DeepSeek | ❌ | ✅ |
| `llama-4-*` | Meta Llama | ❌ | ❌ |
| `gpt-5-4`, `grok-4-3`, etc. | Azure Foundry | ✅ | varies |

**Default model:** `sonnet-4-6` (Claude Sonnet 4.6)

Models without tool support can still chat but cannot call `execute_tool` or `emit_chart`.

### 2.5 The Agent Loop (How AI Thinks)

```typescript
// Simplified flow from agent-loop.ts
while (loopCount < maxLoops) {
  1. Send messages + system prompt to Bedrock (ConverseStream)
  2. Stream text chunks to UI via onTextChunk
  3. If model returns tool_use blocks:
     a. Parse tool name + JSON input
     b. Call executeTool() — runs SQL, charts, etc.
     c. Append tool result to conversation
     d. Loop again (model sees the result and continues)
  4. If model returns text only (no tools):
     → Done. Return final answer.
}
```

**Max loops:** 8 per user message (prevents infinite tool chains)

**Temperature:**
- `0.3` for normal models (precise SQL)
- `1.0` for thinking models (Claude with extended reasoning)

**Thinking mode:** Claude models with `supportsThinking: true` get a 1024-token reasoning budget. Reasoning streams separately via `onThinkingChunk`.

### 2.6 System Prompts

Two modes, selected by `contextMode`:

| Mode | Prompt | Behavior |
|---|---|---|
| `harvested` (default) | `INSPECTOR_SYSTEM_PROMPT` | Search catalog first (free), then SQL. Never guess table names. |
| `warehouse_only` | `INSPECTOR_WAREHOUSE_ONLY_PROMPT` | Direct SQL only. Uses SHOW/DESCRIBE for discovery. |

**Prompt layers stacked at runtime:**

```
1. Base system prompt (workflow rules)
2. Semantic context (governed metric definitions) — if available
3. Harvested insights (session-specific catalog hints)
4. Memory Phase 0 (HARD_RULE guardrails) — if MEMORY_INJECT_ENABLED
5. Memory Phase 1a (SCHEMA_MAP facts) — if enabled
6. Memory Phase 1b (task-scoped recall) — injected as synthetic assistant message
```

Built in `chat/route.ts`:

```typescript
const basePrompt = buildSystemPrompt(contextMode, semanticCtx);
const systemPrompt = insightsContext ? `${basePrompt}\n\n${insightsContext}` : basePrompt;
// + memory blocks appended to finalSystemPrompt
```

### 2.7 Prompt Caching (Cost Optimization)

When `cacheSystemPrompt: true`, Bedrock caches the stable system prefix for ~5 minutes. Repeat calls within the TTL get faster time-to-first-token and lower input cost.

Only useful when the system prompt is identical across calls (not when it embeds per-request memory).

### 2.8 Embeddings (AI for Search, Not Chat)

Separate from the chat LLM — used for **semantic similarity search**:

| Module | Function | Model | Used By |
|---|---|---|---|
| `context/embed.ts` | `embedQuery(text)` | Bedrock Titan | Memory Phase 1b retrieval |
| `knowledge/embed.ts` | `embedText(text)` | Bedrock Titan | Knowledge chunks (partial) |

Vectors stored in PostgreSQL via **pgvector**. Similarity = cosine distance.

**Important:** These two embed modules are distinct — never merge them.

### 2.9 AI in Memory Synthesis

Overnight, a separate LLM call (`reflect.ts`) reviews completed sessions:

- **Persona:** "Captain Track Sparrow" — extracts reusable rules from traces
- **Input:** Trace graph + Marcus reflections + existing bullets
- **Output:** Up to 7 candidate rules (JSON array)
- **Model:** Claude Sonnet via `BEDROCK_SONNET_MODEL_ID`
- **Prompt version:** `marcus_reflect_v3`

Rules must include concrete identifiers (table names, column names) — generic advice is discarded.

### 2.10 Why the AI Layer Is Useful

| Benefit | How |
|---|---|
| No SQL required | Analysts ask in plain English |
| Governed answers | Semantic layer ensures consistent metric definitions |
| Safer queries | AI plans queries; safety gate enforces read-only |
| Gets smarter | Memory injection brings past learnings into every prompt |
| Transparent | User sees the SQL that was run |
| Model flexibility | Swap between Claude, Nova, Mistral without code changes |

---

## 3. Agent Runtime

The Agent is the **execution engine** — it takes the AI's decisions and actually does things: run SQL, render charts, log traces, score quality.

### 3.1 What It Does

| Responsibility | Plain English |
|---|---|
| Execute tools | Run SQL, search schema, generate charts |
| Stream events | Send live updates to the browser (SSE) |
| Record traces | Log every action as a graph node |
| Enforce safety | All SQL goes through read-only gate |
| Score runs | Track success/failure for bandits and memory |
| Reflect | Marcus reviews trajectory after session ends |

### 3.2 Architecture

```
POST /api/inspector/chat
    │
    ├── guardInspectorChat()        ← auth check
    ├── buildSemanticContext()      ← load governed metrics
    ├── selectMemoryAll()           ← retrieve memory bullets
    ├── openSession()               ← start trace capture
    │
    └── runAgentLoop() / dispatchAgentLoop()
            │
            ├── Bedrock streams text/thinking
            │
            └── executeInspectorTool() for each tool call
                    ├── execute_tool        → Databricks SQL
                    ├── describe_schema     → catalog search (free)
                    ├── emit_chart            → chart from query results
                    ├── emit_semantic_chart → governed metric chart
                    └── emit_disambiguation → "which metric did you mean?"
```

### 3.3 Tools Available to the Agent

Defined in `prompts.ts` (`INSPECTOR_TOOLS`) and executed in `tools.ts`:

| Tool | What It Does | Cost |
|---|---|---|
| `describe_schema` | Search/describe/profile the data catalog | Free (Postgres only) |
| `execute_tool` | Run read-only SQL on Databricks | Warehouse compute |
| `emit_chart` | Build chart from last query result | LLM + render |
| `emit_semantic_chart` | Run governed semantic query + chart | Warehouse + LLM |
| `emit_disambiguation` | Show clickable options when metric is ambiguous | Free |

#### execute_tool — SQL Execution Path

```
AI calls execute_tool({ tool_name: "synergy_dwh", args: { statement: "SELECT..." } })
    → resolveToolCatalogEntry()     — find connection in tool_catalog
    → getAccessToken()              — OAuth M2M to Databricks
    → executeDatabricksSQL()        — THE safety chokepoint
        ├── Read-only allowlist (SELECT, WITH, SHOW, DESCRIBE only)
        ├── Multi-statement guard
        ├── Row cap (default 1000, max 10000)
        ├── Byte cap (4 MB inline)
        └── No external_links disposition
    → emit query_result event to UI
    → return JSON to AI for next loop iteration
```

#### emit_chart — Chart Pipeline

```
AI calls emit_chart after a query has run
    → profileResultSet()        — analyze column types, cardinality
    → runChartPipeline()        — LLM picks chart type + builds Chart DSL
    → compile to ECharts option
    → emit chart_spec event to UI
```

#### emit_semantic_chart — Governed Metrics

```
AI calls emit_semantic_chart with a SemanticQuery JSON
    → runSemanticChartPipeline()
        → compileSemanticQuery()  — governed SQL
        → executeDatabricksSQL()
        → profile + recommend chart
    → emit semantic_chart_result with lineage metadata
```

### 3.4 Streaming (SSE Events)

The chat route returns a `ReadableStream` with Server-Sent Events. Key event types:

| Event | When | UI Effect |
|---|---|---|
| `stream_start` | Loop begins | Show model name, max loops |
| `text` | AI writes text | Append to message bubble |
| `thinking` | Claude reasoning | Show thinking panel |
| `loop_start` | New tool round | Progress indicator |
| `tool_call_suggested` | AI picks a tool | Show tool card |
| `tool_call_running` | Tool executing | Spinner on tool card |
| `tool_call_result` | Tool succeeded | Show result summary |
| `tool_call_error` | Tool failed | Show error, retry hint |
| `query_result` | SQL returned rows | Render data table |
| `chart_spec` | Chart ready | Render ECharts visualization |
| `semantic_chart_result` | Governed chart ready | Chart + trust metadata |

### 3.5 Trajectory Tracking

Every tool call is recorded in `TrajectoryEntry[]`:

```typescript
{
  seq: 1,
  tool: "execute_tool",
  sqlExcerpt: "SELECT month, SUM(revenue)...",
  input: { tool_name: "synergy_dwh", args: { statement: "..." } },
  output: "{ columns: [...], rows: [...] }",
  status: "success",
  durationMs: 2340,
  kind: "sql_query"  // classified by boost/classify.ts
}
```

Used for: bandit scoring, Marcus reflection, memory synthesis input.

### 3.6 Trace Graph (AM0.3)

Parallel to trajectory — a **graph** stored in `platform_trace_nodes` and `platform_trace_edges`:

| Node Type | Meaning | Example |
|---|---|---|
| `ACTION` | Tool was called | execute_tool with SQL |
| `OUTCOME` | Tool returned result | 150 rows, 3 columns |
| `CORRECTION` | User fixed something | "COUNTRY means nationality" |
| `DEAD_END` | Path failed | TABLE_NOT_FOUND |
| `SOURCE` | Schema reference | describe_schema path |

Edges: `LED_TO`, `CORRECTED_BY`

Captured fire-and-forget in `trace/capture.ts` via `openSession(sessionId, 'inspector')`.

**Cross-turn corrections:** If the last tool of a turn errored, the next user message is recorded as a `CORRECTION` node linked to the failed action.

### 3.7 Lifecycle Scoring

After each run completes (`chat/route.ts` tail):

| Module | What It Records |
|---|---|
| `logAgentCost()` | Token usage, model, duration → `agent_cost_log` |
| `scoreRun()` | Quality score (CTSGV framework) |
| `writeBanditObservation()` | Multi-armed bandit data for model selection |
| `reportToBandit()` | Aggregate bandit reporting |
| `evaluateTrajectoryReflection()` | Marcus reviews the tool trajectory |
| `attributeRunOutcome()` | Updates memory bullet helpful/harmful counts |

### 3.8 Marcus — The Reflection Engine

**What:** A secondary AI that reviews what the primary agent did.

**When:** After the SSE stream closes (fire-and-forget, never blocks the user).

**Flag:** `MARCUS_REFLECT_ENABLED=true`

**Process:**
1. `evaluateTrajectoryReflection()` or `evaluateInspectorFirstTurn()`
2. Sends construction state + transcript tail to Claude Sonnet
3. Returns structured reflection: headline, body, severity, technique
4. Stored in `platform_marcus_reflections`
5. Shown in workbench UI as reflection cards
6. Fed into memory synthesis as additional signal

**First-turn mode:** `MARCUS_FIRST_TURN_ALWAYS=true` forces reflection on turn 1.

### 3.9 Why the Agent Runtime Is Useful

| Benefit | How |
|---|---|
| Safe by design | Single SQL chokepoint — no bypass possible |
| Full transparency | User sees SQL, tool calls, timing |
| Debuggable | Trace graph reconstructs exactly what happened |
| Quality feedback | Bandit + scoring improves model selection over time |
| Chart automation | No manual chart configuration |
| Catalog-first | Free schema search before expensive warehouse queries |

---

## 4. Memory System

Memory is how the platform **learns from experience** without retraining models. It stores short, actionable rules extracted from past sessions and injects the relevant ones into future prompts.

### 4.1 What It Does

| Responsibility | Plain English |
|---|---|
| Store rules | "Always use ops.crew_manifest for crew data" |
| Retrieve rules | Find rules relevant to current question |
| Inject rules | Add them to the AI prompt before it thinks |
| Synthesize rules | Extract new rules from completed sessions (overnight) |
| Attribute outcomes | Track which rules helped vs hurt |
| Reputation | Score users who contribute good rules |
| Teach | Let users explicitly correct the AI |

### 4.2 Memory Bullet Types

Stored in `platform_agent_memory`:

| Rule Type | Purpose | Example |
|---|---|---|
| `HARD_RULE` | Must-follow guardrails | "Never fabricate column names" |
| `SCHEMA_MAP` | Table/schema paths | "Crew data is in ops.crew_manifest" |
| `HEURISTIC` | General tips | "Filter by voyage_id before joining" |
| `SOURCE_PREF` | Which data source to use | "Use curated_db for vessel data" |
| `FAILURE_MODE` | Known failure patterns | "Unqualified table name causes TABLE_NOT_FOUND" |

Each bullet has:
- `confidence` (0–1)
- `helpful_count` / `harmful_count`
- `embedding` (vector for similarity search)
- `visibility` (`org` or `personal`)
- `task_signature` (groups related rules by topic)
- `status` (`ACTIVE`, `SUPERSEDED`, etc.)

### 4.3 Three-Phase Retrieval

When `MEMORY_INJECT_ENABLED=true`, every Inspector chat runs `selectMemoryAll()`:

```
Phase 0 (INIT) — Guardrails
├── Always includes default guardrail (verify tables exist)
├── Plus DB HARD_RULEs with confidence ≥ 0.9 and harmful_count ≥ 1
├── Injected into: system prompt
└── Budget: ~200 tokens

Phase 1a (SCHEMA_GLOBAL) — Schema Facts
├── All SCHEMA_MAP bullets for the agent class
├── Filtered by topic group (if topic detected)
├── Plus personal taught rules (user's own teachings)
├── Sorted by: confidence × (helpful - harmful)
├── Injected into: system prompt
└── Budget: ~600 tokens (configurable)

Phase 1b (TASK_SCOPED) — Contextual Recall
├── Embed the user's question (Titan)
├── Cosine search over HEURISTIC / SOURCE_PREF / FAILURE_MODE
├── Optional MMR diversity re-ranking
├── Injected as: synthetic assistant message (recall turn)
└── Budget: ~1200 tokens (configurable)
```

**Why three phases?**
- Phase 0 = safety (always on, no search needed)
- Phase 1a = domain knowledge (deterministic, topic-scoped)
- Phase 1b = situational (semantic search, changes per question)

### 4.4 Personal Taught Lane

Problem: A user teaches a rule, but it has `helpful_count=0` so it ranks below org-wide rules and never gets injected.

Solution: A separate recency-ordered pass that surfaces the caller's own `visibility='personal'` rules alongside the net-helpful set. Never leaks to other users.

### 4.5 MMR Diversity

When `MEMORY_MMR_ENABLED=true`:

1. Fetch top 40 candidates by cosine similarity
2. Re-rank with Maximal Marginal Relevance (λ=0.7 default)
3. Select diverse bullets that don't repeat the same advice
4. Pack into token budget

Prevents injecting 5 bullets that all say "use ops.crew_manifest".

### 4.6 Injection Flow (Runtime)

```typescript
// In chat/route.ts (simplified)
if (isMemoryInjectionEnabled('inspector')) {
  const { phase0, phase1a, phase1b } = await selectMemoryAll(orgId, 'inspector', taskCtx, topicKey, callerUserId);

  finalSystemPrompt += formatForInjection(phase0, INIT);
  finalSystemPrompt += formatForInjection(phase1a, SCHEMA_GLOBAL);

  // Phase 1b as synthetic assistant turn
  userMessages.unshift({ role: 'assistant', content: formatForInjection(phase1b, TASK_SCOPED) });

  recordInjection(orgId, sessionId, injectedBullets);  // for attribution
}
```

Formatted block looks like:

```
=== OPERATING MEMORY | phase:init ===
- [HARD_RULE] Before acting, verify tables exist in schema context...
- [HARD_RULE] Never use unqualified table names in maritime_db
=== END OPERATING MEMORY ===
```

### 4.7 Synthesis — How New Memories Are Created

**Trigger:** Nightly DAG at 04:30 UTC (`orchestrate.ts`)

**Pipeline (`run-sweep.ts`):**

```
1. Find unprocessed sessions (newer than watermark)
2. For each session:
   a. reconstructSession() — rebuild trace graph
   b. reflectSession() — LLM extracts candidate bullets
   c. curate() — dedup, validate, quarantine bad rules
   d. Insert into platform_agent_memory
3. Log sweep summary
```

**Weekly DAG (Sunday 05:30 UTC):**
```
grow_refine → dedup, TTL expiry, garbage collection
reclassify  → FOER topic clustering refresh
```

**Nightly conditional:** If topic coverage drops below target after synthesize, `reclassify` runs inline.

### 4.8 FOER — Topic Clustering

**FOER** = Framework for Organizing Episodic Recall

Groups memory bullets by `task_signature` into `platform_memory_topics` with human-readable `topic_key` labels (e.g., "crew-certificates", "vessel-voyage").

Enables Phase 1a to scope SCHEMA_MAP retrieval to the right domain.

### 4.9 Attribution Loop

Closes the feedback loop — did injected memories actually help?

```
At injection time:
  recordInjection(orgId, runId, bullets)
  → INSERT into platform_memory_injections

After run completes:
  attributeRunOutcome(runId, { success: true/false })
  → If success: helpful_count++, confidence += 0.02
  → If failure: harmful_count++
  → If harmful_count >= 3 and >= helpful_count: status = SUPERSEDED
  → If MEMORY_REPUTATION_ENABLED: update user reputation
```

**Idempotent:** Replayed calls find zero unattributed rows → no-op.

### 4.10 Reputation System

When `MEMORY_REPUTATION_ENABLED=true`:

- Users earn reputation when their contributed rules lead to successful runs
- Season-based scoring with configurable epochs
- Leaderboard in Agent Lab UI
- Rollover between seasons

### 4.11 Teach Mode

Explicit user correction path (separate from automatic synthesis):

```
1. User corrects AI during session
2. Teach candidate captured (PlatformTeachCandidate)
3. Conflict detection against existing memories
4. Admin reviews in Teach UI
5. On approval → promoted to ACTIVE memory bullet
   visibility='personal' or 'org'
```

Personal taught rules get the dedicated retrieval lane (Section 4.4).

### 4.12 Advisory Locking

Background jobs use PostgreSQL advisory locks (`memory/lock.ts`) so only one synthesis DAG runs at a time per org. Prevents duplicate processing.

### 4.13 Why Memory Is Useful

| Benefit | How |
|---|---|
| Faster answers | AI doesn't rediscover schema paths every time |
| Fewer errors | FAILURE_MODE rules prevent repeat mistakes |
| Org knowledge | Schema maps shared across all analysts |
| Personal preferences | Your taught rules follow you |
| Self-improving | Nightly synthesis extracts lessons automatically |
| Quality control | Bad rules get superseded via attribution |
| No model retraining | Rules injected at prompt time — instant effect |

---

## 5. End-to-End Example

**Scenario:** Analyst asks "How many active crew certificates expire this month?"

### Step 1 — Memory Retrieval (before AI thinks)

```
Phase 0:  "Verify tables exist before querying"
Phase 1a: "Crew certificates are in ops.crew_certificates"
          "expiry_date column is DATE type, not timestamp"
Phase 1b: "For certificate queries, filter status='ACTIVE' first"
```

### Step 2 — AI Plans (Agent Loop iteration 1)

```
System prompt includes memory + semantic context
AI decides: describe_schema search "crew certificates"
→ Tool: describe_schema({ action: "search", query: "crew certificates" })
→ Result: ops.crew_certificates found with columns cert_id, expiry_date, status
```

### Step 3 — AI Queries (iteration 2)

```
AI writes SQL:
  SELECT COUNT(*) FROM ops.crew_certificates
  WHERE status = 'ACTIVE'
  AND expiry_date BETWEEN DATE_TRUNC('month', CURRENT_DATE)
                      AND LAST_DAY(CURRENT_DATE)
→ Tool: execute_tool({ statement: "SELECT..." })
→ Safety gate: ✅ read-only, ✅ single statement, ✅ has LIMIT
→ Databricks returns: { count: 47 }
```

### Step 4 — AI Answers (iteration 3)

```
AI streams: "There are 47 active crew certificates expiring this month."
Suggests follow-ups: "Show breakdown by vessel", "List the expiring certificates"
```

### Step 5 — Lifecycle (after stream closes)

```
Trace graph saved: ACTION → OUTCOME → ACTION → OUTCOME
Cost logged: 3 loops, 4200 input tokens, 380 output tokens
Run scored: success
Memory attribution: 3 injected bullets → helpful_count++
Marcus reflects: "Efficient 2-tool path, good use of catalog search"
```

### Step 6 — Overnight Synthesis

```
Synthesis sweep finds this session
Reflect LLM extracts:
  "For crew certificate expiry queries, ops.crew_certificates.expiry_date
   is DATE — use BETWEEN with DATE_TRUNC, not timestamp comparison"
→ Curated and stored as HEURISTIC bullet
→ Available for tomorrow's questions
```

---

## 6. Configuration & Feature Flags

### AI / Agent

| Variable | Default | Effect |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | required | Bedrock access |
| `AWS_SECRET_ACCESS_KEY` | required | Bedrock access |
| `BEDROCK_REGION` | `us-east-1` | LLM region |
| `BEDROCK_SONNET_MODEL_ID` | — | Synthesis + Marcus model |
| `MARCUS_REFLECT_ENABLED` | off | Post-session reflection |
| `MARCUS_FIRST_TURN_ALWAYS` | off | Force first-turn reflection |
| `INSPECTOR_AUTH_ENFORCE` | off | Require service token |
| `DATABRICKS_MAX_ROWS` | 1000 | SQL row cap |
| `DATABRICKS_MAX_WAIT_SECS` | 30 | Query timeout |

### Memory

| Variable | Default | Effect |
|---|---|---|
| `MEMORY_INJECT_ENABLED` | off | Master switch for injection |
| `MEMORY_INJECT_CLASSES` | — | Comma list: `inspector,workbench` |
| `MEMORY_PHASE1A_BUDGET` | 600 | Token budget for schema maps |
| `MEMORY_PHASE1B_BUDGET` | 1200 | Token budget for task recall |
| `MEMORY_MMR_ENABLED` | off | Diversity re-ranking |
| `MEMORY_MMR_LAMBDA` | 0.7 | MMR balance (relevance vs diversity) |
| `MEMORY_REPUTATION_ENABLED` | off | User reputation scoring |
| `MEMORY_P1B_FULLPOOL` | off | Wider candidate pool for Phase 1b |
| `MEMORY_PERSONAL_LANE_BUDGET` | 400 | Token budget for personal rules |
| `MEMORY_CAVEAT_GUARD_ENABLED` | off | Filter stale caveat bullets |
| `MEMORY_COMPRESS_ENABLED` | off | Compress bullets for token budget |

---

## 7. Key Source Files

### AI
| File | Purpose |
|---|---|
| `src/lib/inspector/agent-loop.ts` | Bedrock streaming agent loop |
| `src/lib/inspector/providers/factory.ts` | Provider dispatch |
| `src/lib/inspector/prompts.ts` | System prompts + tool schemas |
| `src/app/api/inspector/chat/route.ts` | Chat API orchestration |
| `src/lib/context/embed.ts` | Titan embeddings |

### Agent
| File | Purpose |
|---|---|
| `src/lib/inspector/tools.ts` | Tool execution |
| `src/lib/databricks/execute.ts` | SQL safety chokepoint |
| `src/lib/inspector/chart-pipeline.ts` | Query → chart pipeline |
| `src/lib/memory/trace/capture.ts` | Trace graph writer |
| `src/lib/lifecycle/log-agent-cost.ts` | Cost tracking |
| `src/lib/lifecycle/score-run.ts` | Run quality scoring |
| `src/lib/marcus/inspectorReflect.ts` | Trajectory reflection |

### Memory
| File | Purpose |
|---|---|
| `src/lib/memory/retrieve.ts` | Three-phase retrieval |
| `src/lib/memory/attribution.ts` | Helpful/harmful loop |
| `src/lib/memory/orchestrate.ts` | Nightly/weekly DAG |
| `src/lib/memory/run-sweep.ts` | Synthesis sweep |
| `src/lib/memory/synthesis/reflect.ts` | LLM rule extraction |
| `src/lib/memory/synthesis/curate.ts` | Dedup + validation |
| `src/lib/memory/reputation/engine.ts` | Reputation scoring |
| `src/lib/foer/run-cluster.ts` | Topic clustering |
| `src/lib/memory/phases.ts` | Phase budgets + rule types |

---

*For the full platform architecture, see [ARCHITECTURE.md](../ARCHITECTURE.md). For the interactive visual guide, open [architecture-guide.html](../architecture-guide.html) or [ai-agent-memory-guide.html](./ai-agent-memory-guide.html).*
