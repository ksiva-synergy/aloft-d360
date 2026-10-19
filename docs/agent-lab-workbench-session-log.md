# Agent Lab Workbench — session log (fixes & enhancements)

Chronological record of work from the workbench rebuild / commissioning / catalog / staging debugging session.  
**Date:** 2026-03-17 (local).

---

## 1. Product context (what we clarified)

| Topic | Finding |
|--------|---------|
| **Inspector vs Workbench** | Inspector (`/inspector`) = data/analytics chat. Workbench (`/agent-lab/workbench`) = design + **commission** catalog/platform agents. Shared `PromptCanvas` UI; Inspector sets `canCommission={false}`. |
| **Empty-state templates (FEYNMAN/FERMI/GROSSMANN)** | Defined in `PromptCanvas` mission starters; misleading on Inspector empty state (agent mission copy on analytics surface). |
| **Agent classes** | Taxonomy for memory/platform: `feynman` (audit/compliance), `fermi` (forecasting), `grossmann` (pipelines), etc. |
| **Catalog vs runtime chat** | Commission creates `agent_catalog` + `platform_agents` entry. **No dedicated “chat as catalog agent X”** yet — Inspector is the supported runtime for data missions (`docs/creating-agents.md`). |

---

## 2. Workbench MVP (built / restored)

### Routes

- `src/app/(agent)/agent-lab/workbench/page.tsx`
- `src/app/(agent)/agent-lab/workbench/[sessionId]/page.tsx`

### UI & hooks

- `WorkbenchShell.tsx` — chat + `ConfigPanel`, COMMISSION, history
- `ConfigPanel.tsx` — AGENT DRAFT panel (readiness, name, class, instructions, datasources)
- `useWorkbenchChat.ts` — sessions (`surface: 'workbench'`), SSE chat, commission flow

### APIs

- `POST /api/agent-lab/workbench/chat` — builder LLM + construction tools
- `POST /api/agent-lab/workbench/commission` — catalog + platform agent
- `GET /api/agent-lab/workbench/tools`
- `POST /api/agent-lab/construction/class`
- Workbench sessions CRUD (`surface` on create; auth required for POST)

### Construction libs

- `src/lib/construction/prompts.ts`, `apply-patch.ts`, `readiness.ts`, `builder-tools.ts`
- `src/lib/construction/empty-draft.ts` — client placeholder draft

### Nav

- `nav-config.ts` — **Workbench** → `/agent-lab/workbench`

---

## 3. Bugs fixed

### 3.1 First message “did nothing”

- **Cause:** `router.replace` on new session remounted the page and killed the stream.
- **Fix:** `window.history.replaceState` for URL update; template `onSendMessage`; error banner in shell.

### 3.2 SSE `errored` / Grok / 0 tokens

- **Cause:** Workbench chat used Bedrock `runAgentLoop` for xAI model keys.
- **Fix:** `dispatchAgentLoop` for Foundry/xAI (same pattern as Inspector); Grok fallback when Bedrock fails.

### 3.3 HTTP 500 on workbench chat (ZodError)

- **Cause:** `construction_state.tools.actions[]` missing `toolId` / `tier` after LLM patches; strict `constructionStateSchema.parse()` threw.
- **Fix:**
  - `src/lib/construction/load-state.ts` — `sanitizeRawConstructionState`, `loadConstructionState`, `coerceConstructionState`
  - Chat route uses `loadConstructionState` / `coerceConstructionState` instead of raw parse
  - `builder-tools.ts` coerces after patches

### 3.4 COMMISSION disabled while assistant says “press COMMISSION”

- **Cause:** Button gated on `canCommissionAgent(constructionState)` but client `constructionState` often stayed `null` (patches ignored when `prev === null`; no end-of-stream sync; session create didn’t hydrate draft).
- **Fix (`useWorkbenchChat.ts`):**
  - Seed state from session POST `construction_state`
  - Apply patches with `applyConstructionPatch` + `deriveReadiness` even without prior state
  - Handle SSE `construction_state` event
  - `syncSessionConstruction` on stream `done`
  - Hydrate when `currentSessionId` set but URL prop `sessionId` still null (`replaceState` flow)
- **Fix (`chat/route.ts`):** emit `construction_state` before `done`
- **UX:** COMMISSION tooltip explains required draft fields

### 3.5 Right panel “Agent draft will appear here” forever

- **Cause:** Same as 3.4 — `ConfigPanel` only renders when `state !== null`.
- **Fix:**
  - `WorkbenchShell` uses `emptyConstructionDraft()` when session exists
  - Clearer placeholder copy before first session
  - Session GET always returns parsed state via `loadConstructionState`

### 3.6 Session GET `construction_state parse failed` (terminal Zod)

- **Cause:** Strict parse on GET; stale `.next` when running `npm run start` without rebuild.
- **Fix:**
  - `GET workbench/sessions/[id]` uses `loadConstructionState` + `getDefaultOrg`
  - `constructionStateNeedsRepair` — write sanitized state back to DB on read
  - PATCH `construction_state` uses `loadConstructionState` (no 400 on bad actions)

### 3.7 `npm run build` commission type error

- **Fix:** `createAgent` optional fields `?? undefined` in `commission/route.ts`

---

## 4. Catalog & docs enhancements

### 4.1 “View in catalog” error after commission

| Issue | Fix |
|--------|-----|
| Detail page loaded only first 50 agents | `GET /api/catalog/agents?slug=` returns `{ item }` |
| `AgentDocPage` `JSON.parse` on Json fields | `schemaFieldToObject()` for `input_schema` / `output_schema` |
| Tools array typing | `catalogToolsList()` |

**Files:** `api/catalog/agents/route.ts`, `docs/agents/[slug]/page.tsx`, `components/docs/AgentDocPage.tsx`

### 4.2 “Try in Agent Staging” failed (404)

| Issue | Fix |
|--------|-----|
| Link pointed to `/agent-staging` (no `page.tsx`) | Added `agent-staging/page.tsx` → redirect `/docs/agents` |
| No staging try flow | `agent-staging/try/page.tsx` — load agent by slug, show mission, **Open in Inspector** |
| Misleading link label | Agent doc: **Try in Inspector (staging)** → `/agent-staging/try?agent=<slug>` |
| Tool doc dead link | Tool doc → `/inspector` |

**Note:** `sessionStorage` key `aloft.catalogAgent.slug` reserved for future Inspector pre-fill.

---

## 5. Readiness & commission rules (reference)

`canCommissionAgent` (`readiness.ts`) requires derived readiness `validate` or `commission`:

- `name` set
- `class.id` set
- `prompt.instructions` length ≥ 40

Chat prose alone does **not** enable COMMISSION — fields must be in `construction_state` (builder tools).

---

## 6. Ops / dev notes

- After API/UI changes: **`npm run build`** before **`npm run start`** (or use **`npm run dev`**).
- Project uses `output: standalone` — production may use `node .next/standalone/server.js`.
- Corrupt sessions: one GET with repair can strip bad `tools.actions` and persist clean state.

---

## 7. Known gaps / follow-ups (not done)

| Item | Status |
|------|--------|
| Dedicated runtime chat bound to catalog agent | Not implemented |
| Inspector pre-fill from `aloft.catalogAgent.slug` | Storage only; Inspector doesn’t read it yet |
| Inspector empty state still shows workbench mission copy | UX mismatch |
| Repeated/garbled user messages in workbench chat | Reported; not root-caused in this session |
| Commission route still uses strict `safeParse` on DB row | OK if DB repaired; could align with `loadConstructionState` |
| Reload workbench session: restore `commissionResult` from `saved_agent_id` | Not implemented |

---

## 8. File touch list (summary)

```
src/app/(agent)/agent-lab/workbench/*
src/app/api/agent-lab/workbench/*
src/app/api/agent-lab/construction/class/route.ts
src/app/(agent)/agent-staging/page.tsx
src/app/(agent)/agent-staging/try/page.tsx
src/app/api/catalog/agents/route.ts
src/app/(agent)/docs/agents/[slug]/page.tsx
src/components/workbench/*
src/components/docs/AgentDocPage.tsx
src/components/docs/ToolDocPage.tsx
src/hooks/useWorkbenchChat.ts
src/lib/construction/*
src/lib/breadcrumb-config.ts
src/components/agent-lab/staging/nav-config.ts
docs/agent-lab-workbench-session-log.md (this file)
```

---

## 9. Verification checklist

- [ ] New workbench session: chat streams; draft panel fills after tools / `done`
- [ ] COMMISSION enables when Config panel shows name + class + instructions
- [ ] Commission succeeds; catalog link opens `/docs/agents/<slug>`
- [ ] Try link opens `/agent-staging/try?agent=...` → Open in Inspector
- [ ] Session `043fc92d-...` (or any with bad actions): GET no Zod error after rebuild + refresh
