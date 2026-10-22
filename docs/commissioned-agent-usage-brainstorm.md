# Using a commissioned agent — current state and brainstorm

Status: **open for brainstorming**. Findings are from reading the code on 2026-10-20; nothing was run in the UI.

## Question

After an agent is commissioned in the Workbench, how is it used? If a user types
"Latest SIRE observations for IMO N", can the right agent be picked automatically?

## What COMMISSION does today

`src/app/api/agent-lab/workbench/commission/route.ts` creates:

1. `agent_catalog` row — `status: 'draft'`, `config` holds `systemPrompt`, `persona`, `agent_class`,
   `datasources`, `output`, `validation`, `provenance`, and the source session ids. `tools` holds the tool ids.
2. A platform agent via `createAgent` (slug `<slug>-runtime`) with KB namespace, thread policy and retrieval scope.
3. Links the Workbench session (`saved_agent_id`, `readiness = 'commission'`).

Response: `catalogUrl` (`/docs/agents/<slug>`) and `platformAgentId`.

## How it is used in the UI today

| Step | Where | Notes |
|------|-------|-------|
| Commission | Workbench Config panel (`ConfigPanel.tsx`) | Shows "Agent commissioned — saved as a draft". |
| View | `/docs/agents/<slug>` | Prompt, class, datasources, tools. |
| Try | `/agent-staging/try?agent=<slug>` (`views/agent-staging/try.tsx`) | Staging page, shows the mission text. |
| Run | "Open in Inspector" → `/inspector` | Plain Inspector chat. |
| Test | Workbench "Test run" | The only place the agent's own behaviour actually runs. |

## Gaps found

1. **No auto-selection.** Nothing matches a user question to a catalog agent. A search of `src` found no routing code.
2. **The Inspector hint is write-only.** `try.tsx` stores the slug in `sessionStorage` under
   `aloft.catalogAgent.slug`. No other file reads it. Inspector therefore does not load the agent's
   prompt, datasources or tools.
3. **No dedicated runtime chat.** The try page itself says it is "not wired yet".
4. **No publish step.** Status stays `draft`. Types allow `draft → in_review → published → deprecated`
   (`src/types/catalog.ts`), but no UI or route promotes it.
5. **Platform runtime agent is created but not used by any chat surface** (not traced in depth; confirm).

## Options to brainstorm

### A. Explicit pick (minimum)
- Inspector reads `aloft.catalogAgent.slug`, fetches `/api/catalog/agents?slug=…`, and applies `systemPrompt`,
  datasources and tools for the session.
- Show an "Agent: <name>" chip with a clear/exit control.
- Also add an agent picker in Inspector so no Try-page hop is needed.

### B. Automatic routing
- Embed each published agent's name, description and mission with Titan (the catalog already uses Titan v2).
- Embed the user's question, pick the top agent above a threshold (start near the existing 0.15 floor and tune),
  and fall back to plain Inspector otherwise.
- Cheaper alternative first: keyword/regex triggers per agent (e.g. "SIRE", "inspection").
- Ambiguity handling: if the top two agents are close, ask the user or show a suggestion chip instead of switching.

### C. Dedicated runtime chat
- A `/agents/<slug>/chat` surface backed by the platform runtime agent, with its own thread policy and memory.
- Largest piece of work. Needed if agents must run outside Inspector.

### D. Publish lifecycle
- Add review/publish actions that move `draft → in_review → published`.
- Only `published` agents become eligible for automatic routing (B).

### E. Agent gallery ("app store") with sharing
Requested 2026-10-20: a UI to browse every agent created so far, like a Play Store, with a share option.

Today: `/docs/agents` (`views/docs/agents.tsx`) already lists `agent_catalog` rows with text search,
a type filter and tag chips. It is a docs page, not a gallery. It has no status/owner filter, no
"my agents" view, no install/use action and no share control.

Ideas:
- Gallery cards: name, class, description, owner, status badge (draft / in review / published),
  datasources used, last test result, and a primary **Use** button (opens the agent per option A).
- Tabs: **All published**, **Mine**, **Shared with me**, **Drafts**. Filter by class, datasource and tag.
- Agent detail: prompt, tools, datasources, validation/test history, versions (the fork/diff/versions
  API routes already exist under `/api/catalog/agents/[id]/`).
- **Share** options to decide between: copy link to `/docs/agents/<slug>`; share with named users or
  teams (needs a visibility/ACL field, since none exists today); org-wide publish; fork a copy (fork route exists).
- Sharing must not widen data access: a user who gets the agent still needs permission on its Databricks
  datasources, and masked fields must stay masked.

## Open questions

- Gallery: new top-level page, or upgrade `/docs/agents`? Who sees drafts?
- Share: link only, per-user/team ACL, or org-wide? Where is visibility stored (new column on `agent_catalog` or a share table)?
- Can a recipient edit or only use / fork? Is there an audit trail of shares and uses?

- Should routing be automatic, suggested ("Use Inspection Findings Auditor?"), or explicit only?
- Who may publish an agent, and is review required?
- Should an agent's datasources and tools restrict what Inspector can query when it is active?
- One active agent per conversation, or can a conversation switch between agents?
- How is a wrong auto-pick undone, and is the pick shown to the user and logged?
- Should routing use the catalog `description`, the mission text, or a dedicated "when to use" field written at commission time?

## Suggested order

A → D → E → B → C, so routing only considers reviewed agents and starts from a working explicit path.

## Related

- Catalog/search background: `docs/incident-2026-10-18-catalog-mass-drop.md`, `docs/CHANGELOG.md`.
- Agent creation guide: `docs/creating-agents.md`.
