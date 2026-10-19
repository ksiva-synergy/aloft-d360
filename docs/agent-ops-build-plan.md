# Build Plan — Aloft Agent Ops (tracing, developer UI, runs)

> **Goal.** Give developers (10–20 team members) a **polished, in-app** way to see what agentic
> workflows are doing: live traces in Inspector/Workbench, historical runs, failures, and stuck tools —
> **without** hosting Langfuse, Opik, or other third-party observability servers. Data stays in **existing
> Next.js + RDS**; UX should feel comparable to commercial trace UIs (hierarchy, status, timing), scoped
> to Aloft (Databricks, `execute_tool`, FOER links).
>
> **Related docs:** [databricks-auth-and-usage.md](./databricks-auth-and-usage.md),
> [AI-AGENT-MEMORY.md](./AI-AGENT-MEMORY.md) (FOER trace graph),
> [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md), [ops-failure-log.md](./ops-failure-log.md).

---

## Scope and non-goals

### In scope

| Surface | Route / location | Purpose |
|---------|------------------|---------|
| **Developer tab** | Inspector (and later Workbench) right pane | Live + historical **trace timeline** for the current session |
| **History (existing)** | `/agent-lab/history` | Browse sessions — **no duplicate Runs list** |
| **Trace detail** | `/agent-lab/runs/[sessionId]` | Admin “Debug trace” from History; conversation + tool spans |
| **Instrumentation** | Server-only chokepoints | Persist every tool call (success **and** error) |
| **Fancy UI** | Shared React components | Timeline spine, status colors, expand SQL/errors, stuck detection |

### Out of scope (later phases — same product, not v1)

- Self-hosted **Langfuse** or **Opik** (no second deployment; their feature lists inform our roadmap only)
- Full prompt optimizer / Opik Guardrails clone
- Replacing **Boost**, **bandit_observations**, or **FOER** trace — link to them, don’t duplicate
- Storing full warehouse **result rows** in ops logs (link to Inspector results / dashboard)
- Embedding third-party trace UIs in iframes

### Success criteria (v1)

1. A developer can open **Developer** during a chat and see loops and tools update in real time.
2. After a failed or stuck turn, **Runs** or refresh shows the failure **without** reading the terminal.
3. SQL and secrets are **redacted** by default in ops storage and UI.
4. Only **admin / platform_admin** (or env-gated devs) see Developer tab and Runs.

---

## Why build in-house (decision record)

| Constraint | Custom Agent Ops | Langfuse / Opik self-host |
|------------|------------------|---------------------------|
| No extra hosting | Same EB + RDS | +$20–180/mo, second stack to patch |
| Privacy (maritime / SQL) | Redaction in our code | Possible, still another system |
| Databricks-specific UX | Native chips, connection errors | Generic |
| Fancy UI in Agent Lab | One design system | Separate product UI |
| Team size 10–20 | Postgres + good UI is enough | Overkill unless evals at huge scale |

**Strategy:** Build **Agent Ops** on RDS. Reuse Langfuse/Opik ideas for **features** (trace tree, datasets, prompts) in **phases C–D**, not their servers.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
│  InspectorShell / WorkbenchShell                                 │
│    ├─ Chat (existing)                                            │
│    └─ DeveloperPane ← AgentTraceTimeline (live from messages/SSE) │
│  RunsPage / RunDetailPage ← same AgentTraceTimeline + API       │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Next.js API                                                     │
│  GET /api/agent-lab/runs                                         │
│  GET /api/agent-lab/runs/[sessionId]                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Instrumentation (server-only)                                   │
│  src/lib/agent-ops/log-tool-invocation.ts                        │
│  src/lib/agent-ops/redact.ts                                     │
│  Called from: executeInspectorTool, chat route (turn summary)    │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Postgres (existing)                                             │
│  tool_invocation_log  ← primary audit (schema exists, wire writes)│
│  workbench_sessions.messages                                     │
│  bandit_observations, agent_cost_log                             │
│  platform_trace_nodes (link only — FOER synthesis)               │
└─────────────────────────────────────────────────────────────────┘
```

**Single write chokepoint:** All tool logging goes through `logToolInvocation()`. Never log credentials or full result grids.

---

## Data model

### Existing tables (use as-is)

**`tool_invocation_log`** (`prisma/schema.prisma`):

| Column | Use |
|--------|-----|
| `session_id` | `workbench_sessions.id` |
| `run_id` | Optional turn id or message id |
| `loop` | Agent loop index from `loop_start` |
| `tool_name` | e.g. `execute_tool`, `describe_schema` |
| `input` / `output` | **Redacted** JSON |
| `duration_ms` | Wall time |
| `status` | `success` \| `error` \| `running` (optional: update row on complete) |
| `error` | Truncated message |
| `model` | Effective model id for the turn |

Indexes already exist: `session_id`, `tool_name`, `created_at`, `status`.

**`workbench_sessions`:** `messages` JSON holds UI state; use for conversation replay.

**`bandit_observations`:** Turn-level outcome, tool error counts — attach on `done` event (already written from Inspector chat).

### Optional v1.1 — `agent_turn_events` (only if turn grouping is awkward)

Thin table: `session_id`, `turn_index`, `user_message_excerpt`, `outcome`, `model`, `duration_ms`, `started_at`, `ended_at`.  
**Prefer deriving turns from messages + invocation log in v1** to avoid migration.

### Input/output redaction (`redact.ts`)

- Truncate SQL `statement` to **500 chars** in stored JSON; flag `_truncated: true`.
- Strip `client_secret`, `Authorization`, `DATABRICKS_CLIENT_SECRET` keys.
- For `execute_tool` output: store `row_count`, `truncated`, `statement_id` — not `rows[]`.
- Max JSON size per field: **8 KB** (hard cap before insert).

---

## Instrumentation

### 1. `logToolInvocation(params)`

**File:** `src/lib/agent-ops/log-tool-invocation.ts`

```ts
// Pseudocode — implement with prisma.tool_invocation_log.create
export async function logToolInvocation(params: {
  sessionId: string | null;
  runId?: string | null;
  loop: number;
  toolName: string;
  callId?: string;
  model?: string;
  status: 'success' | 'error';
  durationMs: number;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
}): Promise<void>
```

- Fire-and-forget: `.catch(err => console.error('[agent-ops]', err))` — never fail the user request.
- Call **after** tool completes (success or catch).

### 2. Wire points (v1: Inspector)

| Location | When |
|----------|------|
| `src/lib/inspector/tools.ts` | `execute_tool`, `describe_schema`, etc. — in success path and `tool_call_error` paths |
| `src/app/api/inspector/chat/route.ts` | On unhandled errors in `onToolCallEvent` (e.g. trace capture throws) — log `server_error` pseudo-tool or turn-level row |

**Workbench (v1.1):** Same hook from workbench tool executor.

### 3. Loop index

Pass `loop` from agent loop via `executeInspectorTool` context or thread-local on the SSE handler (`loop_start` event sets current loop on request scope).

### 4. Chat route trace capture bug (fixed)

Do **not** `JSON.parse` truncated strings for `platform_trace_nodes` payloads. Store object or `{ _truncatedInput: string }` only. (See `chat/route.ts` ACTION node.)

---

## API

### `GET /api/agent-lab/runs`

**Auth:** session required; `platform_admin` sees all org sessions, others own sessions only (match History policy).

**Query params:** `surface`, `status` (failed), `model`, `from`, `to`, `limit`, `cursor`.

**Response:**

```json
{
  "runs": [
    {
      "sessionId": "uuid",
      "title": "string | null",
      "surface": "inspector | workbench",
      "updatedAt": "ISO",
      "model": "string | null",
      "outcome": "completed | truncated | errored | unknown",
      "toolErrorCount": 0,
      "lastUserExcerpt": "string",
      "stuck": false
    }
  ],
  "nextCursor": "string | null"
}
```

**Implementation:** Join `workbench_sessions` with latest `bandit_observations` by `source_run_id` and aggregate `tool_invocation_log` error counts.

### `GET /api/agent-lab/runs/[sessionId]`

**Response:**

```json
{
  "session": { "id", "title", "surface", "contextMode", "messages" },
  "turns": [
    {
      "turnIndex": 0,
      "userExcerpt": "...",
      "assistantExcerpt": "...",
      "loops": [
        {
          "loop": 1,
          "tools": [
            {
              "callId": "...",
              "toolName": "execute_tool",
              "status": "success",
              "durationMs": 1706,
              "inputRedacted": {},
              "error": null,
              "startedAt": "ISO"
            }
          ]
        }
      ],
      "outcome": "completed",
      "usage": { "inputTokens", "outputTokens" }
    }
  ],
  "links": {
    "foerTrace": "/api/agent-lab/memory/trace/{sessionId}",
    "inspector": "/inspector?session={sessionId}"
  }
}
```

**Merge strategy:** Prefer `tool_invocation_log` for history; overlay live `running` from client when on Developer tab.

---

## UI specification

### Design tokens

Reuse Agent Lab / FOER patterns:

- Mono: SQL and ids (`IBM Plex Mono` / existing `--font-mono`)
- Status rail colors (align with `SessionDetailDrawer` node colors):
  - **Running:** amber + pulse
  - **Success:** teal/blue (`OUTCOME`)
  - **Error:** `#D9774B` (`DEAD_END`)
- Spacing: see [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)

### Shared components

| Component | Path | Responsibility |
|-----------|------|----------------|
| `AgentTraceTimeline` | `src/components/agent-ops/AgentTraceTimeline.tsx` | Renders loops → tool spans; expand/collapse |
| `ToolSpanRow` | `src/components/agent-ops/ToolSpanRow.tsx` | Icon, name, duration pill, status |
| `SqlPreview` | `src/components/agent-ops/SqlPreview.tsx` | Truncated SQL, copy button |
| `DeveloperPane` | `src/components/agent-ops/DeveloperPane.tsx` | Summary bar + timeline + session meta |
| `RunsPage` | `src/app/(agent)/agent-lab/runs/page.tsx` | List + filters |
| `RunDetailPage` | `src/app/(agent)/agent-lab/runs/[sessionId]/page.tsx` | Split: chat \| trace |

### Developer tab (Inspector)

1. Extend `RightPaneTab` in `SemanticGovernancePanel.tsx`: `'results' | 'semantic' | 'developer'`.
2. `InspectorShell`: show **DEVELOPER** tab when `canViewAgentOps(session)` (admin roles or `process.env.NEXT_PUBLIC_ENABLE_DEV_TAB === 'true'` in dev).
3. `DeveloperPane` props:
   - `sessionId`, `messages`, `isStreaming`, `selectedModel`, `dbConnected`, `contextMode`
4. Build timeline from latest assistant message `toolCalls` + global loop events if exposed from `useInspectorChat`.
5. **Stuck rule:** if any tool `status === 'running'` for &gt; 60s, show warning banner.

### Runs pages

- **List:** Card layout with left status stripe, title, relative time, model chip, error count.
- **Detail:** Left 40% conversation (collapsed bubbles); right 60% `AgentTraceTimeline` with turn selector (dropdown or stepper).
- **Empty / error states:** Link to [ops-failure-log.md](./ops-failure-log.md) patterns for Databricks auth.

### Optional v1.2 — graph view

For turns with &gt; 4 tools, optional **React Flow** mini-graph (`@xyflow/react` already in repo). Default remains vertical timeline.

### Navigation

Do **not** add a separate Runs nav item — link **Debug trace** from History (admin) to `/agent-lab/runs/[sessionId]`.

---

## Access control

| Role | Developer tab | Runs list |
|------|---------------|-----------|
| `platform_admin` | Yes | All org sessions |
| `admin` | Yes | Own sessions (or all — product choice; document in RBAC) |
| `member` / `readonly` | No | No |

Implement `canViewAgentOps(user)` in `src/lib/agent-ops/access.ts` using `resolvePrimaryRole` from `@/lib/rbac`.

---

## Phased delivery

### Phase A — Foundation + fancy Developer tab (MVP)

**Estimate:** 1–2 engineers, ~2–3 weeks.

- [ ] `log-tool-invocation.ts` + `redact.ts`
- [ ] Wire `executeInspectorTool` (+ errors)
- [ ] `AgentTraceTimeline`, `DeveloperPane`
- [ ] `DEVELOPER` tab in Inspector (gated)
- [ ] `GET /api/agent-lab/runs/[sessionId]` (detail only OK for MVP)
- [ ] Manual test: success path, Databricks error, server throw mid-tool

### Phase B — Runs list + search

**Estimate:** ~1–2 weeks.

- [ ] `GET /api/agent-lab/runs` with filters
- [ ] Runs list + detail pages
- [ ] Nav entry
- [ ] Retention script: delete `tool_invocation_log` older than 90 days (cron or GitHub Action)

### Phase C — Workbench parity

- [ ] Same instrumentation on workbench chat tools
- [ ] Developer tab on `WorkbenchShell`

### Phase D — Prompt registry (Langfuse-like)

- [ ] `prompt_templates` migration
- [ ] UI under `/agent-lab/ops/prompts`
- [ ] Pin version on turn metadata

### Phase E — Evals (Opik-like, via Boost)

- [ ] `eval_cases`, `eval_runs` tables
- [ ] Headless runner reusing Inspector path
- [ ] CI optional: GitHub Action
- [ ] Scores from existing Boost scorers — do not duplicate judge logic

---

## Testing

| Type | What |
|------|------|
| Unit | `redact.ts` — secrets stripped, SQL truncated |
| Integration | Log row created on mocked `execute_tool` failure |
| E2E (optional) | Playwright: open Developer tab, send message, see tool row |

---

## Operations

- **Retention:** 90 days default on `tool_invocation_log`; configurable `AGENT_OPS_RETENTION_DAYS`.
- **Monitoring:** CloudWatch log filter on `[agent-ops]` insert failures.
- **Incidents:** Document new failure modes in [ops-failure-log.md](./ops-failure-log.md).

### Environment variables (implement in Phase A; tune in prod)

| Variable | Default (dev) | Purpose |
|----------|---------------|---------|
| `AGENT_OPS_RETENTION_DAYS` | `90` | Hot data in Postgres; cron deletes older rows |
| `AGENT_OPS_SAMPLE_SUCCESS_RATE` | `1.0` | `0.0–1.0`; lower in prod when volume grows (e.g. `0.1`) |
| `AGENT_OPS_ALWAYS_LOG_ERRORS` | `true` | When `true`, never sample away `status=error` |
| `AGENT_OPS_ALWAYS_LOG_SLOW_MS` | `30000` | Always log tools slower than this threshold |
| `AGENT_OPS_MAX_PAYLOAD_BYTES` | `8192` | Cap redacted `input`/`output` JSON per row |

**Sampling rule in `logToolInvocation`:** skip insert for `success` only when
`random() > AGENT_OPS_SAMPLE_SUCCESS_RATE`, unless error or `durationMs >= ALWAYS_LOG_SLOW_MS`.
On skip, optional single-line structured log to CloudWatch: `sessionId`, `toolName`, `durationMs`
(no SQL body).

---

## Future notes — scale & retention (when user base grows)

> **Not required for Phase A.** Design Agent Ops so these upgrades are possible without
> replacing the UI or adopting Langfuse/Opik. Revisit when metrics in the table below trigger.

### What grows fastest

| Store | Driver | Risk at scale |
|-------|--------|-------------|
| `tool_invocation_log` | Every tool call | Table size, insert IOPS, slow Runs list |
| `workbench_sessions.messages` | Chat + tool cards in JSON | Large rows, session load time |
| `bandit_observations` / `agent_cost_log` | ~1 row per completed turn | Moderate |
| `platform_trace_nodes` | FOER pipeline only | Moderate |

Analyst growth increases **messages**; developer Runs traffic stays small if **Developer tab /
Runs remain role-gated**.

### Principles (keep from day one)

1. **Retention by default** — hot window in Postgres; archive or delete beyond that.
2. **Redact + cap** — no warehouse result rows in ops tables (see `redact.ts`).
3. **Sample successful tool logs in production** — never sample away errors or slow tools.
4. **Scope by `org_id`** — all Runs APIs tenant-scoped; cross-org only `platform_admin` + audit.
5. **List from summaries eventually** — don’t scan full invocation log for every list page at scale.

### Growth stages

#### Stage 1 — Small / medium (current → hundreds of active users)

- Postgres only; 90-day retention job; pagination + date filters on Runs list.
- **Watch:** `pg_total_relation_size('tool_invocation_log')`, p95 of `GET /api/agent-lab/runs`.

#### Stage 2 — Large (many users, millions of tool rows / month)

| Tactic | Action |
|--------|--------|
| Partitioning | Monthly partitions on `tool_invocation_log.created_at`; detach/drop old months |
| Sampling | Lower `AGENT_OPS_SAMPLE_SUCCESS_RATE` (e.g. 5–10%) |
| Summary table | Nightly job: `session_run_summary` (session_id, org_id, outcome, error_count, updated_at) — **list reads summary**, detail reads log |
| Read replica | RDS replica for Runs read APIs only |
| Message compaction | Optional: strip bulky tool `output` from old `messages` JSON (> N days) |

#### Stage 3 — Very large (tens of millions of ops events / month)

```text
Write path:
  errors + sampled success → Postgres (7–30 days hot)
  redacted events           → S3 parquet (or Kinesis) → Athena / ClickHouse

Runs UI:
  recent window  → Postgres API
  deep search    → async query to Athena/ClickHouse (“may take a few seconds”)
```

Alternative: OpenTelemetry export to CloudWatch/S3 for volume; Postgres keeps **per-session
recent** detail for developers.

#### Stage 4 — Multi-org / enterprise

- Per-org `retention_days` and `sample_success_rate` on `platform_orgs` (or org settings JSON).
- Compliance long retention: **cold archive (S3)**, not multi-year hot Postgres.

### Upgrade triggers (when to act)

| Signal | Suggested action |
|--------|------------------|
| `tool_invocation_log` &gt; ~50–100 GB or Runs list p95 &gt; 2s | Partitions + `session_run_summary` + replica |
| Insert IOPS saturates writer | Sampling + optional SQS batch writer for log inserts |
| Legal/compliance needs 1+ year audit | S3 archive + Athena; keep 30–90d hot in RDS |
| Need sub-second search across all fields at billions of spans | Add ClickHouse **for ops data only** or revisit vendor — not required for analyst chat |

### Audience vs load

| Audience | Scale note |
|----------|------------|
| 10–20 developers | Runs + Developer tab on Postgres is sufficient for years with retention |
| Many analysts | Do **not** grant Agent Ops roles; sampling limits tool-log volume from chat |
| Everyone on Developer tab | Avoid — drives ops read/write cost with no benefit |

### Optional future work (backlog)

- [ ] Retention cron (EventBridge + Lambda or GitHub Action against RDS)
- [ ] `session_run_summary` materialized table + migration
- [ ] Postgres monthly partitions for `tool_invocation_log`
- [ ] S3 parquet export job for archived invocations
- [ ] Per-org settings UI for retention/sample rate

---

## File checklist (create / modify)

### New files

```
src/lib/agent-ops/log-tool-invocation.ts
src/lib/agent-ops/redact.ts
src/lib/agent-ops/access.ts
src/lib/agent-ops/types.ts
src/components/agent-ops/AgentTraceTimeline.tsx
src/components/agent-ops/ToolSpanRow.tsx
src/components/agent-ops/SqlPreview.tsx
src/components/agent-ops/DeveloperPane.tsx
src/app/(agent)/agent-lab/runs/page.tsx
src/app/(agent)/agent-lab/runs/[sessionId]/page.tsx
src/app/api/agent-lab/runs/route.ts
src/app/api/agent-lab/runs/[sessionId]/route.ts
```

### Modify

```
src/lib/inspector/tools.ts
src/app/api/inspector/chat/route.ts
src/components/inspector/SemanticGovernancePanel.tsx  (RightPaneTab)
src/components/inspector/InspectorShell.tsx
src/components/agent-lab/staging/nav-config.ts
src/hooks/useInspectorChat.ts  (optional: expose loop index / turn boundary)
```

---

## Appendix — Mapping Langfuse / Opik features to phases

| Vendor feature | Aloft Agent Ops phase |
|----------------|---------------------|
| Trace / span tree | A — `AgentTraceTimeline` |
| Session view | A/B — Developer + Run detail |
| Trace search | B — Runs filters |
| Production dashboards | B/E — aggregates on invocation log + Bandits |
| Prompt management | D |
| Datasets & experiments | E (+ Boost) |
| LLM-as-judge | E (extend Boost scorers) |
| Online eval rules | E (later) |
| Guardrails | Out of scope (use SQL read-only + RBAC) |

---

**Owner:** Platform / Agent Lab team  
**Status:** Approved for implementation — start Phase A  
**Last updated:** 2026-10-17 (scale & retention notes added)
