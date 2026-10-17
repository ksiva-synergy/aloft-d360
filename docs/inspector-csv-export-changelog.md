# Inspector CSV export & session Continue — change log

> **For future chats / agents:** read this file before changing Inspector export,
> Databricks execute, Data Studio download, or session-knowledge Continue behavior.
> Append new entries at the top of the Changelog section (newest first).

**Session / workspace:** `aloft-d360`  
**Origin chat topic:** Inspector agent fetch Databricks rows (SIRE / vessel) as CSV up to 1 lakh rows; agent over-joining; Continue rediscovering via `describe_schema`.

---

## Decisions locked

| Decision | Choice |
|----------|--------|
| Large download delivery | **Method A** — stream CSV in one authenticated API request (no S3/ECS v1) |
| Formats | CSV only (Excel later) |
| Hard row cap | **100,000** (`EXPORT_MAX_ROWS`) |
| Chat / preview path | Unchanged INLINE `execute_tool` (~1k UI); do **not** dump 100k into `studio_query_results` |
| Export SQL policy | Reuse **last successful** query; **no unsolicited JOIN/UNION** unless `allow_combined:true` |
| Continue rediscovery | SESSION KNOWLEDGE + `studio_query_results` facts; never wipe `inspectorKnowledge` on autosave |

---

## Changelog

### 2026-09-28 — Export before execute (EXPORT_NO_SQL) + OpenAI embeds

**Problem:** Agent called `export_query_result` (filename only) before `execute_tool` → empty `queryResults` → false failure while DATA table already had rows from a later execute. UI looked “stuck loading”.

**Changes:**
- [`src/lib/inspector/tools.ts`](../src/lib/inspector/tools.ts) — if no in-turn SQL, load last `studio_query_results.sql` for the session; distinct `EXPORT_NO_SQL` vs `EXPORT_COMBINE_REJECTED`.
- [`src/lib/inspector/prompts.ts`](../src/lib/inspector/prompts.ts) — mandatory order: execute_tool → then export; retry guidance on EXPORT_NO_SQL.
- Chart pane “loading” in UI is usually **not** a fetch failure — needs a numeric Y column (“Select a numeric Y column…”). Use **CSV** button for download.

---

### 2026-09-28 — Embeddings: OpenAI only (Titan disabled)

**Problem:** Titan Bedrock embed attempted first → invalid AWS token noise; user has no Titan path.

**Changes:**
- [`src/lib/azure/embed-client.ts`](../src/lib/azure/embed-client.ts) — `embedWithFallback` uses Azure OpenAI / Foundry only; Titan / Bedrock embed calls removed; `isAwsEmbeddingConfigured()` always false.

---

### 2026-09-28 — Session-knowledge LLM + embed log noise

**Problem (terminal):**
1. `[session-knowledge-llm] … 'max_tokens' is not supported … Use 'max_completion_tokens'`
2. `[embed] Titan … UnrecognizedClientException` (obsolete after OpenAI-only switch)

**Changes:**
- [`src/lib/inspector/session-knowledge-llm.ts`](../src/lib/inspector/session-knowledge-llm.ts) — use model registry `tokenParam`; retry with alternate if API rejects.
- [`src/lib/boost/models.ts`](../src/lib/boost/models.ts) — `gpt-6-luna` → `tokenParam: 'max_completion_tokens'`.

### 2026-09-29 — Session-knowledge temperature for gpt-6-luna

**Problem (terminal):**
`[session-knowledge-llm] … Unsupported value: 'temperature' does not support 0 … Only the default (1) value is supported.`

**Changes:**
- [`src/lib/inspector/session-knowledge-llm.ts`](../src/lib/inspector/session-knowledge-llm.ts) — omit `temperature` on Foundry summary calls (same as `foundry-chat`).

---

### 2026-09-28 — Continue rediscovery fix + this log

**Problem:** After “Continue”, agent ran `describe_schema` again. Session `progress` only had `last_model`; `inspectorKnowledge` was missing.

**Root causes:**
1. Client `PATCH` with `last_model` rebuilt `progress` from `{}` and **wiped** `inspectorKnowledge`.
2. Path regex did not match `landing_zone_dev.*` tables used by SIRE.
3. No fallback from `studio_query_results` when progress knowledge was empty.

**Changes:**
- [`src/app/api/agent-lab/workbench/sessions/[id]/route.ts`](../src/app/api/agent-lab/workbench/sessions/[id]/route.ts) — merge `progress` / `last_model` from **DB** first; do not assign `progress` via the generic field loop.
- [`src/lib/inspector/session-knowledge-store.ts`](../src/lib/inspector/session-knowledge-store.ts) — atomic `jsonb_build_object` save; `buildSessionKnowledgeContext` enriches from recent `studio_query_results` (paths + last SQL heuristic).
- [`src/lib/inspector/session-knowledge-core.ts`](../src/lib/inspector/session-knowledge-core.ts) — `QUALIFIED_TABLE_RE` includes `landing_zone_dev`; Continue nextStep text avoids “final join”.
- [`src/lib/inspector/prompts.ts`](../src/lib/inspector/prompts.ts) — Step 0b: on continue/download/export with SESSION KNOWLEDGE, skip Step 1 `describe_schema`.
- **This file** created as the durable change log for future chats.

---

### 2026-09-28 — Export SQL guard (no unwanted JOIN/UNION)

**Problem:** Agent invented `download_log` JOIN + legacy `UNION ALL` for Blue Butterfly CSV; hung >10 min.

**Changes:**
- [`src/lib/inspector/export-sql.ts`](../src/lib/inspector/export-sql.ts) — `resolveExportSql`, `sqlHasMultiSourceCombine`, `stripTrailingLimit`.
- [`src/lib/inspector/tools.ts`](../src/lib/inspector/tools.ts) — `export_query_result` uses resolver; falls back to last single-table SQL; `allow_combined`.
- [`src/lib/inspector/prompts.ts`](../src/lib/inspector/prompts.ts) — CSV EXPORT RULES in harvested + warehouse-only prompts; tool description updated.
- [`src/lib/inspector/__tests__/export-sql.test.ts`](../src/lib/inspector/__tests__/export-sql.test.ts) — unit tests.

---

### 2026-09-28 — Export timeouts (stop infinite spin)

**Problem:** Export poll budget 10 min vs route `maxDuration` 300s → UI spun with no clear failure.

**Changes:**
- [`src/lib/databricks/execute.ts`](../src/lib/databricks/execute.ts) — `EXPORT_POLL_TIMEOUT_MS` = 4 min; `fetchWithTimeout` on submit/poll/chunk/external_link.
- [`src/lib/inspector/download-csv.ts`](../src/lib/inspector/download-csv.ts) — client abort ~4.5 min with actionable error message.
- [`src/lib/databricks/export-limits.ts`](../src/lib/databricks/export-limits.ts) — shared `EXPORT_MAX_ROWS = 100_000`.

---

### 2026-09-28 — Method A CSV export (initial)

**Capability:** Stream Databricks EXTERNAL_LINKS → CSV up to 100k; chat preview unchanged.

**Changes:**
- [`src/lib/databricks/execute.ts`](../src/lib/databricks/execute.ts) — `beginDatabricksSQLExport` + chunk iteration (INLINE path unchanged).
- [`src/lib/databricks/csv.ts`](../src/lib/databricks/csv.ts) — CSV escape helpers.
- [`src/app/api/inspector/export/route.ts`](../src/app/api/inspector/export/route.ts) — `POST` stream `text/csv`, auth, `maxDuration` 300.
- [`src/lib/inspector/download-csv.ts`](../src/lib/inspector/download-csv.ts) — browser download helper.
- [`src/components/studio/DataStudio.tsx`](../src/components/studio/DataStudio.tsx) — Download CSV button.
- [`src/components/inspector/DashboardPane.tsx`](../src/components/inspector/DashboardPane.tsx) — CSV button in chat DATA pane.
- [`src/components/inspector/ExportReadyCard.tsx`](../src/components/inspector/ExportReadyCard.tsx) — agent offer card.
- [`src/hooks/useInspectorChat.ts`](../src/hooks/useInspectorChat.ts) — `export_ready` / `exportOffers`.
- [`src/components/inspector/InspectorShell.tsx`](../src/components/inspector/InspectorShell.tsx) — wire card + `sessionId`.
- [`src/lib/inspector/prompts.ts`](../src/lib/inspector/prompts.ts) / [`tools.ts`](../src/lib/inspector/tools.ts) — `export_query_result` tool.
- [`src/lib/inspector/reflect-tools.ts`](../src/lib/inspector/reflect-tools.ts) — withhold export in Teach/Reflect.
- [`src/lib/databricks/__tests__/csv-export.test.ts`](../src/lib/databricks/__tests__/csv-export.test.ts) — CSV helper tests.

**Out of scope (still):** Excel; Method B (S3/ECS); Method C (warehouse COPY/UNLOAD); persisting 100k rows in Postgres.

---

## How future agents should behave

1. **Do not** raise interactive `DATABRICKS_MAX_ROWS` to 100k for chat.
2. **Do not** stuff large exports into `studio_query_results.rows`.
3. **Do** keep export as a separate EXTERNAL_LINKS path with timeouts under route `maxDuration`.
4. **Do** default export SQL to last successful single-table query.
5. **Do** preserve `progress.inspectorKnowledge` on any session PATCH.
6. **Do** append to this changelog when changing these areas.
