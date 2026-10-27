# 09 — UX and information architecture

**Rule:** every screen is backed by a working API. No decorative screens. Expert detail is progressive: plain language first, JSON and contracts one click away.

## 1. Information architecture

| Area | Route | Status | Backed by |
|---|---|---|---|
| Flows (preview): goal → template → check & simulate | `/agent-lab/flows` | **Implemented**. Behind `FLOWS_ENABLED`; no nav entry yet | `GET /flows/catalog`, `POST /flows/simulate` |
| Solution Composer (chat planner beside the definition) | `/agent-lab/flows/new` | Proposed M2b | Workbench chat `mode: 'flow'` |
| Flow list / detail / versions | `/agent-lab/flows/:id` | Proposed M1b | Registry API |
| Workflow canvas (xyflow + dagre) over the same definition | tab on flow detail | Proposed (after MVP) | Same definition. The canvas is a view, not a second source of truth |
| Runs and timeline | `/agent-lab/flows/:id/runs`, `/runs/:runId` | Proposed M3 | Run API |
| Approvals inbox | `/agent-lab/approvals` | Proposed M3 | Approvals API |
| Connections | `/agent-lab/connections` | Proposed M5 | Connection registry |
| Skills library | `/agent-lab/skills` | Proposed M4 | Skill registry |
| Agents (existing) | `/agent-lab/agents`, Workbench | Exists | Catalog / commission |
| Governance (permissions, egress, budgets) | admin settings | Proposed M5/M6 | RBAC + policy settings |

**Navigation:** add "Flows" under the Agents area once the catalog response can tell the client the feature is enabled. That avoids a nav item that leads to a disabled page in production. Next task N5 in 10.

## 2. Primary journey (implemented part in bold)

1. **"What would you like to accomplish?"** The user types a goal and presses Find.
2. **The best-matching template is selected** (rules, with the matched words shown). If nothing matches, the page says so plainly and suggests editing the closest template.
3. **Definition and sample inputs appear** (editable JSON, monospace), along with the list of what must be bound before publishing.
4. **Check & simulate** (with an optional *failure drill*: a step fails once or every attempt).
5. **Results**, in this order:
   - **Verdict banner:** passes everything / N issues block publishing / the simulated run failed, plus why publishing isn't available yet.
   - **What it will do:** trigger in words, next scheduled runs, numbered steps with chips (AI, Human approval, Leaves the platform, Writes, condition).
   - **Access it needs:** permissions, connections, approvers, allowed email domains.
   - **Cost per run (estimate):** expected, worst case with all retries, budget, and the pricing assumption.
   - **Checks:** errors ("Blocks publish") and warnings, with step names.
   - **Simulated run:** per step: status, attempts, mocked or real, "Would: …" side effect, skip reason, error, and expandable input and output.
   - **Limitations**, plus the simulation notice ("No system was contacted…").
6. Publish, then run, then monitor (M1b/M3).

## 3. Designed states

| State | Copy / behaviour | Status |
|---|---|---|
| Feature off | "Flows is not switched on here" + how an admin enables it | Implemented, tested |
| Loading catalog | Skeleton cards | Implemented |
| No template match | Abstains, says so, and points to the closest template | Implemented, tested |
| Invalid JSON (client) | Inline error with the parser message | Implemented |
| Invalid definition (server 422) | List of path + message | Implemented, tested |
| Missing permission | "Blocks publish: publishing needs permission …" | Implemented, tested |
| Missing approval / data-bound control | "Blocks publish" with step name | Implemented |
| Simulation failed (drill, egress, budget) | Red step, error text, downstream "Skipped: step … failed" | Implemented, tested |
| Low-confidence design (planner) | Planner shows assumptions and asks before applying | Proposed M2b |
| Waiting approval / partial failure / budget exhausted / revoked credential / migration needed | Run-timeline states | Proposed M3/M5 |
| No connections | Bindings list shows what to connect. Connect CTA in M5 | Partial |

## 4. Visual language, theme and accessibility

- Uses the shell tokens only (`--ink-1/2/3`, `--surface-1/2`, `--line-1`, `--brand-a*`, `--ok/--warn/--bad` with `-bg`). These have light and dark values in `src/app/globals.css`, so the page follows the active theme with no extra code. Type tokens only (`text-size-*`). It passes the typography guard (`src/lib/typography/__tests__/typography-guard.test.ts`).
- Layout follows the Agents page: `max-w-7xl`, cards with `rounded-2xl`, chips with `rounded-full`. Note that `docs/DESIGN_SYSTEM.md` says radius ≤ 6px while the current shell pages use `rounded-2xl`. The newer pages were followed. **Decision needed (D6):** which radius rule wins.
- Accessibility: labelled inputs (`What would you like to accomplish?`, `Flow definition JSON`, `Failure drill`); `aria-pressed` on template cards; `aria-live="polite"` on the results region; native `<details>` for JSON; status icons have `aria-label`s. Not yet done: an automated axe check, keyboard tests of the full journey, and screen-reader review (M6).
- Internationalisation readiness: strings are inline English. Extracting them is M6 scope. Dates use `toLocaleString`.

## 5. Interaction contracts

- The server is the source of truth for validity, policy and cost. The client parses JSON only to send it.
- Conversational edits (M2b) and direct edits (JSON now, canvas later) both modify the **same definition**. The planner's tools must respect user locks: a field the user edited is not overwritten by the AI, the same idea as `userLockFor` in the Workbench.
- Undo/redo and diffs: versions are immutable (M1b), so undo within a draft is client-side, and a diff compares two version ids.
