# Changelog — aloft-d360

Single running log of changes made in this repo, **newest first**.

## 2026-10-21 — Estate Jobs UX and launch scope fixes (ui-redesign cherry-pick)

- **`docs/estate-jobs.md`**, **`src/lib/estate/job-ui.ts`**, launch/plan/children APIs, **`ChildJobsPanel`**, Jobs list/detail UX (Focus scope, empty/orchestrating status).
- Ported from `feature/estate-jobs` (`bfaa6c8`) onto `feature/ui-redesign` (`src/views/agent-lab/estate/jobs.tsx`).
- **Verified:** not run on ui-redesign worktree yet (run `npm run typecheck` after merge).

## How to add an entry

- One `## YYYY-MM-DD — <topic>` section per piece of work (several per day is fine).
- Say **what changed, where (file paths), why**, and what is **not done / needs follow-up**.
- Be honest about verification: say what was tested (tsc, vitest, build, browser) and what wasn't.
- Append to today's section if the work continues it; otherwise add a new section at the top.
- Claude Code is reminded automatically by a Stop hook (`.claude/hooks/changelog-guard.mjs`) when
  files changed after this file was last updated. Cursor agents follow `.cursor/rules/changelog.mdc`.

Kept separate on purpose:
[ops-failure-log.md](./ops-failure-log.md) — live status of broken dependencies (not a changelog; has its own Cursor rule) ·
[agent-lab-workbench-session-log.md](./agent-lab-workbench-session-log.md) — March 2026 workbench session (archived).

---

## 2026-10-19 — Agent Lab: Inspector handoff, editable blueprint, flow strip, test run, commission fixes

Asking Inspector to "create an agent" used to produce a wall of catalog text under an input box that said
"Describe your agent mission…". Agent building now has one path: Inspector hands off to Agent Lab, where the user
describes the agent in plain words and edits a live blueprint.

1. **Placeholder + handoff.** `PromptCanvas` takes `surface` (`workbench` | `inspector`) for its empty-state and
   composer copy (Inspector now says "Ask about your data…" and hides mission templates) and a `banner` slot.
   `InspectorShell` shows `src/components/inspector/AgentHandoffCard.tsx` when the latest user message asks to build an
   agent (`detectAgentBuildIntent` in `src/lib/construction/handoff.ts`, tolerant of typos like "creat agent").
   "Open Agent Lab" calls the new `POST /api/agent-lab/workbench/handoff`, which creates a workbench session linked by
   `parent_session_id`, seeds `tools.datasources` with up to 8 table paths that Inspector's session knowledge
   confirmed (provenance `template`), and returns a first message that includes the mission plus that context.
   `WorkbenchShell` sends the seed once, after the session loads (sessionStorage, read-and-delete). Inspector's
   prompts gained a short "requests to create an agent" rule (`src/lib/inspector/prompts.ts`).
2. **Editable Config panel.** `ConfigPanel` is now an "Agent blueprint": inline-editable name, purpose, class picker,
   instructions (with a 40-char counter), data sources (search harvested tables via `/api/agent-lab/context/objects`,
   or type a full path), and tools (from `/api/agent-lab/workbench/tools`). Each field shows where it came from
   (You / AI / AI guess · n% / From Inspector). Editors live in `src/components/workbench/config/FieldEditors.tsx`.
   Edits go through the new field-level `PATCH /api/agent-lab/construction` (allowlist + zod validation in
   `src/lib/construction/user-edits.ts`), which records provenance `user` and marks a matching assumption corrected.
   **The builder now respects user-owned fields:** `update_agent_draft` / `add_datasource` return `USER_LOCKED`
   unless the model passes `source: "user"` because the user asked in chat (`builder-tools.ts`, prompt updated).
   The chat route merges edits made during a streaming turn instead of overwriting them (`mergeUserEdits`).
   Editing is disabled while the builder streams and after commission.
3. **Flow strip.** `config/FlowStrip.tsx`: Question → Data → Reasoning → Tools → Answer, derived from the draft;
   each node shows status and scrolls to its section.
4. **Test run + commissioning.** New `POST /api/agent-lab/workbench/test-run` streams one sample question through the
   draft's instructions (`buildTestRunSystemPrompt`) with only the read-only `describe_schema` + `execute_tool` tools,
   max 8 loops, and records `validation.lastTestRun` (new field on `constructionStateSchema`, defaults so old rows
   parse). UI: `config/TestRunSection.tsx` (tool steps, SQL, result preview, markdown answer; `AssistantContent` is now
   exported from `StreamingMessage.tsx`). Commission: idempotent (a second call returns the existing catalog entry),
   stores persona, output, test run, provenance and source session ids in `agent_catalog.config`, description falls
   back to the first sentence of the instructions; session GET returns `commission` so "Commissioned" survives a
   reload; the panel has its own Commission button and a "Try it" link (`/agent-staging/try`).
   Model resolution moved to `src/lib/construction/workbench-model.ts` (shared by chat + test run).

**Behaviour change:** `useWorkbenchChat` no longer autosaves `construction_state` every 2s. The server owns it, and
a stale client copy could overwrite server writes (it could undo a commission). Messages, model and tools still autosave.

**Verified:** `tsc` (root + `web/`) clean; `vitest run` 64 files / 512 tests pass, including the new
`src/lib/construction/__tests__/user-edits.test.ts` (23 tests: locks, merge, validation, intent detection, flow
nodes); `web:test` 8 files / 48 tests pass; every changed UI module compiles in the running Vite dev server; new
API routes sit behind the auth middleware (unauthenticated requests redirect to `/login`).
**Not verified:** no click-through in a signed-in browser, and no live test run against Databricks or an LLM.
ESLint could not run: the repo's ESLint config crashes on load ("Converting circular structure to JSON" in
`@eslint/eslintrc`), unrelated to these files.
**Not done:** a dedicated "chat as this agent" runtime (Try it still goes through `/agent-staging/try`); commission
does not yet require a passing test run (it's recommended in the UI); the handoff card is keyword-triggered, not
model-triggered.

---

## 2026-10-19 — Login: "Captain" companion with particle aura and a welcome-back greeting

Continues the redesign below. `DotBot` is replaced by `DotCompanion` in `src/components/login/AgentScene.tsx`
(`DotField` is unchanged), wired into `src/views/login.tsx`. The companion is named **Captain**: it
introduces itself that way and is announced to screen readers that way.

- **Welcome back (first name only)**: new `src/lib/login-greeting.ts`. After any successful sign-in (SSO or
  admin), `web/src/RequireAuth.tsx` saves just the first name (the first word of `session.user.name`, else the
  email's local part; letters only, max 20) to `localStorage` key `login-greeting`, with a timestamp. On the next
  visit in that browser, the login title reads "Welcome back, <Name>", the visor scrolls "HI <NAME>", and a
  "Not <Name>?" link forgets it. It expires after 30 days and is cleared on sign-out (`UserMenu`).
  It is greeting only: never sent to the server, never pre-fills a field, never affects auth. No new API
  (a server "last user" lookup was rejected because it would leak names to anyone).
- A JARVIS-style holographic HUD (rotating dials, radar sweep, orbit line, status readouts, success ping) and its
  "HUD on/off" toggle were built and then removed at the user's request. The companion area is a fixed 210px.
- **Light and dark themes**: the login page follows the app theme (`useIsDark()`; the app default is light), where it
  used to be dark only. `login.tsx` defines its colours as CSS variables per theme (`THEME_VARS`; `--ink` is an
  "r g b" triple used at different opacities). Light is an off-white page with dark ink, white fields and a dark
  navy Microsoft button. `DotCompanion` and `DotField` take a `theme` prop. Dark draws the effects with additive
  light; light can't add light to a white page, so it draws deeper teal and indigo normally (`PALETTE` in
  `AgentScene.tsx`: particles, trails, glints, voice ring, keystroke sparks, z's, thinking dots, sweat drop and
  sparkles), with darker background dots and a soft drop shadow under the white helmet. The visor and LED
  eyes are the same in both themes. Verified with a headless screenshot of the light theme. Dark is unchanged.
- **Speech on the visor (no text beside Captain, no audio)**: Captain talks through its LED eyes. Short messages
  scroll across both eyes in a 5×7 LED font at 17 columns/s ("HI!" on load and on waking up, "HI <NAME>" once the
  username reveals a first name). Pictograms show in both eyes for other moments: a lock while typing the password,
  "?" on an error, and a check on success. A message on the visor is never cut off (repeats are ignored until it
  ends), and the eyes return to their expression afterwards. The voice ring pulses as
  letters pass. Screen readers get the full sentence ("Good evening! I'm Captain…", "I won't look. Promise.", …)
  through a polite live region. Under reduced motion, text doesn't scroll and pictograms still show.
  Tried and removed at the user's request: a comms panel, a HUD callout with a leader line and "CAPTAIN" label,
  speech synthesis, a Chakra Petch font, a glyph-decode reveal and a streamed text line. Previews of the options were
  shown as artifacts (message styles A–E, speech styles A–E).
- **Reaction glyphs** (front canvas, `drawGlyphs`), one small glowing touch per moment, all skipped under reduced motion:
  z's drift up from Captain's head while it sleeps (instead of "Zzz…" text, every ~1s); three thinking dots
  bubble up left to right while signing in; a sweat drop slides down the side of the helmet on an error; six
  sparkles pop around the head on success; one cyan sparkle pops above the head when Captain is clicked (at most
  every 0.45s) while its eyes go ^ ^. A pink heart (floating, and as a visor pictogram) was tried for the click and
  removed as too consumer-like for an enterprise tool.
- **Particles**: "Particles: on action / always" toggle in the header (`login.tsx`, saved to `localStorage` key
  `login-particles`; default is on action). On action hides them at rest and fades them in for a click on Captain
  (2.5s), signing in, success and errors. Keystroke sparks always show. The motes float freely (no orbit rings),
  the cloud turns slowly so they pass behind and in front of Captain, they emerge from Captain after it pops in,
  trails are short and faint (max 7px), and they dim by 45% while Captain speaks.
  The voice ring shows only while Captain speaks, and particle bursts only on actions.
- **Background** (`DotField`): calmer. The dots are fainter and smaller, the light sweep is slower and about half
  as bright, the cursor glow is softer, and the dots fade almost out behind the centre column (Captain, title, form).
- The pop-in is timed on the clock, not per frame, so it lands on time when frames are sparse.

- Dot stays a flat 2D SVG on purpose: a true 3D (three.js) version was tried in a preview and rejected because
  lighting and perspective distorted the flat icon look. Depth comes from a small CSS tilt toward the cursor,
  eye/visor parallax and a pop-in on load.
- Particle aura: two canvases, one behind and one in front of Dot, so particles pass behind and in front of it.
  It has occasional four-point glints, smaller and dimmer far-side particles, and particles fade over Dot's face.
  The cursor parts it. It tints violet while signing in, bursts on success, flickers pink on errors, and dims and
  sinks when Dot sleeps. (An earlier ring-orbit layout was replaced by free-floating motes; see above.)
- Companion behaviour: a typed speech bubble (greeting by time of day, "Hi <name>!" from the username,
  "I won't look" on the password), sparks from the form into Dot on each keystroke, eyes that follow along
  the username, a doze after 15 s idle with a wake-up line, and a boop on click. Screen readers get each line
  through a polite live region.
- `login.tsx`: added `success` and `keystrokes` state. The first name comes from the email's local part.
  Mode priority is now loading → success → field focus → error → hover → idle, so Dot looks away for the
  password even while an old error is showing.
- Verification: `tsc --noEmit` passes with no errors in these files. A 2D build of the same aura was screenshotted
  in a headless browser and looked right. Not checked: the real page in a browser, and the
  production build.
- Not done: the page still uses fixed dark colours (no light theme). Under `prefers-reduced-motion`, motion is
  disabled but the aura is still drawn.

---

## 2026-10-19 — Login page redesign with animated agent orb

- `src/views/login.tsx`: replaced the two-panel layout (gradient brand panel + card) with one centred
  column on a dark canvas: small brand bar, orb mascot, title, Microsoft SSO, collapsible admin login, footer.
  Auth logic, error messages, the Konami and hidden-text easter eggs are unchanged.
- `src/components/login/AgentScene.tsx` (new):
  - `DotField`: a canvas dot grid with a slow diagonal "current", a glow under the cursor and a fade at the edges.
    Pauses when the tab is hidden and draws one static frame under `prefers-reduced-motion`.
  - `DotBot`: a white rounded helmet with a glass visor whose eyes are 7×7 LED dot-matrix grids,
    echoing the background dots. Expressions are sets of lit dots: the eyes follow the cursor (snapped to the grid)
    and blink at random; they show ^ ^ when hovering a sign-in button, look down when the username field
    has focus, shut for the password, open one eye when the password is shown, become spinners while
    loading, and show > < in pink with a shake on an error.
    Two earlier drafts were rejected by the user: an orb that looked too much like Grok's bot, and a jellyfish that looked odd.
- Why: the user asked for a cleaner, less cluttered login with a cute agent animation that isn't a copy of Grok's mascot.
- Verification: **not run.** tsc, the build and a browser check were not done in this session.
- Not done: the login page now uses fixed dark colours instead of theme tokens, so light mode does not change it.

---

## 2026-10-17 — Agent Ops: run page redesign, server-side run metrics, cache-aware cost

Branch: `feature/ui-redesign` · Uncommitted at time of writing.
Reference doc: [memory/agent-run-metrics-and-prompt-caching.md](./memory/agent-run-metrics-and-prompt-caching.md).

### 1. Run detail page redesign (`/agent-lab/runs/[sessionId]`)

| Change | Where |
|---|---|
| Split the 400-line page into focused modules | `src/components/agent-ops/cockpit/` (`format.ts`, `ui.tsx`, `insights.ts`, `InsightsPanel.tsx`, `TurnStory.tsx`, `Waterfall.tsx`, `InvocationList.tsx`, `ToolBreakdown.tsx`, `CallDrawer.tsx`, `LoopBreakdown.tsx`) |
| Header: status badge (Healthy / N errors), model chips, KPI cards with visual split bars (tokens in/out, tool ok/err); "Turn time 0ms" card hidden when no data | `SessionCockpit.tsx` |
| Whole page scrolls; sticky tab bar with cost · tokens · ok-count always visible; tabs ordered Overview → Turns → Timeline → Tools → Transcript with counts | `SessionCockpit.tsx` |
| **What stands out** — rule-based insights (failures, identical repeated calls, dominant tool, input-token share, cache hit, model vs tool, context growth, busiest turn, slowest call); click to inspect the calls | `insights.ts`, `InsightsPanel.tsx` |
| **How the agent worked** — per turn: question → run-length tool steps (`describe_schema ×6 → execute_tool ×2 → Answer`) → answer preview | `TurnStory.tsx` |
| **Execution timeline** — Gantt waterfall; real clock time when `created_at` exists (end − duration), sequential fallback otherwise | `Waterfall.tsx` |
| **Call inspector** — side drawer replaces inline expansion: highlighted SQL, input, output, error, copy buttons; ↑/↓ step, Esc close | `CallDrawer.tsx` |
| Compact one-line call rows with SQL/argument preview and duration bar; grouped by turn in history views | `InvocationList.tsx` |
| Stable per-tool colours across every panel | `SessionCockpit.tsx` (`colorOf`) |

### 2. Server-side turn + loop metrics (new)

| Change | Where |
|---|---|
| `LoopMetrics` type, `measureContext()`, `onLoopMetrics` callback; Bedrock loop measures LLM time, first token, tool-batch time, cache read/write tokens, context size | `src/lib/inspector/agent-loop.ts` |
| Same instrumentation for Foundry / xAI / OpenAI-compatible loop (reads `prompt_tokens_details.cached_tokens`) | `src/lib/inspector/providers/foundry-chat.ts` |
| `TurnMetricsRecorder` — collects loops, writes `agent_turn_log` + `agent_loop_log` in one transaction on every exit path; never breaks chat | `src/lib/agent-ops/record-turn-metrics.ts` (new) |
| Inspector + Workbench chat wired to the recorder; tool rows now carry `run_id = turn_id` | `src/app/api/inspector/chat/route.ts`, `src/app/api/agent-lab/workbench/chat/route.ts` |
| New tables + migration (additive) | `prisma/schema.prisma`, `prisma/migrations/20261017_agent_turn_loop_log/migration.sql` |
| Run API loads turn/loop rows (empty if table missing); cockpit matches them to turns, attaches tool rows by `run_id`, synthesizes `turnOps` when the message lacks it, adds `analytics.server` aggregates | `src/app/api/agent-lab/runs/[sessionId]/route.ts`, `src/lib/agent-ops/session-cockpit.ts` |
| UI: "Model vs tools" and "Prompt cache" KPI cards; **Loop by loop** panel per turn (model vs tool bar, context growth, cached tokens) | `SessionCockpit.tsx`, `LoopBreakdown.tsx` |

### 3. Cost

| Change | Where |
|---|---|
| `agent_cost_log.duration_ms` now populated for Inspector turns | `src/app/api/inspector/chat/route.ts` |
| `computeCostUsd(model, in, out, { readTokens, writeTokens })` — cache reads discounted, Anthropic cache writes at 125%; rates per family in `cacheRates()` | `src/lib/lifecycle/log-agent-cost.ts` |
| Token semantics normalized: metrics `inputTokens` always **includes** cached tokens (Bedrock reports them separately) | `agent-loop.ts`, `record-turn-metrics.ts` (`tokenTotals()`) |
| Cockpit fallback estimate uses the server cache split | `session-cockpit.ts` |

### 3b. Fix: run page showed "Session not found or access denied" (2026-10-17, evening)

- **Cause (most likely, not reproduced — the API needs a signed-in session):** the running `next dev` still held the old Prisma client, which has no `agent_turn_log` model. `prisma.agent_turn_log.findMany(...)` threw a *synchronous* `TypeError` that the `.catch(() => [])` could not catch, so the route returned 500, and `RunDetailPage` showed the same "not found" text for every failure status.
- **Fix:** `src/app/api/agent-lab/runs/[sessionId]/route.ts` wraps the two optional queries in async functions so a missing table or stale client degrades to "no server metrics"; `src/components/agent-ops/RunDetailPage.tsx` now distinguishes 404/403, 401, 500 and network errors. Removed stray `query_engine-windows.dll.node.tmp*` files left by the failed `prisma generate`. `tsc` clean.
- **Still needed:** restart `next dev` so the regenerated client loads.

### 3c. FOER (`/agent-lab/memory`, `/ops`) now follows the app theme

- **Problem:** the FOER pages carried a private dark-navy / cream palette chosen in JS (`resolvedTheme !== 'light'`, so `undefined` or `system` counted as dark) and a hardcoded gold `#FDB515`, so they ignored Sage Studio (light), Data 360 Night (dark) and the user's accent.
- **Fix:** new `src/lib/foer/foer-theme.ts` aliases every `--foer-*` variable onto the app tokens (`--background`, `--surface-1/2/3`, `--line-1/2`, `--ink-1/2/3`, `--brand-a-ink`, `--ok`, `--warn-bg`); `FoerStoryDashboard` and `FoerOpsDashboard` use it instead of their own DARK/LIGHT maps, and `dark` is now `resolvedTheme === 'dark'`.
- `src/lib/foer/foer-tokens.ts`: `GOLD` → `var(--brand-a-ink)`, `NAVY` → `var(--ink-3)`, `TOOLTIP_BG/TEXT` → surface/ink, new `resolveCssColor()` for ECharts (canvas cannot read CSS vars). `HARD_RULE`'s literal gold orb colour is unchanged (data colour).
- Replaced hardcoded dark surfaces in `FoerStoryDashboard` (sticky bar, spinner), `DistillationStage` (button text, SVG tints), `ShelvesPanel` (tooltip, badges, card tint) and `ForgettingPanel` (ECharts colours, hex-alpha `${GOLD}50` → `color-mix`, spike label).
- **Not changed:** typography (Source Serif 4 / Inter Tight / IBM Plex Mono is FOER's editorial identity) and per-rule-type data colours. `tsc` clean; **not viewed in a browser** (needs a signed-in session) and ESLint cannot run in this repo.

### 3d. App-wide theme audit and fixes (Light = Sage Studio, Dark = Data 360 Night, user accent)

**How it was found:** scanner scripts ranked every file by theme risk (hardcoded dark backgrounds, light text, white-alpha tints, Tailwind palette classes, JS theme switches) and audited CSS variables for definitions that were missing or only defined inside `.workbench-frame`.

| Root cause | Fix |
|---|---|
| Legacy palettes in `globals.css` never re-aliased: `--estate-*` (~500 uses, 51 files), `--iv-*`, `--wb-border-subtle` kept their own cool-blue / navy values | New **Theme v3** block at the end of `src/app/globals.css` aliases them onto `--background`, `--surface-1/2/3`, `--line-1/2`, `--ink-1/2/3`, `--ok/--warn/--bad`, `--brand-a*`. Sage/Night + accent now flow through every Data Estate page |
| Variables defined only inside `.workbench-frame` but used elsewhere (`--text-muted` 38 uses, `--bg-surface`, `--bg-base`, `--bg`, plus undefined `--wb-text`, `--terminal-bg`, `--font-mono`) | Defined globally in the same block (inspector dashboards, ShareDialog, estate jobs, JobDetailDrawer, dialogs and chart cards were silently losing them) |
| White-alpha tints (`rgba(255,255,255,0.05)`) invisible on light, `hover:bg-white/N` | 140 + 30 lines in ~35 files: `color-mix(in srgb, var(--ink-1) N%, transparent)` and token borders |
| Light-gray text literals (`#e8ecf0`, `#c9d1d9`, `#8892A4`, …) | `var(--ink-1/3)` |
| Hardcoded `indigo/violet/purple` Tailwind accents (~150, 32 files: docs, staging, policies, bandits, estate) | `bg/text/border/ring/from/to-[color:var(--brand-a…)]` so they follow the accent |
| Cool `slate-*` Tailwind neutrals (393 uses) and paired `bg-white` | Mapped by role to surface / ink / line tokens (264 lines, 32 files) |
| Hex-alpha on colors that can now be `var()` (`${GOLD}30`) produced invalid CSS that browsers drop | New `src/lib/theme/with-alpha.ts` `withAlpha(color, 'NN')` (hex stays hex, otherwise `color-mix`); applied at 47 sites in 20 files |
| Dark-only local palettes | `ModelPerformanceLab` (page), `AssumptionChip`, `ClassSuggestionChip`, `ReflectionCard`, estate log viewers (`JobRunPage`, `LogStreamPanel`), `StreamingMessage` readiness chips, `workbench/atoms` StatusBadge, bandits tooltips, `ScanCoverageModal` now use tokens |

**Left alone on purpose:** the login brand panel; modal scrims; white icons/text on solid brand fills; the 7-hue categorical palette in `bandits/types.ts`; per-rule-type / per-model data colours; ECharts and `lib/studio` themes (canvas cannot read CSS variables; they already switch light/dark); Tailwind `emerald` success colours; `.workbench-frame` scoped palettes.

**Guard:** `src/lib/theme/__tests__/theme-guard.test.ts` fails on `resolvedTheme !== 'light'`, indigo/violet/purple or slate utilities, white-alpha backgrounds, and hex-alpha on `var()` constants (it already caught `bandits/types.ts`, which was allow-listed with a reason).

**Verification:** `tsc` clean; full `vitest` 484/484 (incl. new guard); Tailwind CLI probe confirmed the generated arbitrary classes (`color:`-hinted, `color-mix`, `hover:`, `dark:`, `from/to`) emit CSS. Codemods briefly doubled CRs in 36 files (Python text-mode on Windows); repaired and verified 0 `
` remain. **Not viewed in a browser** and `next build` not run (it would clobber the running dev server's `.next`).

### 3e. Vite + React Router v7 migration plan (2026-10-18) — plan only, no code changed

- New [vite-react-router-v7-migration-plan.md](./vite-react-router-v7-migration-plan.md): what React Router v7 modes are, recommended target (Framework mode with `ssr: false`, Data mode as fallback), single-origin architecture with Next kept as API + auth server, `next/*` compatibility shims, 7 phases (0 spike to 6 cut-over), go/no-go metrics, risk register, open decisions.
- **Measured from the repo:** 43 pages, 9 dynamic routes, 149 API routes (5 SSE), 210 client components, 208 files importing `next/*`. Only **4** pages/layouts have real server logic (`(agent)/layout`, `dashboard`, `estate/jobs/[id]`, `memory/ops`). Import-graph trace: **0 of 210 client components reach Prisma / AWS / `pg` / server-only code** (5 files flagged only for browser-safe `dagre`).
- **Key caution recorded:** `src/proxy.ts` is the only gate on `/api/*`, so it must stay (narrowed to `/api/*`) when page protection moves to the SPA. Dev needs an extra Azure AD redirect URI (owner approval).
- Recommendation: Phase 0 spike (2-3 days, 3 pages, measure HMR/build) before any port; gain may be smaller than expected after the Next 16 upgrade. Effort figures are unvalidated estimates.

### 3f. Vite + React Router v7 UI built and tested (2026-10-18) — NOT cut over

Progress and evidence: [vite-migration/PROGRESS.md](./vite-migration/PROGRESS.md) · how to run: [../web/README.md](../web/README.md).

- **New `web/` app** (Vite 7.3.6, `react-router@7.18.4`, React 18): all 43 pages routed, reusing `src/` in place through the `@` alias; `next/link`, `next/navigation`, `next/dynamic`, `next/image` replaced by shims in `web/src/compat`; client-side `RequireAuth` replaces the server session check; `index.html` carries the theme boot scripts. Next.js UI untouched.
- **Two additive API routes** replace server-only page logic: `GET /api/dashboard/summary`, `GET /api/agent-lab/memory/topic-map` (job detail already had an API).
- **Opt-in serving from the Next container:** `WEB_UI=vite` (Dockerfile build arg) copies the build to `public/spa`, `next.config.ts` rewrites page URLs to it, `src/proxy.ts` makes `/spa/` public (login page needs its JS before sign-in). Default build is unchanged. Optional `NEXT_DIST_DIR`.
- **Tests:** `tsc` clean (both projects); root suite 489/489; web unit tests 44/44; real-Chrome suite 54/54 against the production bundle (57/57 in dev); `WEB_UI=vite next build` + `next start` integration 16/16; bundle scan clean.
- **Bugs found by those tests and fixed:** infinite `update()` remount loop from `RequireAuth` unmounting the app while next-auth status was `loading`; Prisma browser stub in the bundle via a constant imported from `lib/foer/topics.ts` (now `lib/foer/constants.ts`); favicon base path.
- **Not verified:** real sign-in (Credentials, Azure AD), real data, SSE streaming, an actual Docker image build, EB deployment. **Next steps:** human pass on each page, then your decision on cut-over (Phase 6, not started).

### 3g. Dev ports: Vite UI on 3000, Next API on 3001 (2026-10-19)

- `web/vite.config.ts` defaults to port 3000 and proxies `/api` to `http://localhost:3001`; new `npm run dev:api` (`next dev -p 3001`); `npm run dev:all` starts both; e2e tooling keeps its own ports. Reason: `NEXTAUTH_URL` and the Azure AD redirect URI already use :3000, so Microsoft sign-in can return through the new UI with no Azure change.
- **Not verified:** a real Microsoft sign-in on the new ports (an earlier attempt failed with `OAuthCallback`, cause undiagnosed). Running `npm run dev` and `npm run web:dev` together now conflicts on :3000; use `dev:api`.

### 3h. Cut-over: the UI is now Vite + React Router; Next.js is the API only (2026-10-19)

Record and evidence: [vite-migration/PROGRESS.md](./vite-migration/PROGRESS.md). Backups before the change: `C:\ALOFT\backup-before-vite-cutover-20261019-0028\` and git ref `refs/backup/pre-vite-cutover`.

- **Pages relocated, Next serves none:** 31 pages moved with `git mv` from `src/app/**/page.tsx` to `src/views/**`; 12 pages replaced by adapters or redirects were deleted (`/`, `dashboard`, `estate/jobs/:id`, `memory/ops`, `runs` and `runs/:sessionId`, `teach/:sessionId`, `workbench/:sessionId`, `inspector/:sessionId`, `inspector/dashboards/:dashboardId` and `/builder`, `agent-staging`); `app/layout.tsx` and `app/(agent)/layout.tsx` deleted. `src/app` now holds `api/`, icons and `globals.css`.
- **`next.config.ts`** always rewrites page URLs to `public/spa/index.html` and caches `/spa/assets` immutably (the `WEB_UI` flag is gone). **`src/proxy.ts`** now guards `/api/**` only (same `withAuth` behaviour); pages are public static files and the SPA redirects signed-out users to `/login`.
- **Scripts:** `npm run dev` = API (:3001) + UI (:3000); `npm run build` = build UI into `public/spa` (`prebuild`) then `next build`; `Dockerfile` has no build arg any more.
- **Tests:** root suite 489/489; web 45/45; `tsc` clean (both projects); real-Chrome suite 54/54 on the production bundle; bundle scan clean; `npm run build` exit 0 with **0 page routes**; `next start` integration 22/22 including **all 149 non-public API routes refusing a signed-out request**.
- **Not verified:** real sign-in (Credentials, Microsoft; an earlier Microsoft attempt failed with `OAuthCallback`, cause undiagnosed), real data, SSE streaming, a Docker image build, deployment. A `next dev` server that was running during the deletion stopped answering; restart `npm run dev`. Nothing is committed.

### 3i. Post-cut-over fixes: Tailwind content, Microsoft sign-in diagnosis (2026-10-19)

- **Unstyled pages:** `src/views` was missing from Tailwind's `content` globs, so classes used only in the moved pages (e.g. the login page's `lg:flex`) were not generated. Added it; new test `web/src/tailwind-content.test.ts` guards every JSX folder. Verified by screenshot of the login page.
- **Microsoft sign-in (`OAuthCallback`):** checked against Microsoft with the configured credentials: the client secret is **valid** and the redirect URI `http://localhost:3000/api/auth/callback/azure-ad` is **accepted**, so it is not an expired secret. Added a dev-only mirror of next-auth error name/message to `.logs/next-auth.log` (gitignored; no tokens) in `src/lib/auth.ts`, and changed the login message that wrongly blamed the secret. **Cause not yet known**; needs one retry of the Microsoft sign-in to capture the reason.

### 4. Docs, logging, tests

- New `docs/memory/` with [agent-run-metrics-and-prompt-caching.md](./memory/agent-run-metrics-and-prompt-caching.md) and an index README.
- Merged the last-30-day logs (`docs/ui-redesign-and-next16-log.md`, `docs/inspector-csv-export-changelog.md`) into this file. March workbench log and `ops-failure-log.md` left as they are.
- Automatic changelog guard: `.claude/settings.json` Stop hook → `.claude/hooks/changelog-guard.mjs`; rule for Cursor in `.cursor/rules/changelog.mdc`; note in `CLAUDE.md`.
- Tests: new case in `src/lib/agent-ops/__tests__/session-cockpit.test.ts`; new `src/lib/lifecycle/__tests__/log-agent-cost.test.ts`. `npx vitest run src/lib/agent-ops src/lib/lifecycle src/lib/inspector` → all pass. `tsc --noEmit` clean.

### 5. Not done / follow-ups

- **Migration applied 2026-10-17** via `prisma db execute` + `migrate resolve --applied` against the database in `.env` — **`aloftdb` on `aloft-prod-writer` (production RDS)**. Additive only (two new tables); verified 21 + 18 columns, 0 rows. Still to do: stop `next dev`, run `npx prisma generate` (earlier `EPERM` on the locked query-engine DLL), restart.
- Not viewed in a browser (dev server redirects to login); checks were type check and unit tests.
- Bedrock prompt caching for Inspector chat is **proposed, not enabled** (billing decision) — reference doc §6.
- `grok-4.7` missing from `MODEL_PRICING` (falls back to `claude-sonnet-4` rates); cache-rate ratios are approximations to verify.
- Workbench chat still writes no `agent_cost_log` rows.
- Older sessions are not backfilled; server-only panels stay hidden for them.

---

## 2026-10-16 → 17 — UI redesign & Next.js 16 upgrade

Branch: `feature/ui-redesign` · Period: 16–17 Oct 2026

| Commit | Summary |
|---|---|
| `6db3442` | Pre-existing branch work committed: agent workbench, construction draft lib, feature + docs updates |
| `0ae559c` | Sage Studio / Data 360 Night theme, new sidebar, theme sweep across pages |
| `0f7f5f6` | Upgrade to Next.js 16.4 (Turbopack, disk cache) |

---

### 1. Fixes

| Issue | Cause | Fix |
|---|---|---|
| `[next-auth] CLIENT_FETCH_ERROR` in the browser console | Dev server process hung, so `/api/auth/session` never answered | No code change. Stop the server, delete `.next`, restart |
| Header had no background (content showed through) | `bg-[var(--surface-1)]/85`: Tailwind 3 can't apply `/opacity` to a CSS variable | Header uses `--header-bg` (a `color-mix` of `--main-bg`) and `--header-border` |
| Breadcrumb / older components kept the navy palette in light mode | `--text-primary/secondary/tertiary` and `--border-default` still held the old values | Aliased to `--ink-1/2/3` and `--line-2` in the shell-integration block of `globals.css` |
| Sidebar covered the page when it expanded on hover | Layout slot reserved only the collapsed width unless pinned | Slot always matches the sidebar width, so content slides with it (same 300 ms easing). 140 ms hover delay so a passing cursor doesn't shift the page. Overlay shadow now only on the mobile drawer |
| Grey-blue patches in dark mode on docs, policies, bandits, audit and estate pages | Hardcoded GitHub-dark hex (`#1c2128`, `#2d333b`, `#0d1117`, `#161b22`, …) in about 15 files | Replaced with `--surface-1/2`, `--background`, `--line-1` |
| Job run page borders invisible in light mode | `rgba(255,255,255,0.07)` borders | `var(--line-1)`. Hardcoded `#5B3DF5` text now `var(--brand-a-ink)` |
| **Next 16:** API routes would read `params.id` as `undefined` | `params` is a Promise in Next 16; 13 handlers accessed it synchronously | Handlers in 8 files now `await` it: `catalog/agents/[id]` (fork, review, versions, diff), `catalog/tools/[id]`, `policies/[id]`, `agent-lab/memory/[id]` (+ curate) |
| Production `standalone` output bundled the whole repo (src, docs, `eb-deploy.zip`, Dockerfiles) | Local-only `spawn(..., { cwd: process.cwd() })` in `launch-harvester.ts` made the tracer include everything | `/*turbopackIgnore: true*/` on the call. Output is now `server.js` + `node_modules` (115 MB) |
| Tailwind warning: `duration-[400ms]` ambiguous | Arbitrary value matches several utilities | `[transition-duration:400ms]` in `CommandSidebar.tsx` |

---

### 2. Enhancements

#### 2.1 Theme v2 (`src/app/globals.css`)
- **Light — Sage Studio:** sage neutrals, terracotta accent `#A8481F`, light sage sidebar `#E3E9DE`.
- **Dark — Data 360 Night:** black/grey neutrals (`#121314` main, `#1A1B1D` cards), sapphire accent `#1F5FD6`, navy sidebar `#0B1426`.
- Shared tokens: `--brand-a*`, `--surface-1..3`, `--line-1/2`, `--ink-1..3`, `--ok/warn/bad`, `--rail-*`. shadcn-style variables (`--primary`, `--ring`, `--background`, …) point at them.
- Legacy page palettes (`--builder-*`, `--at-*`, `--wb-*`, `--pl-*`, `--born-*`) are aliased onto the shared tokens, so every page follows the theme and the accent.
- Accent-colored focus ring and text selection app-wide.
- Font: DM Sans Variable (`@fontsource-variable/dm-sans`).

#### 2.2 User-customizable colors
- **Appearance** section in the user menu (`src/components/shell/AppearanceControls.tsx`): accent and sidebar color, each with presets, a free color picker and a reset.
- `src/lib/theme/appearance.ts` derives every dependent variable from the picks and enforces WCAG AA contrast, so any color stays readable. Per-mode defaults and presets live here too.
- Saved per browser in `localStorage` (`aloft-appearance`). A blocking boot script in `src/app/layout.tsx` applies it before first paint (no flash). `AppearanceSync` (in `ThemeProvider`) re-applies on light/dark switch and across tabs.

#### 2.3 Sidebar (`src/components/agent-lab/staging/`)
- **Command style** (default, `CommandSidebar.tsx`): 64 px icon strip that expands to 264 px on hover. Pin to keep it open (button or `[`). `Ctrl/⌘+K` page search with arrow-key navigation. Area switcher (Build / Memory / Data Estate / Govern) with a sliding highlight. Account and style toggle at the bottom.
- **Rail style** (`StagingSidebar.tsx`): compact 64 px rail plus a 240 px slide-out panel.
- Switch between the two from the sidebar; the choice is saved per browser (`aloft-nav-style`).
- Shared pieces: `nav-config.ts` (one nav definition, including the Workbench entry), `useNavShell.ts` (hover/pin/mobile behaviour), `nav-shared.tsx` (style toggle, subtle aurora glow on dark rails).
- Flush, full-height, square-cornered. Colors come from `--rail-*` tokens, so the sidebar works on light and dark rails. Mobile gets an overlay drawer opened from the header.

#### 2.4 Header (`StagingHeader.tsx`)
- Theme background with blur, lighter borderless buttons, divider before the breadcrumb.

#### 2.5 Theme sweep across pages
- A script swept 111 files: old purple hex/rgba (`#5B3DF5`, `#7C66FF`, `#A596FF`, …) and `#8892A4` were replaced with `var(--brand-a*)` / `var(--ink-3)`. Tailwind opacity variants were converted to `color-mix(...)`.
- Intentionally excluded: canvas/ECharts chart files (canvas can't read CSS variables), `lib/studio`, `widget-option`, tests, the login page.

#### 2.6 Agent Draft panel (`src/components/workbench/ConfigPanel.tsx`)
- Was tiny monospace text with hardcoded gold. Now has a title and status pill, a 5-step progress bar (interview → commission), a "ready to commission" callout or a missing-fields checklist, an instructions card with "Show all", listed datasources with type tags, and assumptions with status chips and confidence bars. All in theme colors.

---

### 3. Developer experience & platform

#### 3.1 Faster dev server
- Turbopack for `npm run dev` (`npm run dev:webpack` is the fallback).
- `optimizePackageImports` for `@phosphor-icons/react`, `lucide-react`, `framer-motion`, `echarts`, `recharts`, `@xyflow/react`.
- Cleared a 2.1 GB `.next` cache.
- Recommended (needs admin, check IT policy): exclude `.next` and `node_modules` from Windows Defender real-time scanning.

#### 3.2 Next.js 15.5 → 16.4.2
- `next` / `eslint-config-next` 16.4.2. `next-auth` 4.24.15 (first 4.x version declaring Next 16 support).
- `src/middleware.ts` → `src/proxy.ts` (Next 16 name; same next-auth `withAuth` login check).
- Turbopack is now the default and compiled pages are cached on disk (`turbopackFileSystemCacheForDev`).
- Next updated `tsconfig.json` (`jsx: react-jsx`, dev types path) and its managed block in `AGENTS.md`.

Measured on this machine (login page):

| | Next 15 | Next 16 |
|---|---|---|
| Server ready | 8.3 s | 4.4 s |
| First page after a restart | 15–24 s | 4.1 s |
| Revisit | 0.36 s | 0.09 s |
| `next build` | — | 167 s, clean |

#### 3.3 Evaluated, not done
- **React 19:** App Router pages already run on Next's bundled React 19.3. All dependencies support 19 except `lucide-react` 0.344, which needs upgrading to 1.x; that may rename icons, and the `Chrome` brand icon is removed. Recommended as a separate change.
- **Moving to Vite:** fastest dev loop. The suggested route is a Vite + React Router v7 UI with Next kept as the API server. Not started. **2026-10-18: migration plan written, still no code:** [vite-react-router-v7-migration-plan.md](./vite-react-router-v7-migration-plan.md).

---

### 4. Known gaps / follow-ups
- About 12 files still build colors by appending hex alpha (`${color}22`) and show some old purple: `estate/jobs/page.tsx`, `inspector/dashboards/page.tsx`, `ChatHistoryPage.tsx`, `DistillationStage.tsx`, `FoerOpsDashboard.tsx`, `FoerStoryDashboard.tsx`, `MountPanel.tsx`, `ShelvesPanel.tsx`, `JobRunPage.tsx`, `BoostTabs.tsx`, `NotWiredChart.tsx`, `StreamingMessage.tsx`, `SessionDetailDrawer.tsx`.
- The workbench page still uses gold `#FDB515` (breadcrumb, NEW and COMMISSION buttons, message bars).
- Chart palettes are unchanged.
- Appearance choices are per browser, not per user account.
- Next 16 is verified by type check, production build and logged-out requests. Signed-in pages, especially the API routes in §1, still need a manual pass.
- React 19 is deprecated-warning only for now; it will be required by Next 17.
- Untracked and not committed: `eb-deploy.zip`, `eb-deploy/`, `docs/elastic-beanstalk-logs/`, `docs/cfn-hup.log`, `tmp-inspect-session.js`, `.cursor/`. Consider `.gitignore`.
- Commit `6db3442` adds about 17 MB of generated and vendored files (`architecture-guide.html`, `docs/vendor/`).
- None of the visual changes has been reviewed in a browser by the implementer; all checks were type check and build.

---

## 2026-09-28 → 29 — Inspector CSV export & session Continue

> **For future chats / agents:** read this file before changing Inspector export,
> Databricks execute, Data Studio download, or session-knowledge Continue behavior.
> Add new entries for these areas to the top of this changelog.

**Session / workspace:** `aloft-d360`  
**Origin chat topic:** Inspector agent fetch Databricks rows (SIRE / vessel) as CSV up to 1 lakh rows; agent over-joining; Continue rediscovering via `describe_schema`.

---

### Decisions locked

| Decision | Choice |
|----------|--------|
| Large download delivery | **Method A** — stream CSV in one authenticated API request (no S3/ECS v1) |
| Formats | CSV only (Excel later) |
| Hard row cap | **100,000** (`EXPORT_MAX_ROWS`) |
| Chat / preview path | Unchanged INLINE `execute_tool` (~1k UI); do **not** dump 100k into `studio_query_results` |
| Export SQL policy | Reuse **last successful** query; **no unsolicited JOIN/UNION** unless `allow_combined:true` |
| Continue rediscovery | SESSION KNOWLEDGE + `studio_query_results` facts; never wipe `inspectorKnowledge` on autosave |

---

### Changelog

#### 2026-09-28 — Export before execute (EXPORT_NO_SQL) + OpenAI embeds

**Problem:** Agent called `export_query_result` (filename only) before `execute_tool` → empty `queryResults` → false failure while DATA table already had rows from a later execute. UI looked “stuck loading”.

**Changes:**
- [`src/lib/inspector/tools.ts`](../src/lib/inspector/tools.ts) — if no in-turn SQL, load last `studio_query_results.sql` for the session; distinct `EXPORT_NO_SQL` vs `EXPORT_COMBINE_REJECTED`.
- [`src/lib/inspector/prompts.ts`](../src/lib/inspector/prompts.ts) — mandatory order: execute_tool → then export; retry guidance on EXPORT_NO_SQL.
- Chart pane “loading” in UI is usually **not** a fetch failure — needs a numeric Y column (“Select a numeric Y column…”). Use **CSV** button for download.

---

#### 2026-09-28 — Embeddings: OpenAI only (Titan disabled)

**Problem:** Titan Bedrock embed attempted first → invalid AWS token noise; user has no Titan path.

**Changes:**
- [`src/lib/azure/embed-client.ts`](../src/lib/azure/embed-client.ts) — `embedWithFallback` uses Azure OpenAI / Foundry only; Titan / Bedrock embed calls removed; `isAwsEmbeddingConfigured()` always false.

---

#### 2026-09-28 — Session-knowledge LLM + embed log noise

**Problem (terminal):**
1. `[session-knowledge-llm] … 'max_tokens' is not supported … Use 'max_completion_tokens'`
2. `[embed] Titan … UnrecognizedClientException` (obsolete after OpenAI-only switch)

**Changes:**
- [`src/lib/inspector/session-knowledge-llm.ts`](../src/lib/inspector/session-knowledge-llm.ts) — use model registry `tokenParam`; retry with alternate if API rejects.
- [`src/lib/boost/models.ts`](../src/lib/boost/models.ts) — `gpt-6-luna` → `tokenParam: 'max_completion_tokens'`.

#### 2026-09-29 — Session-knowledge temperature for gpt-6-luna

**Problem (terminal):**
`[session-knowledge-llm] … Unsupported value: 'temperature' does not support 0 … Only the default (1) value is supported.`

**Changes:**
- [`src/lib/inspector/session-knowledge-llm.ts`](../src/lib/inspector/session-knowledge-llm.ts) — omit `temperature` on Foundry summary calls (same as `foundry-chat`).

---

#### 2026-09-28 — Continue rediscovery fix + this log

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

#### 2026-09-28 — Export SQL guard (no unwanted JOIN/UNION)

**Problem:** Agent invented `download_log` JOIN + legacy `UNION ALL` for Blue Butterfly CSV; hung >10 min.

**Changes:**
- [`src/lib/inspector/export-sql.ts`](../src/lib/inspector/export-sql.ts) — `resolveExportSql`, `sqlHasMultiSourceCombine`, `stripTrailingLimit`.
- [`src/lib/inspector/tools.ts`](../src/lib/inspector/tools.ts) — `export_query_result` uses resolver; falls back to last single-table SQL; `allow_combined`.
- [`src/lib/inspector/prompts.ts`](../src/lib/inspector/prompts.ts) — CSV EXPORT RULES in harvested + warehouse-only prompts; tool description updated.
- [`src/lib/inspector/__tests__/export-sql.test.ts`](../src/lib/inspector/__tests__/export-sql.test.ts) — unit tests.

---

#### 2026-09-28 — Export timeouts (stop infinite spin)

**Problem:** Export poll budget 10 min vs route `maxDuration` 300s → UI spun with no clear failure.

**Changes:**
- [`src/lib/databricks/execute.ts`](../src/lib/databricks/execute.ts) — `EXPORT_POLL_TIMEOUT_MS` = 4 min; `fetchWithTimeout` on submit/poll/chunk/external_link.
- [`src/lib/inspector/download-csv.ts`](../src/lib/inspector/download-csv.ts) — client abort ~4.5 min with actionable error message.
- [`src/lib/databricks/export-limits.ts`](../src/lib/databricks/export-limits.ts) — shared `EXPORT_MAX_ROWS = 100_000`.

---

#### 2026-09-28 — Method A CSV export (initial)

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

### How future agents should behave

1. **Do not** raise interactive `DATABRICKS_MAX_ROWS` to 100k for chat.
2. **Do not** stuff large exports into `studio_query_results.rows`.
3. **Do** keep export as a separate EXTERNAL_LINKS path with timeouts under route `maxDuration`.
4. **Do** default export SQL to last successful single-table query.
5. **Do** preserve `progress.inspectorKnowledge` on any session PATCH.
6. **Do** append to this changelog when changing these areas.
