# Implementation status — Business AI Studio

**Updated:** 2026-10-28 · **Feature flag:** `FLOWS_ENABLED` removed — Automate always enabled at API layer (auth + `inspector:use`).

## What runs today

A signed-in user with `inspector:use` can open **`/agent-lab/flows`**, describe a goal or pick a template from five unrelated domains, and build the workflow in a three-pane builder: a canvas of the steps, a side panel with **Settings/Step** and **Copilot** tabs, and a **Test run** drawer. They can edit through the form or by chatting with Copilot, which proposes checked changes that apply only when accepted. They can save, reopen, version and publish workflows they own (platform admins can manage all). A test run shows:

- what the flow does,
- which access, approvals and connections it needs,
- where AI is used and what it should cost,
- which checks would block publishing,
- a step-by-step simulated run with mocked side effects and optional failure drills.

Simulation reads no real data and contacts no external system. Saved workflows are stored in the dev database. Published ones can be run through `POST /api/agent-lab/flows/[id]/runs` (steps saved per run; agent, knowledge search, transform, save and approval steps only; a paused approval is approved or rejected from the Runs panel or `POST .../runs/[runId]/approval`; use **Runs** in the builder header for Run now and run history; needs migration `20261107_flow_run_idempotency` applied).

## Implemented (with tests)

| Area | Files | Tests |
|---|---|---|
| Flow IR extensions: `tool` step, `when` conditions with skip propagation, semantic `query` mode (mirrors `SemanticQuery`), `anti_join`, `webhook` trigger, run `budget` | `src/lib/flows/schema.ts`, `validate.ts`, `runner.ts` | `src/lib/flows/__tests__/flows.test.ts` (18, unchanged and passing), `studio.test.ts` |
| Single-pass ref substitution (fixes re-expansion of `{{…}}` and `$&` in data) | `src/lib/flows/resolve.ts` | `studio.test.ts` › inserts data verbatim |
| Non-retryable errors (policy and budget denials stop at once) | `src/lib/flows/runner.ts` | attempt-count assertions |
| Capability contracts, registry and 5 built-ins (REST, email, team notify, S3 list, OCR) | `src/lib/capabilities/types.ts`, `builtin.ts`, `registry.ts` | `studio.test.ts`, `routes.test.ts` |
| Policy gateway: input contract, email egress allowlist, SSRF-safe paths, budget meter, live permission re-check, no live call without a handler, idempotency key | `src/lib/capabilities/gateway.ts` | `studio.test.ts` › runtime gateway |
| Static policy: approvals, literal bindings, unknown/missing fields, permissions, raw SQL, budget | `src/lib/flows/policy.ts` | `studio.test.ts` › static policy gate |
| Explanation (kind, trigger, next runs, steps, access, approvals, cost, limits) | `src/lib/flows/explain.ts` | `studio.test.ts` |
| Simulation (real runner and transforms; mocked I/O; fixtures; failure drills) | `src/lib/flows/simulate.ts`, `memory-store.ts`, `transforms.ts` | `studio.test.ts` |
| Goal → template matching (rules, abstains) | `src/lib/flows/recommend.ts` | `studio.test.ts` › recommendTemplates |
| Five domain templates (procurement, finance, HR, maritime, custom API) | `src/lib/flows/templates.ts` | `studio.test.ts` › one pipeline, five business domains |
| One-call analysis facade | `src/lib/flows/analyze.ts` | all of the above |
| Module boundary (no framework, DB or Inspector imports in the core) | — | `src/lib/flows/__tests__/boundary.test.ts` |
| API: `GET /api/agent-lab/flows/catalog[?goal=]`, `POST /api/agent-lab/flows/simulate` (always-enforced auth, flag, 422/413/400) | `src/app/api/agent-lab/flows/{_shared.ts,catalog/route.ts,simulate/route.ts}` | `src/app/api/agent-lab/flows/__tests__/routes.test.ts` |
| Persistence: save, reopen, immutable versions with conflict detection, publish gate (server re-checks policy and re-simulates), unpublish, delete. Creator-owned, platform admins see all | `src/lib/flows-store/service.ts`, `src/app/api/agent-lab/flows/{route.ts,[id]/**}` | `src/lib/flows-store/__tests__/service.test.ts`, `src/app/api/agent-lab/flows/__tests__/crud.routes.test.ts` |
| Copilot (chat editing): typed edit operations applied all-or-nothing to a copy of the draft, diffed, validated and policy-checked for the user; one repair round; findings the change introduces reported separately. The model can only propose (one forced tool); nothing is saved or run | `src/lib/flows/copilot.ts`, `src/lib/flows-copilot/propose.ts`, `src/app/api/agent-lab/flows/copilot/route.ts` | `src/lib/flows/__tests__/copilot.test.ts`, `src/app/api/agent-lab/flows/__tests__/copilot.routes.test.ts` |
| Shared edit operations (form and Copilot use the same code) | `src/lib/flows/edit.ts` (re-exported by `src/views/agent-lab/flows/editor-model.ts`) | `editor-model.test.ts` |
| UI: builder. Home (goal, My workflows, templates), canvas (auto layout, dependency edges, add-step, findings and test results on steps, proposal highlights), Settings/Step panel, Copilot panel, Test run drawer (typed inputs, per-step sample responses, failure drill, Run/Checks/Summary), code view, save/publish header, light and dark | `src/views/agent-lab/flows/{index,FlowCanvas,FlowForm,CopilotPanel,TestRunPanel,ui}.tsx`, route in `web/src/router.tsx` | `src/views/agent-lab/flows/__tests__/FlowsPreviewPage.test.tsx` (13), `editor-model.test.ts` |

## Evidence (27 Oct 2026, builder and Copilot)

- `npx vitest run`: **91 files / 712 tests pass**. Both typechecks exit 0; ESLint clean on the Studio folders; bundle clean. Mutation checks: applying a Copilot proposal before Apply fails the page test; dropping the policy check on proposals fails the route test.
- Copilot: unit and route tests mock the model. Three live Grok 4.7 calls (edit a template, build from scratch, answer a question) produced valid results after two prompt and parsing fixes. There is no golden set yet.

## Evidence (26 Oct 2026)

- `npx vitest run`: **85 files / 667 tests pass** (baseline 80 / 617), including `src/app/api/__tests__/authz-hardening.test.ts` (S1–S4, 12 tests).
- `npx tsc --noEmit` and `npx tsc -p web/tsconfig.json --noEmit`: exit 0.
- `npm run web:build`: succeeds. The Flows chunk has no server markers.
- `npm run web:check-bundle`: **passes** ("bundle clean") since the server-only role lookup moved to `src/lib/inspector/session-role.ts`.
- ESLint: the config loads again, and touched files are clean. The repo-wide run reports **147 pre-existing problems (141 errors) in 84 files**, mostly the new `react-hooks` v7 rules, so lint is not in the CI gate yet.
- Mutation checks: disabling egress fails 2 tests; reverting the resolver fix fails 1 test; dropping condition-value ref validation fails 1 test.
- Core latency: 0.24–1.26 ms p50 per template (08 §1).

## Proposed (no code yet)

ALOFT semantic port and live `query`/`retrieve` executors (M2b) · Copilot golden set and live-model evaluation (M2b) · worker, schedules, webhooks, approvals, run history (M3) · `ModelGateway` and the `agent` executor, skills, Goal & Progress memory (M4) · connections, secrets, live connector handlers, pilots (M5) · hardening and controlled learning (M6).

## Open blockers

| Blocker | Blocks | Owner action |
|---|---|---|
| S1–S4 fixed in code and tested; not yet reviewed or deployed. New users get `member` | M1b publish, M3 runs | Review the behaviour changes (CHANGELOG 2026-10-26), confirm Entra group assignment, merge and deploy |
| Studio permissions not seeded | Publishing any flow with sends or writes | D2 |
| Flow migration is applied on **dev** only (2026-10-27). Staging and production are not done | Deploying saves to other environments | Apply per environment when approved |
| CI `verify` gate added but not yet run on GitHub; 147 lint problems outstanding | Trustworthy releases | Push the branch to see `verify` run. Burn down lint, then add `npm run lint` to `verify` |

## Next runnable tasks

N1 → N5 in [10-delivery-plan.md §3](10-delivery-plan.md#3-next-five-tasks-in-order).

## How to try it locally

1. Ensure `DEFAULT_ORG_ID` is set (or org resolves from session). Optionally set `FLOWS_EGRESS_EMAIL_DOMAINS=example.com`.
2. `npm run dev`, sign in, open **Automate** in the Build navigation (`http://localhost:3000/agent-lab/automate`; the old `/agent-lab/flows` link redirects). The feature is called Automate in the UI; code and APIs still say `flows`. File storage connections (S3, Azure Blob, SharePoint) are self-service at **Govern → Connections** (`/agent-staging/connections`): private to you unless you share them with the organisation, and picked per step in Automate. They need the `20261027_connections` migration applied first. An Ask AI or connector step can **repeat for each item** of a list (`forEach`). An "Extract document fields" step reads seafarer certificates, medical certificates or **your own list of fields** with Grok 4.7. List the fields in the panel ("My own fields…"), or tell Copilot what to read or paste a sample, and it builds them. Use **Try on a file** in the step panel to check the result (needs `XAI_API_KEY`). An "Ask AI" step can use a **saved agent** (picked from the agent catalog) and ask for its answer as specific fields; **Try it** runs the agent once for real. Only catalog agents with instructions can run, and publishing needs a live, staging or preview one.
3. Type a goal, for example "chase overdue purchase orders", and press **Start building**. Click steps to edit them, press **Test**, and try a failure drill in the Test run drawer.
4. Copilot uses Grok 4.7 when `XAI_API_KEY` is set (`XAI_MODEL` picks the variant); otherwise the Workbench's model. `FLOWS_COPILOT_MODEL_ID` forces a Bedrock model id.
