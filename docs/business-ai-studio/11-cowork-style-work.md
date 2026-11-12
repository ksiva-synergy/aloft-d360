# 11 — Cowork-style work in chat, agents and Automate

**Status:** proposed, no code · **Written:** 2026-11-04 · **Decisions:** §8

## 1. The answer

ALOFT should offer what Claude Cowork offers knowledge workers:
- you hand over a multi-step job, see the plan and progress, and steer it;
- it keeps working after you close the tab;
- it delegates parts to sub-agents;
- it produces real Excel, Word and PowerPoint files;
- it can run on a schedule;
- it carries reusable skills and per-project context.

ALOFT should do this **on governed company data and Microsoft 365, with approvals and audit**, not on a person's laptop.

**Build one task runtime and use it in all three places:**
- **Chat:** a task is a conversation that plans and works.
- **Agents:** a saved agent is a packaged task worker that other tasks can call.
- **Automate:** an "Agent task" step runs a task inside a workflow.

The background worker the Automate plan already needs (M3) becomes the engine for long chat tasks as well, so there is one engine to build, not two.

**Not copied:**
- desktop local-folder access;
- computer use and a browser that imports cookies;
- "Skip all approvals".

They don't fit a governed multi-user platform (§6).

## 2. Cowork compared with ALOFT today

Cowork features are as Anthropic describes them (Sources). ALOFT facts are from the repo as of 2026-11-04.

| Cowork | ALOFT today | What to build | Chat | Agents | Automate | Phase |
|---|---|---|---|---|---|---|
| **Plans the work, shows progress, lets you steer mid-task** | Tool calls shown as a trail; Inspector up to 15 loops per message (`src/lib/inspector/max-loops.ts`, max 32); agents up to 10 (`AGENT_MAX_LOOPS`); no visible plan; no steering mid-turn | **Task mode:** a plan the model keeps up to date (`update_plan` tool), a step-by-step progress panel, Stop, and "steer" messages added between steps; a per-task budget instead of a loop count | ✅ | ✅ | ✅ (run timeline) | T1 |
| **Long tasks; keeps working when you close the laptop** | Each chat turn lives inside one HTTP stream; there's no background execution (Automate M3 not built) | Tasks run on the **durable worker** (M3, generalised), saved after every step, resumable; notify when done (in app, then Teams or email); reopen and see the result | ✅ | ✅ | ✅ | T3 |
| **Sub-agents run parts in parallel** | No delegation | A `delegate` tool: hand a sub-goal to a **saved agent** (for example the Crewing agent) or to a temporary helper, with a parallel cap, a budget slice and the caller's permissions or fewer | ✅ | ✅ | ✅ | T4 |
| **Works on your files** (local folder, folder instructions) | Chat has no attachments; knowledge bases take uploads; SharePoint read-only through app connections | **Task files:** attach uploads and pick SharePoint/OneDrive files or folders (M365 plan §4.4); a task can read and save there; **project instructions** stand in for folder instructions | ✅ | ✅ | ✅ | T2 |
| **Professional outputs:** Excel with working formulas, PowerPoint, documents | Inspector exports **CSV only** (`src/app/api/inspector/export/route.ts`); charts in chat | `create_spreadsheet` (sheets, formulas, formats, charts), `create_document` (Word), `create_presentation` (PowerPoint). The model sends a typed spec and the server builds the file. Download it, or save it to SharePoint with Confirm. | ✅ | ✅ | ✅ | T2 |
| **Edit drafts in place, shareable artifacts** | Chat charts; rich-visual tiers planned (`reports/Rich visual chat responses.md`) | Output panel listing every file a task made, each with a preview; "revise this" re-runs the generator on the spec. Shareable report pages come later with tier 4 of the visuals report. | ✅ | — | — | T2 / later |
| **Connectors** (Microsoft 365 among them) | Warehouse tools, knowledge search, capability registry and policy gateway; app-only S3, Blob and SharePoint | The M365 delegated plan (`docs/m365/delegated-access-plan.md`) gives tasks files, Excel, Lists, Teams, mail, calendar and tasks. Later, an MCP adapter behind the policy gateway for other vendors' connectors. | ✅ | ✅ | ✅ | M365 plan; MCP later |
| **Skills:** know-how loaded when relevant | Designed, not built (04 §4: L0 catalog → L1 manifest → L2 instructions; skills can't grant tools) | Build 04 §4. Org and team skills such as "Monthly opex review", "Certificate audit", "Vessel performance pack", picked by description and loaded on demand. Usable in chat, agents and Agent task steps. | ✅ | ✅ | ✅ | T5 |
| **Plugins:** skills + connectors + sub-agents in one install; private marketplace | None | **Department packs:** an admin-curated bundle of skills, agents, automation templates and required connectors (Crewing, QHSE, Finance, Technical), installed per team | ✅ | ✅ | ✅ | T7 |
| **Scheduled tasks** (`/schedule`, runs in the cloud, past runs page) | Automate has schedule triggers in its format but no runner | **Schedule this** on any chat task turns it into an automation with one Agent task step (prompt, skills, files, budget), owned by that person. A **Scheduled** page lists runs and results. | ✅ | — | ✅ | T3 |
| **Assign from anywhere** (web, desktop, mobile) | Web app only | Mobile-friendly task view; then an ALOFT bot in Teams ("@ALOFT, prepare the weekly opex pack") | ✅ | ✅ | — | T7 |
| **Projects:** files, instructions, memory per workspace | Chats, knowledge bases (personal/org), memory and teach exist; no project grouping | **Projects:** a workspace with its own instructions, linked knowledge bases, SharePoint folders, skills, members and **project-scoped memory**; chats and tasks live in it | ✅ | ✅ | ✅ | T5 |
| **Memory shared with chat; can be turned off per task** | Memory (`src/lib/memory/*`), teach, personal lane | Per-task **Memory off**; project memory kept separate from personal memory; file content from Microsoft 365 never written to memory (M365 plan §6) | ✅ | ✅ | — | T5 |
| **Approval modes** (Manual / Auto / Skip); per-tool Always allow / Needs approval / Blocked; delete needs explicit permission | Policy gateway; M365 plan adds Confirm cards; Automate approval steps | **Two modes**, Manual and Auto (reads run; writes need Confirm unless the person set that tool to Always allow and the org allows it). Per-tool settings per person under an org ceiling. **No Skip.** Delete is never auto-approved. | ✅ | ✅ | ✅ (approval steps) | T6 |
| **Admin:** on/off, role and team access, spend limits, tool permissions by department, analytics, OpenTelemetry/SIEM | RBAC, interactive budgets (`src/lib/spend/budgets.ts`), audit (`src/lib/audit.ts`), LLM Lite model settings | Team-level tool policy (which tools and connectors, which approval mode), task analytics (runs, cost, success, time saved), OpenTelemetry export of audit and run events | — | — | — | T6 |

## 3. Architecture: one task runtime

```
   Chat (task mode)        Saved agent run           Automate "Agent task" step
          │                       │                           │
          └──────────────┬────────┴───────────────┬───────────┘
                         ▼                        │
                 Task runtime (src/lib/tasks/)    │  same code, three callers
                 ├─ planner loop (existing agent loop + update_plan)
                 ├─ context: goal, project instructions, skills (L0→L2), files, memory scope
                 ├─ tool gateway: approval mode + per-tool policy + Confirm cards
                 ├─ delegate(): sub-tasks, parallel cap, budget slices, permissions ⊆ caller
                 ├─ budget meter (cost, time, steps) instead of loop counts
                 └─ checkpoint after every tool call
                         │
                         ▼
                 Durable worker (Automate M3, generalised)
                 lease + heartbeat · resume after crash · cancel · notify on done
                         │
     Tools: warehouse (describe_schema, execute_tool) · knowledge search · Microsoft 365
            (files, Excel, Lists, Teams, mail…) · documents (xlsx, docx, pptx) ·
            connectors (capability registry) · saved agents (as sub-agents)
```

Key points:
- **Reuse, don't fork.**
  - The planner loop is the existing agent loop (`src/lib/inspector/agent-loop.ts`, `src/lib/agents/run-catalog-agent.ts`) plus an `update_plan` tool and checkpointing.
  - The worker is the one ADR-003 already chose for Automate (Postgres lease, `RunStore`).
  - A chat task is stored as a run of a one-step flow whose step is an "agent task". That gives Automate's run history, cancellation and audit for free.
- **Short and long behave the same.** A quick question still runs inline in the chat stream. Once a task passes about 60 seconds, or the person clicks **Run in background**, the worker takes it over from the last checkpoint and the chat shows live progress from the run record.
- **Budgets replace loop caps.** Each task gets a cost and time budget (defaults by role, editable up to the team limit). Reaching it pauses the task and asks the person to continue or stop. It never fails silently.
- **Saved agents become building blocks.** Agent versioning has to come first (`reports/Agent builder harness gaps.md`): a task that delegates to "Crewing agent" must call a fixed, approved version.

## 4. What each surface gets

### Chat (Inspector and agent chat)
- A **Task** switch, or automatic when the request has several parts: *"Prepare the Q3 opex pack: pull actuals, compare with Budget 2026.xlsx, chart the gaps by vessel, write a two-page summary in Word, and save both to Finance/Reports."*
- A **plan panel** with ticked steps, current step, cost so far and Stop. Typing while it runs **steers** it: the message is added before the next step.
- An **outputs panel** with files made (xlsx, docx, pptx, CSV), each with a preview, Download, and Save to SharePoint (Confirm).
- **Run in background**, a notification when done, and a task list in the sidebar.
- **Schedule this** and **Save as automation**.

### Agents
- An agent = instructions + skills + allowed tools + knowledge bases + approval policy + budget, **versioned**.
- Agents can be **sub-agents**: chat tasks and other agents call them with `delegate`, and the result comes back as a structured answer (`submit_answer` already exists).
- The agent page shows task runs of that agent and their outcomes, for review and evaluation (feeds the gaps report's evaluation plan).

### Automate
- A new **Agent task** step: a goal, skills, files, allowed tools, budget, and an output schema. It runs the task runtime inside a deterministic workflow. Use it where the work can't be drawn as fixed steps: "read this week's supplier emails and pull out delivery changes".
- Chat to automation: **Schedule this** creates the automation; Copilot can then turn repeated parts into fixed steps.
- Run history shows each Agent task's plan, tool calls, files and cost, using the same timeline as chat tasks.

## 5. Phases

Sizes for one engineer who knows the repo: M = 2–5 days, L = 1–2 weeks.

| Phase | Scope | Acceptance (falsifiable) | Needs | Size |
|---|---|---|---|---|
| **T0 Prerequisites** | Automate M3 worker built as a **general** run engine; agent versioning release-path fixes; M365 plan phases 1–2 | M3's five acceptance tests (05 §6); a published agent can't change without a new version | — | (already planned) |
| **T1 Task mode in chat** | `update_plan` tool; plan and progress panel; Stop; steer between steps; per-task budget replacing loop caps; the same loop in agent chat | A 6-step task shows its plan and ticks each step; a steer message changes the next step; reaching the budget pauses and asks; Stop ends within one step | — | M |
| **T2 Files in, documents out** | Chat attachments and SharePoint picker; `create_spreadsheet` (formulas, formats, charts), `create_document`, `create_presentation`; outputs panel; save to SharePoint with Confirm | The generated xlsx opens in Excel with live formulas (a test recalculates them); docx and pptx open in Word and PowerPoint; files over limits are refused clearly | M365 phase 3 for saving | L |
| **T3 Background and scheduled** | Tasks hand over to the worker; resume after a restart; notifications; task list; **Schedule this** → automation with an Agent task step; Scheduled page with past runs | Kill the server mid-task: it resumes from the last step without repeating writes; a scheduled task runs with nobody signed in, as the owner (M365 plan §5.3 rules) | T0 (M3) | L |
| **T4 Sub-agents** | `delegate` to saved agents and temporary helpers; parallel cap; budget slices; permissions equal or narrower than the caller's | Three sub-tasks run in parallel and finish in less than the sum of their times; a sub-agent can't use a tool its caller couldn't; one failing sub-task is reported, not hidden | T1, agent versioning | M |
| **T5 Skills, projects, memory scope** | Skills per 04 §4 (org and team libraries, L0→L2 loading, validator); Projects (instructions, knowledge bases, folders, skills, members, project memory); per-task Memory off | A task in project "Q3 close" uses its instructions and folder without being told; a skill loads only when relevant (logged); Memory off writes nothing to memory | T1 | L |
| **T6 Approval modes and admin** | Manual/Auto modes; per-tool Always allow / Needs approval / Blocked under an org ceiling; team tool policy; task analytics; OpenTelemetry export | With Auto, reads run and writes still show Confirm unless allowed; an admin ceiling overrides a person's setting; no path auto-approves delete | M365 phase 3 | M |
| **T7 Department packs and Teams** | Packs (skills + agents + templates + connector needs), private catalog, install per team; Teams bot to start and follow tasks | Installing the Crewing pack gives that team its agents and skills and nobody else; a task started in Teams appears in the ALOFT task list | T5 | L |

**Order and effort.** T1 can start now. T2 needs only the M365 save step for its last part. T3 waits for M3. After the prerequisites, T1–T6 is about **10–12 weeks for one engineer**, or about 6–7 weeks for two working on the T1→T3 and T2→T5 tracks in parallel. These are estimates, not commitments.

## 6. Deliberately not copied

| Cowork feature | Why not in ALOFT | ALOFT alternative |
|---|---|---|
| Local folder access on the desktop | ALOFT is a server app shared by many people; local disks are outside its governance | Uploads plus SharePoint/OneDrive through the person's own permissions |
| Computer use; built-in browser with imported cookies | Acts with full, unaudited user power on arbitrary sites; hard to constrain or review | Typed connectors through the policy gateway; optional web search and fetch with a domain allowlist (decision C5) |
| "Skip all approvals" | Removes the control that makes unattended work safe in a company setting | Manual and Auto only; per-tool Always allow under an org ceiling |
| Running arbitrary code in a sandbox for every task | A new attack surface and infrastructure; most needs are covered by typed tools | Typed generators (xlsx/docx/pptx) and warehouse SQL; a code sandbox only if a pilot shows a real gap (C2) |

## 7. Risks

| Risk | Mitigation |
|---|---|
| Long tasks run up cost | Per-task and per-team budgets; pause-and-ask at the limit; cost shown live |
| Unattended tasks do the wrong thing | Writes go through Confirm (interactive) or approval steps (scheduled); plans and tool calls are recorded; versioned agents only |
| Prompt injection through files and mail | Fenced untrusted content (M365 plan §3); no auto-approved external writes; injection tests per phase |
| Scope creep into a general desktop agent | Section 6 list; new tools only for a named pilot need |
| Two run engines drift apart | One worker and one run store for Automate runs and chat tasks (decision C1) |

## 8. Decisions needed

| ID | Decision | Recommendation |
|---|---|---|
| C1 | One durable worker for Automate runs and chat tasks? | Yes. Build M3 as the general engine |
| C2 | How documents are generated | Typed server-side generators (Node libraries for xlsx, docx and pptx, all MIT-licensed, to be confirmed at build time); no code sandbox at first |
| C3 | Approval modes offered | Manual and Auto. No Skip. Admins can force Manual per team |
| C4 | Who writes skills and packs | Team admins and platform admins; the skill validator and review before publishing (04 §4) |
| C5 | Web research in tasks? | Optional web search and fetch with an org domain allowlist, off by default |
| C6 | Model for long tasks | The default LLM Lite model, with a budget per task; a cheaper model for sub-agents where evaluations allow |
| C7 | Pilot | One team (Finance for document packs, or Crewing for certificate tasks) for T1–T3 |

## 9. First demo (end of T2)

In chat, with Task mode on:

> "Prepare the Q3 opex pack: pull actuals by vessel, compare them with Budget 2026.xlsx in Finance, chart the five biggest gaps, write a two-page summary in Word, and save both to Finance/Reports."

Expected result:
- A visible six-step plan.
- Warehouse queries, then the Excel budget read through Microsoft 365.
- An **xlsx with working formulas** and a chart, and a **docx** summary.
- One Confirm card to save both files.
- The outputs panel links to the saved files.

## Sources

- [Claude Cowork product page](https://claude.com/product/cowork)
- [Get started with Claude Cowork](https://support.claude.com/en/articles/13345190-getting-started-with-cowork)
- [Use Claude Cowork safely](https://support.claude.com/en/articles/13364135-using-cowork-safely)
