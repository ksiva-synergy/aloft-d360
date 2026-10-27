# Inspector context modes — harvested catalog vs warehouse SQL

**Audience:** analysts, implementers, cloud/ops  
**Related:** [context-harvesting-guide.html](./context-harvesting-guide.html), [ARCHITECTURE-FULL.md](../ARCHITECTURE-FULL.md) §2 Inspector, `src/lib/inspector/prompts.ts`

Inspector can answer questions in two ways. The user picks **context mode** in the status bar (`InspectorShell`). The mode is sent on every chat request as `contextMode` and stored on the session as `context_mode`.

| Mode | UI label (typical) | Meaning |
|------|-------------------|---------|
| **`harvested`** (default) | Catalog + SQL / CTX | Find tables via **pre-indexed catalog** in ALOFT (Postgres), then run SQL on Databricks |
| **`warehouse_only`** | SQL only | **No catalog tool** — discover data with live **`SHOW` / `DESCRIBE` / `SELECT`** on Databricks |

---

## 1. What “harvested catalog” is

The **harvested catalog** is not live Databricks introspection inside Inspector. It is metadata **written earlier** by the **Data Estate harvester** (ECS jobs) into Postgres, for example:

- **`platform_context_objects`** — inventory, paths, summaries (T0+)
- **Profiles / enrichments** — T1/T2 column stats, LLM descriptions, PII hints
- **`platform_context_embeddings`** — T3 vectors for semantic search

You browse and refresh this in **Agent Lab → Data Estate → Catalog**. Inspector reads it only when the model calls the **`describe_schema`** tool.

**T0–T3 (short):**

| Stage | What gets stored |
|-------|------------------|
| T0 | Structural inventory (catalog.schema.table, columns) |
| T1 | Profiling (stats, samples) |
| T2 | Enrichment (descriptions, tags) |
| T3 | Embeddings for search |

---

## 2. End-to-end flow (both modes)

```text
User question in Inspector (PromptCanvas)
    → useInspectorChat POST /api/inspector/chat { sessionId, messages, model, contextMode }
    → guardInspectorChat (auth)
    → buildSemanticContext (optional governed metrics/entities in prompt)
    → buildToolConfig(contextMode)     ← different tools
    → buildSystemPrompt(contextMode)   ← different instructions
    → buildInsightsContext (harvested only — studio_insights for session)
    → buildSessionKnowledgeContext (both — per-session heuristics)
    → selectMemoryAll + injection (both, if MEMORY_INJECT_ENABLED)
    → runAgentLoop → tools → stream SSE to UI
    → post-turn: attribution, scoring, Marcus, cost, persist workbench_sessions / studio results
```

**Key files:**

| Layer | Path |
|-------|------|
| UI toggle | `src/components/inspector/InspectorShell.tsx` |
| Client | `src/hooks/useInspectorChat.ts` |
| API | `src/app/api/inspector/chat/route.ts` |
| Prompts + tools | `src/lib/inspector/prompts.ts` (`buildToolConfig`, `buildSystemPrompt`) |
| Tool dispatch | `src/lib/inspector/tools.ts` (`executeInspectorTool`) |
| Catalog reads | `src/lib/context/dispatch.ts`, `src/lib/context/describe.ts` |
| Warehouse SQL | `src/lib/databricks/execute.ts` (`executeDatabricksSQL`) |

---

## 3. How `harvested` finds data

### 3.1 Product behavior

1. Check **OPERATING MEMORY** and **SESSION KNOWLEDGE** (if present).
2. Call **`describe_schema`** with **`action: 'search'`** and a short natural-language query (e.g. “crew certificates”).
3. Use **`describe`** / **`profile`** on returned paths.
4. Call **`execute_tool`** only after a **confirmed** `catalog.schema.table` from the catalog — not `SHOW TABLES` for discovery.
5. If search returns nothing: **do not** run exploratory warehouse SQL; tell the user to specify a path or run an Estate harvest.

### 3.2 Code path

1. Model calls tool **`describe_schema`**.
2. `executeInspectorTool` → `handleDescribeSchema` (`src/lib/context/dispatch.ts`).
3. Actions map to **`describe.ts`** functions — **no warehouse calls** (file invariant: Postgres / `platform_context_*` only).

**`action: 'search'`** → `searchObjects()`:

1. Keyword routing on harvested `domain_keywords` (fast, no embedding).
2. Else embed query + **pgvector** cosine search on `platform_context_embeddings`.
3. Blend with **ILIKE** on `full_path` / `object_name`.
4. Return top‑k paths with scores and short “reason” text.

Other actions: **`list`**, **`describe`**, **`profile`**, **`relations`**, **`usage`**.

### 3.3 When SQL runs

**`execute_tool`** uses the **tool catalog** slug (e.g. `synergy_dwh`):

1. `resolveToolCatalogEntry` → `connection_id`
2. Load `platform_databricks_connection` (host, warehouse id)
3. `getAccessToken` → `executeDatabricksSQL(statement)`

SQL is read-only (`SELECT`, `WITH`, …); discovery is intended to stay on **`describe_schema`**.

### 3.4 Harvested-only prompt extra

`buildInsightsContext(sessionId)` loads prior **`studio_insights`** for the session — only when `contextMode === 'harvested'`.

---

## 4. How `warehouse_only` finds data (without harvest index)

There is **no** ALOFT catalog search in this mode. The model **does not** get `describe_schema`.

### 4.1 What you still have

| Source | Role |
|--------|------|
| **Databricks connection** | Fixed workspace + SQL warehouse (from tool catalog `connection_id`) |
| **User question** | Hints which catalog/schema/table names to try |
| **Multi-turn agent loop** | Results of previous `SHOW` / `DESCRIBE` / `SELECT` in the same chat |
| **Session knowledge** | Table paths / SQL heuristics already confirmed this session |
| **Memory injection** | Rules like SCHEMA_MAP (production chat does **not** disable memory for warehouse mode) |
| **Semantic block** | Governed metrics/entities (if configured) — not a full data dictionary |

### 4.2 What you do not have

- No `describe_schema` → no pgvector/keyword search over harvest tables.
- No mandatory “search catalog first” workflow in the system prompt.
- No `studio_insights` block in the system prompt.

### 4.3 Discovery strategy (prompt-driven)

The model uses **only** `execute_tool` with SQL such as:

```sql
SHOW CATALOGS;
SHOW SCHEMAS IN my_catalog;
SHOW TABLES IN my_catalog.my_schema;
DESCRIBE TABLE my_catalog.my_schema.my_table;
SELECT * FROM my_catalog.my_schema.my_table LIMIT 100;
```

Metadata comes from **Databricks live** (Unity Catalog / metastore). The app does not implement a separate “finder” — it **executes** whatever read-only statement the model sends, through `executeDatabricksSQL` (allowlist includes `SHOW`, `DESCRIBE`, `SELECT`, `WITH`, etc.).

### 4.4 How the connection is resolved (same as harvested SQL)

```text
execute_tool(tool_name: "synergy_dwh", args: { statement: "..." })
  → resolveToolCatalogEntry("synergy_dwh")
  → config.connection_id
  → platform_databricks_connection + token
  → executeDatabricksSQL(host, warehouse_id, statement)
```

Finding data is **iterative exploration by the LLM**, not a hidden index.

### 4.5 Risks

- Vague questions → many `SHOW`/`DESCRIBE` calls or wrong table guesses.
- Higher warehouse cost/latency than catalog search.
- Permissions: user/token must see catalogs/schemas via Databricks RBAC.

---

## 5. Code differences (single switch)

In `src/app/api/inspector/chat/route.ts`:

```ts
const contextMode =
  body.contextMode === 'warehouse_only' ? 'warehouse_only' : 'harvested';
```

Then:

| Function | `harvested` | `warehouse_only` |
|----------|-------------|---------------------|
| `buildSystemPrompt` | `INSPECTOR_SYSTEM_PROMPT` | `INSPECTOR_WAREHOUSE_ONLY_PROMPT` |
| `buildToolConfig` | Full `INSPECTOR_TOOLS` incl. `describe_schema` | **Remove** `describe_schema`; widen `execute_tool` for SHOW/DESCRIBE |
| `buildInsightsContext` | Called | **Skipped** |
| Memory / semantic / session knowledge | Same route (not gated on mode) | Same |

`buildToolConfig` implementation (`prompts.ts`):

- **harvested:** `[...INSPECTOR_TOOLS, ...semanticTools]`
- **warehouse_only:** filter out `describe_schema`; change `execute_tool` description to allow `SHOW`, `DESCRIBE`.

---

## 6. Comparison table

| | **harvested** | **warehouse_only** |
|--|----------------|---------------------|
| **Default** | Yes | User toggles status bar |
| **Find tables** | `describe_schema` → Postgres harvest | `SHOW` / `DESCRIBE` on Databricks |
| **Warehouse used for discovery** | No (for search/describe/profile) | Yes |
| **Warehouse used for answers** | Yes (`execute_tool`) | Yes |
| **Empty / missing harvest** | Prompt: don’t SQL-explore; suggest harvest | Model explores with SQL |
| **Session field** | `context_mode: 'harvested'` | `context_mode: 'warehouse_only'` |

---

## 7. Mental model

- **Harvested** = “Use the **phone book** we already built (Data Estate), then query Databricks with known paths.”
- **Warehouse only** = “No phone book — **walk the warehouse halls** with `SHOW`/`DESCRIBE` until you find the right room, then `SELECT`.”

Both modes still need a **valid Databricks connection** and an **agent loop** that can call tools multiple times per question.

---

## 8. Performance Lab note

`src/lib/boost/runner.ts` can run benchmark arms with `contextMode: 'warehouse_only'` and **skip memory injection** for fair A/B comparison. Production Inspector chat (`chat/route.ts`) does **not** use that skip — memory may still inject in warehouse mode.

---

## 9. Related documentation

- [context-harvesting-guide.html](./context-harvesting-guide.html) — how the catalog is built (T0–T3)
- [self-improving-memory-guide.html](./self-improving-memory-guide.html) — memory injection during chat
- [architecture-guide.html](../architecture-guide.html) — Inspector dedicated page (interactive)

**Last updated:** 2026-10-05
