# Creating agents in ALOFT D360

How agents are defined, where they live, how to create one today, and whether you can start a **domain-specific agent chat**.

Related: [AI-AGENT-MEMORY.md](./AI-AGENT-MEMORY.md) (runtime + memory), [ARCHITECTURE.md](../ARCHITECTURE.md) §7.9 / catalog APIs, [PHASE_LEDGER.md](../PHASE_LEDGER.md) (workbench port status).

---

## 1. What “agent” means in ALOFT

ALOFT uses the word **agent** in three different layers. Do not confuse them with Cursor agents or with Inspector chat.

| Layer | Storage | Purpose |
|-------|---------|---------|
| **Catalog agent** | `agent_catalog` | Governed *definition*: name, type, version, prompt/config, tools, tags, review status. Browse in **Docs → Agents**. |
| **Platform agent** | `platform_agents` (+ optional `platform_agent_manifests`) | *Commissioned runtime* for an org: `agent_class`, routing, KB namespace, retrieval scope, run history. |
| **Inspector session** | `workbench_sessions` (`surface: 'inspector'`) | Analytics chat against Databricks. Memory uses class `'inspector'`. **Not** a catalog or platform agent. |

**Product intent:** explore data in **Inspector**, then design and **commission** a reusable agent in **Agent Lab** so it can own a domain job with tools, memory, and governance.

---

## 2. Why create an agent?

Creating a catalog / platform agent lets the platform:

- **Specialize** — prompts, tools, and schemas for one job (e.g. crew certificates, vessel schedules)
- **Govern** — draft → review → published, with fork / version / diff
- **Scope memory** — learning is keyed by `agent_class` (treated as the memory/reputation *domain*)
- **Operate** — cost logs, bandits, Marcus reflections, teach mode per class

Inspector answers ad-hoc questions. A catalog/platform agent is the durable, reviewable product of that exploration.

---

## 3. Can I create an agent chat for a specific domain?

### Short answer

| Capability | Available today? | Notes |
|------------|------------------|--------|
| Chat in Inspector about a domain (crew, vessels, …) | **Yes (informal)** | Same Inspector chat; steer with questions + harvested catalog. Memory class is always `'inspector'`. |
| Pick a Databricks connection / harvested vs warehouse mode | **Yes** | Connection resolves from tool catalog; `contextMode`: `harvested` \| `warehouse_only`. |
| Create a **catalog** agent tagged/typed for a domain | **Yes (API)** | `POST /api/catalog/agents` with `type`, `tags`, `config.systemPrompt`, `tools`. Docs UI is read-only. |
| Open a **dedicated chat** bound to that catalog agent | **No** | No “Chat as agent X” route wired to catalog entries. |
| Commission a **platform** agent with `agent_class` / `kb_namespace` for a domain | **Partial** | `createAgent()` / `createManifest()` exist in code; **no HTTP + UI** to chat as that agent yet. |
| Workbench builder: interview → validate → **commission** domain agent | **Intended, incomplete** | Construction state + session APIs exist; full workbench commission UI / chat not fully ported (`PHASE_LEDGER.md`). |

### What “domain” means in this codebase

- **Memory / reputation domain** ≈ `agent_class` (e.g. `inspector`, workbench classes, or a future custom class). Leaderboard: `GET /api/agent-lab/memory/leaderboard?domain=<agent_class>`.
- **Data domain** ≈ harvested schema topics + Databricks catalogs/schemas (e.g. `ops.crew_certificates`) discovered via `describe_schema` / Estate harvest.
- **Catalog “type”** ≈ role taxonomy (`orchestrator`, `worker`, `planner`, `validator`, `router`, …), not automatically the same as `agent_class`.

### Practical options right now

1. **Explore a domain in Inspector** (`/inspector`)  
   Ask domain questions; rely on harvested catalog + memory under class `inspector`. Optionally set `contextMode`. This does *not* create a separate domain agent.

2. **Register a domain-oriented definition in the catalog**  
   Use the API (section 4) with domain-focused `name`, `tags`, `config.systemPrompt`, and tool IDs. Browse at `/docs/agents`. You still chat in Inspector until commission/chat is finished.

3. **Prepare for commission (scaffold)**  
   Construction state (`src/lib/construction/constructionState.ts`) can hold `class`, prompt, datasources (`kb` / `databricks` / …), and later `runtimeProvision.kbNamespace` / `retrievalScope`. End-to-end commission → live domain chat is the target product path, not complete in this tree.

---

## 4. How to create a catalog agent (works today)

### Browse (UI)

- List: `/docs/agents`
- Detail: `/docs/agents/[slug]`

There is **no** “Create agent” form in Docs. Creation is via API.

### Create (API)

```http
POST /api/catalog/agents
Content-Type: application/json
```

**Required:** `name`, `type`  
**Optional:** `slug` (auto-generated if omitted), `description`, `version`, `config`, `tools`, `input_schema`, `output_schema`, `bus_subscriptions`, `bus_publications`, `tags`, `status`, `author`, …

Example — domain-oriented worker definition:

```json
{
  "name": "Crew Certificates Analyst",
  "type": "worker",
  "description": "Answers questions about crew certificate expiry and compliance using Synergy DWH.",
  "version": "1.0.0",
  "status": "draft",
  "tags": ["crew", "certificates", "compliance", "maritime"],
  "config": {
    "systemPrompt": "You specialize in crew certificates. Prefer ops.crew_certificates. Always qualify table names. Confirm schema via describe_schema before SQL.",
    "model": "sonnet-4-6",
    "temperature": 0.3
  },
  "tools": [],
  "author": "platform"
}
```

Response: `201` with `{ "item": { ... } }`. Duplicate slug → `409`.

### Lifecycle APIs

| Action | Endpoint |
|--------|----------|
| List / filter | `GET /api/catalog/agents?status=&type=&search=&tag=` |
| Get / update / soft-retire | `GET` / `PATCH` / `DELETE /api/catalog/agents/[id]` (DELETE sets `deprecated`) |
| Review / publish | `POST /api/catalog/agents/[id]/review` |
| Fork | `POST /api/catalog/agents/[id]/fork` |
| Versions | `GET /api/catalog/agents/[id]/versions` |
| Diff | `GET /api/catalog/agents/[id]/diff/[otherId]` |

Draft shape reference: `src/lib/agent-lab/artifactDraftSchemas.ts` (`agentDraftSchema`), types in `src/types/catalog.ts`.

Implementation: `src/app/api/catalog/agents/`.

---

## 5. Platform agent (runtime) — library only

`src/lib/platform/agents.ts`:

```ts
createAgent(orgId, {
  name, slug, agent_class, commissioned_by,
  // optional: description, template_id, routing_mode, data_level,
  // kb_namespace, thread_policy, retrieval_scope
})
```

Then optionally `createManifest(agentId, { classId, skillRef, toolIds, schemaRef, ... })`.

**Domain scoping knobs (when wired to chat):**

| Field | Role |
|-------|------|
| `agent_class` | Memory + reputation domain key |
| `kb_namespace` | Knowledge / recall namespace |
| `retrieval_scope` | How broadly memory/tools are retrieved |
| `thread_policy` | Session/thread behavior |

There is **no** public HTTP route in this repo that exposes “create + chat as platform agent.”

---

## 6. Intended Agent Lab path (domain agent → chat)

Designed flow on `workbench_sessions` with `construction_state`:

```text
interview → plan → build → validate → commission
```

Construction fields relevant to domain:

- `name`, `class` (builder class id / confidence)
- `prompt.instructions` / persona
- `tools.datasources[]` (`kind`: `kb` | `databricks` | `mcp` | `api`, plus `scope`)
- `memory.runtimeProvision` at commission: `kbNamespace`, `exemplarSet`, `threadPolicy`, `retrievalScope`

**Present:** session CRUD under `/api/agent-lab/workbench/sessions`, construction schema, partial workbench UI pieces.

**Missing / incomplete:** full `/agent-lab/workbench` pages, workbench chat + commission dock end-to-end, `/api/agent-lab/construction/class` (referenced by `ClassSuggestionChip` but not shipped as a complete path). See `PHASE_LEDGER.md`.

Until that lands, treat **catalog POST** as the durable create path and **Inspector** as the only production chat surface.

---

## 7. Inspector vs domain agent chat

```text
┌─────────────────────┐     explore / discover      ┌──────────────────────┐
│  Inspector chat     │ ──────────────────────────► │  Catalog agent       │
│  class: inspector   │                             │  (definition only)   │
│  /api/inspector/chat│                             └──────────┬───────────┘
└─────────────────────┘                                        │
                                                               │ commission
                                                               ▼ (future)
                                                    ┌──────────────────────┐
                                                    │  Platform agent      │
                                                    │  agent_class=domain  │
                                                    │  dedicated chat      │
                                                    └──────────────────────┘
```

Inspector system prompt explicitly frames itself as helping users understand data **before** they build an agent in the Lab workbench (`src/lib/inspector/prompts.ts`).

---

## 8. Key source files

| Concern | Path |
|---------|------|
| Catalog create/list | `src/app/api/catalog/agents/route.ts` |
| Catalog CRUD / review / fork | `src/app/api/catalog/agents/[id]/…` |
| Docs Agents UI | `src/app/(agent)/docs/agents/` |
| `createAgent` / manifest | `src/lib/platform/agents.ts` |
| Construction / readiness | `src/lib/construction/constructionState.ts` |
| Workbench sessions | `src/app/api/agent-lab/workbench/sessions/` |
| Inspector chat | `src/app/api/inspector/chat/route.ts` |
| Memory by `agent_class` | `src/lib/memory/retrieve.ts`, [AI-AGENT-MEMORY.md](./AI-AGENT-MEMORY.md) |

---

## 9. Checklist for operators

1. Harvest the domain in **Agent Lab → Estate → Sources** so Inspector can find tables.
2. Explore in **Inspector** until the schema paths and questions are clear.
3. `POST /api/catalog/agents` with domain tags + system prompt + intended tools.
4. Review/publish via `/api/catalog/agents/[id]/review` when ready.
5. Expect **domain-bound agent chat** after workbench commission is fully available; until then use Inspector + catalog definitions.

---

## 10. FAQ

**Q: Can I select “Crew domain” and open a chat only for that agent?**  
**A:** Not as a first-class UI today. Use Inspector for chat; encode the domain in a catalog agent’s prompt/tags for governance. Platform `agent_class` / `kb_namespace` are the future binding.

**Q: Does creating a catalog agent start a chat session?**  
**A:** No. It only inserts a row in `agent_catalog`.

**Q: Is memory already domain-scoped?**  
**A:** Yes, by `agent_class`. Inspector sessions use `'inspector'`. Separate domain classes need commissioned (or otherwise classed) agents writing/reading that class.

**Q: Where do I see agents after create?**  
**A:** `/docs/agents` (and API list). Agent Staging UI today focuses on users/policies/audit; catalog browsing lives under Docs.
