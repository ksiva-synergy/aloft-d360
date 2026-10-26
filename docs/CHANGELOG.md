# Changelog — aloft-d360

Single running log of changes made in this repo, **newest first**.

## 2026-10-26 — Data access control, safety and policy plan

- **What:** Added `docs/data-access-control-design.md`: inventory of 16 data paths with current protection and gaps, Phase 0 holes, target model (platform vs data roles, sensitivity labels, grants, one `authorize()` decision point, per-path enforcement, admin screens), Databricks service principals per tier, label propagation to derived data, AI-specific safety, audit and incident response, retention, written policies, phased build plan, tests, observe-then-enforce rollout, decisions. Items tagged mandatory / should / good to have.
- **Why:** Requested deep dive on what the application needs for safety and policy; builds on the 24 October audit.
- **Findings (verified by reading code today):** audit P0s S1 (new users default to `admin`), S2 (workbench sessions without owner check), S3 (policy writes without role check), S4 (any user can add a Databricks connection) and S7 are still open. New: `/api/inspector/export` accepts SQL from the browser (up to 100,000 rows); `org`-visible dashboards run widget queries for every org user with the shared credential; memory rules are org-wide by default; estate column profiles keep `top_k`/`min`/`max` until an LLM flags PII, and keep `min`/`max` after; the code can route prompts to xAI and Azure OpenAI; `traceLlmCall` is not called anywhere.
- **Verified:** Documentation only. No tests run; deployment flags and Unity Catalog setup unverified.
- **Not done:** No code. Decisions in §15 of the doc are open.

## 2026-10-25 — Flows: detailed architecture and build plan

- **What:** Added `docs/flows-architecture.md` (components, data model, integration with existing code, execution model, scheduling and worker, chat builder, API, security, testing, phased plan with exit criteria, rollout, open decisions, code map). Corrected the governance line in `docs/flows-design.md`.
- **Why:** Requested as full documentation of the proposed architecture and how to build it. Written after reading the Workbench builder, `agents/chat` route, `executeSemanticQuery`, `executeDatabricksSQL`, `session-auth`, `rbac`, `audit` and the harvest queue/schedule code.
- **Findings recorded in the doc:** queries use one shared Databricks credential; there are no per-dataset permissions and `data_level` is not enforced for data access; `INSPECTOR_AUTH_ENFORCE` defaults to observe-only; no reusable run-an-agent-once function exists (only the SSE route); `executeSemanticQuery` allows governed models only and `executeDatabricksSQL` enforces read-only itself.
- **Verified:** Documentation only; the main files and functions named were checked to exist. Nothing was run or built.
- **Not done:** No code. Proposed schema change (`semantic` mode on the `query` step) is not implemented. Open decisions are listed in §17 of the doc.

## 2026-10-25 — Flows Phase 1 foundation: schema, validator, runner core, tables (not wired to any route or UI)

Design: `docs/flows-design.md`. Decision: stay on the current Next.js routes; Hono is out of scope for now.

- **`src/lib/flows/schema.ts`:** zod flow definition. Triggers `manual` / `schedule` (cron) / `event`; typed inputs; steps `query`, `retrieve`, `agent`, `transform` (filter/limit/count), `approval`, `output` (`save` only). No step evaluates code.
- **`src/lib/flows/validate.ts`:** `validateFlow` (never throws): duplicate ids, unknown step/input refs, ref scopes other than `steps.`/`inputs.`, self-refs, invalid cron, dependency cycles; returns execution order (refs and `dependsOn` both count).
- **`src/lib/flows/resolve.ts`:** `{{steps.x.y}}` / `{{inputs.z}}` resolution (whole-string refs keep their type), `applyInputs` (defaults, required, type check).
- **`src/lib/flows/runner.ts`:** `executeRun` against a `RunStore` and per-type `StepExecutors`, so it is independent of Next and can move to a worker. Saves state after every step, resumes by skipping succeeded steps, per-step retries with backoff and timeout, pauses at approval, honours cancellation, fails the run and skips the rest on error.
- **`prisma/schema.prisma` + `prisma/migrations/20261025_flows/migration.sql`:** new `PlatformFlow`, `PlatformFlowVersion`, `PlatformFlowRun`, `PlatformFlowStepRun` (`org_id` scoped, new tables only). `prisma format` also re-aligned whitespace on ~36 existing lines (no content change).
- **Verified:** `npx vitest run src/lib/flows` 18 passed (found and fixed three bugs: missing input defaults, wrong attempt counts, timeout message hidden by the abort error); `npx tsc --noEmit` clean; `prisma validate` passes.
- **Not done:** The migration is **not applied** to any database (apply per the file header) and `prisma generate` was not re-run. No step executors (query/agent/output are not connected to Databricks, Bedrock or storage), no `RunStore` backed by Prisma, no API routes, no approval endpoint, no UI, no builder, no scheduling. The full root test suite was not re-run. No commit was made.

## 2026-10-25 — Design proposal: Flows (describe an automation, ALOFT builds and runs it)

- **What:** Added `docs/flows-design.md`, a design for a Quick Flows-style feature: flow schema with typed steps, new `PlatformFlow*` tables, a durable step runner, a chat builder reusing Workbench, governance, and four phases.
- **Why:** Requested after comparing with Amazon Quick Suite; the design is based on a read of the Workbench, agent loop, scheduling code and Prisma schema.
- **Verified:** Documentation only; claims about existing code were checked against the files named in the doc. Nothing was run.
- **Not done:** No code, schema or migration. Open decisions (runner location, first outbound action, navigation, old pipeline tables) are listed in the doc with proposed defaults.

## 2026-10-25 — Typography implementation: Data Estate labels (PR-7/8) and uppercase-mono chrome across the app

Plan: `docs/audits/typography-implementation-plan.md` §4.4 (and the same pattern in §4.5, 4.7–4.9, 4.12).

- **Data Estate (`src/views/agent-lab/estate/*`, `src/components/estate/*`):** ~160 class strings that combined `font-mono` + `uppercase` + wide tracking + bold now use `text-label` (chips, table headers, section labels) or `text-ui` (buttons). `EstateNav.tsx` tabs are sentence-case `text-ui`; "Data Estate System" is `text-eyebrow`. Job-type, catalog table headers, schedule and stat labels follow.
- **App-wide inline-style pass:** 303 inline style objects in 82 files that set an IBM Plex Mono family with `textTransform: 'uppercase'` (plus optional size, tracking, weight, line height) were replaced by `...type.label` (imports added from `@/lib/typography/tokens`). Largest: `BoostTabs.tsx` (34), `EstateTable.tsx` (13), `ModelPerformanceLab.tsx` (11), `SemanticCard.tsx` (11), `DashboardBuilder.tsx` (10), `DataStudio.tsx` (9), `SemanticChartCard.tsx` (9), `DashboardGrid.tsx` (8). Source text in these places was already title case, so labels now read "Object Path", "Last Inventoried" instead of capitals.
- **Verified:** `tsc --noEmit` and `web:typecheck` clean (after fixing two bad replacements, a leftover `as const,` in `InsightRail.tsx` and `ClassSuggestionChip.tsx`, and a misplaced import in `ShelvesPanel.tsx`). Root `npx vitest run` 579 passed; `npm run web:test` 63 passed (one earlier run showed 9 files failing to load while the dev server was being stopped; re-run clean). Chrome screenshots of Estate Jobs and Catalog, FOER and BORN (light) show sentence-case sans labels and no layout breakage. Typography baseline lowered: inline `fontSize` 1,803 → 1,502, `fontFamily` literals 518 → 439, `letterSpacing` 585 → 300, heavy weights 221 → 129.
- **Not done:** Mono is still used for prose-like chips and values that are not uppercase (e.g. Catalog "Kind: All" and "Test: hidden", FOER KPI sub-lines, BORN panel subtitles, "no runs yet"); sizes of non-uppercase mono text, KPI value styles, table cell styles, weights 700+ and Tailwind `text-xs/sm` legacy sizes are unchanged. Only light theme was looked at for these screens. Dashboard (PR-5), admin pages (PR-6), Teach, charts/SSR (PR-14) and the final lock-down (PR-15) are not started. No commit was made.

## 2026-10-24 — Nest Workbench under Agents navigation

- **What:** Removed the standalone **Workbench** sidebar item. Workbench now lives under **Build → Agents** with in-page tabs (**Saved agents** | **Workbench**). Routes moved to `/agent-lab/agents/workbench` and `/agent-lab/agents/workbench/:sessionId`; legacy `/agent-lab/workbench*` redirects preserve old links.
- **Files:** `src/lib/navigation/agents-routes.ts`, `src/views/agent-lab/agents/{AgentsLayout,AgentsSubNav}.tsx`, `src/components/agent-lab/staging/nav-config.ts`, `web/src/router.tsx`, `web/src/routes/adapters.tsx`, workbench/history/handoff/edit URL call sites.
- **Why:** One Agents area for listing, chatting with commissioned agents, and building new ones.
- **Verified:** `npm run web:test` — 63 passed (router contract).
- **Not done:** Docs sweep (`docs/creating-agents.md`, audit URLs) for the new paths.

## 2026-10-24 — Typography implementation: PR-3 shared primitives, PR-9 chat surfaces (Inspector, Workbench)

Plan: `docs/audits/typography-implementation-plan.md` §4.14, §4.5–4.6.

- **PR-3 shared `ui/*` primitives** (`packages/aloft-shared/src/components/ui/`): `button` (sizes → `text-ui` / `text-ui-lg`; default `md` is now 13 px), `badge` (`text-label`), `dialog`, `alert-dialog`, `card` (`text-title-card`), `modal` and `modal/modal` (`text-title-section`), `label` and `form-field` (`text-label`, error text `text-caption`), `tabs` (`text-ui`), `tooltip` (`text-caption`), `table` (`text-ui-regular`, headers `text-label`), `calendar` weekday labels (`text-caption`). **`tailwind.config.js` `content` now includes `./packages/aloft-shared/src/components/ui/**`**; before this the Tailwind classes used only in those files were not scanned, so they were not generated unless used elsewhere. Expect small visible changes where primitives are used.
- **PR-9 chat surfaces:** `InspectorShell.tsx`, `SemanticGovernancePanel.tsx`, `EmptyStatePrompts.tsx`, `workbench/PromptCanvas.tsx`, `InputComposer.tsx`, `WorkbenchShell.tsx`, `StreamingMessage.tsx` now use `type.*` tokens instead of inline mono sizes and tracking. Uppercase tracked mono chrome became sentence-case sans: header breadcrumb and pills ("Databricks connected", "Catalog + SQL", "New", "Session", "Powered by ALOFT · v0.4"), tabs ("Results", "Semantic", "Developer", "Config"), "Commission", "Agents". Empty-state headings use `title-card`; placeholders and composer hints are sans. AI answer prose, bullets and numbered items use `body-lg` (16 px); markdown `#`/`##`/`###`/`####` use `title-section` / `title-card` / `ui` / `label`. Tool input/output labels use `label`. The local `serif` constant in `StreamingMessage.tsx` was removed.
- **Verified:** `tsc --noEmit` and `web:typecheck` clean; Chrome screenshots of `/inspector` and `/agent-lab/workbench` (dark) show sentence-case sans chrome and the earlier "Catalog + SQL" / "New" overlap gone; typography baseline refreshed with `UPDATE_TYPOGRAPHY_BASELINE=1` (see `typography-baseline.json`). Root `npx vitest run` 579 passed, `npm run web:test` 63 passed. Baseline now 1,803 inline `fontSize` (was 1,895), 585 `letterSpacing` (was 612), 518 `fontFamily` literals (was 519), 221 heavy weights (was 222).
- **Not done:** The rest of `StreamingMessage.tsx` tool-call rows, `ModelPerformanceLab`, dashboard builder, Teach thread and Studio still use inline mono and sizes (PR-10/11/13). Inspector answers were not checked with real streamed content. Remaining plan steps PR-4 to PR-8, PR-10 to PR-15 are not started.

## 2026-10-24 — Typography implementation: PR-0 guards, PR-1 foundation, PR-2 one font family

Plan: `docs/audits/typography-implementation-plan.md`. Findings addressed: TYP-01, 02, 03, 04, 13, 17 (partly 14).

- **PR-0 guards (new):** `src/lib/typography/__tests__/typography-guard.test.ts` fails when source names a font that is not loaded, loads fonts from a CDN, or grows hardcoded typography beyond `typography-baseline.json` (today: 1,895 inline `fontSize`, 144 `text-[Npx]`, 519 `fontFamily` literals, 612 `letterSpacing`, 222 heavy weights). `typography-tokens.test.ts` keeps CSS, Tailwind and TS tokens in sync and allows only weights 400/500/600. Update the baseline with `UPDATE_TYPOGRAPHY_BASELINE=1 npx vitest run src/lib/typography`.
- **PR-1 foundation (new):** `src/styles/typography.css` (font stacks, 17 type tokens as CSS variables and `.type-*` classes, `.tnum`); `src/lib/typography/tokens.ts` (`FONT_SANS`, `FONT_MONO`, `type.*` style objects, `CHART_TEXT`); `src/components/type/index.tsx` (`PageTitle`, `SectionTitle`, `Eyebrow`, `Num`, `Code`). `tailwind.config.js` adds the token classes (`text-title-page`, `text-ui`, `text-eyebrow`, …) and points `sans`/`serif`/`display`/`body` at `var(--font-sans)` and `mono` at `var(--font-mono)`. The old `xs…2xl` sizes are untouched.
- **PR-2 one family:** `src/app/globals.css` imports Inter (upright and real italic) and IBM Plex Mono 400/500 only; `body` uses the tokens; the Inter-specific `cv11`/`ss01` feature settings were removed (they had applied to DM Sans); `.workbench-frame` `--display/--sans/--mono` now use the global font variables. `SERIF`/`BODY`/`MONO` in `foer-tokens.ts` and `born-tokens.ts`, `FONT_*` in `teach-tokens.ts`, `UI_FONT` in `inspector-viz-tokens.ts`, `cockpit/format.ts` and the Captain canvas font now resolve to the shared constants. Inline `'Source Serif 4'` literals (12 files) became `var(--font-sans)`; `font-serif` classes were dropped. The Google Fonts `@import` was deleted from `FoerOpsDashboard.tsx` and `FoerStoryDashboard.tsx`. Packages `@fontsource-variable/dm-sans`, `@fontsource/inter-tight`, `@fontsource/source-serif-4` removed (`package.json`, `package-lock.json`).
- **Mojibake fixed** in `BanditsDashboard.tsx` (4 places: `·`, `—`, `→`).
- **Docs:** `docs/DESIGN_SYSTEM.md` typography section and `ARCHITECTURE.md` §16.2 rewritten to match the code.
- **Verified:**
  - `npm run web:typecheck` and `npx tsc --noEmit` clean; `npm run web:test` 63 passed; root `npx vitest run` 579 passed (includes the 22 new typography tests).
  - Chrome sweep of 25 routes, light and dark: only Inter Variable (52.1 % of characters) and IBM Plex Mono (47.9 %) are used (before: 5 families). Only Inter (upright and italic) and Plex Mono 400/500 files were requested, and nothing came from Google. `CSS.getPlatformFontsForNode` reports Inter for the Data Estate, Lineage, Entities and Chat History headings (before: Times New Roman), with Google Fonts allowed and blocked.
- **Not done (later PRs in the plan):**
  - Mono is still used for UI chrome; sizes, weights, tracking and heading rules are unchanged; mixed 700/800 weights remain.
  - Shared `ui/*` primitives, per-screen token migration, and `.workbench-frame` `!important` rules (PR-3 to PR-15).
  - Server-side chart rendering still uses Inter Tight TTF (`lib/studio/ssr-render.ts`, `aloftDarkTheme.ts`) and is allow-listed in the guard until PR-14.
  - Default `h1–h4` rules are written in the plan but not enabled (would change unclassed headings).
  - Contrast, small-text and numeric fixes.
  - Rendered after-state was checked on stubbed data only; the first-paint font-swap shift was not measured. No commit was made.

## 2026-10-24 — Typography implementation plan

- **What:** Added `docs/audits/typography-implementation-plan.md`. It settles the font decision (Inter Variable for all readable text, IBM Plex Mono for machine text only; DM Sans, Inter Tight and Source Serif 4 retired) and gives a role map for every kind of text. It also has screen-by-screen assignments for every route, shared-primitive changes, the code layout (`typography.css`, `tokens.ts`, type components) and a 16-PR delivery sequence with effort estimates and acceptance checks.
- **Why:** Follow-up to the typography audit: one concrete typography assignment for every place in the app before implementation starts.
- **Verified:** Per-file typography counts (7,178 declarations in 220 files) and shared `ui/*` primitive classes were read from source. Confirmed from the build that only upright Inter ships, so current Inter italics are synthesised.
- **Not done:** Plan only. No code, fonts, tokens or theme settings changed.

## 2026-10-24 — Jobs docs: versioning and incremental policy

- **What:** Added `docs/jobs/versioning-and-incremental.md`; linked from `current-status.md`, `schema-harvest-guide.md`, `AGENT_INSTRUCTIONS.md`, `README.md`.
- **Why:** User principle — incremental harvest is good when each re-run keeps version history (T1 profiles, T2 semantic cards).
- **Verified:** Code paths `saveProfile` / `persistCard` append monotonic `version`; T2 skip leaves latest card in place.
- **Not done:** Versioned T0 structural snapshots; T1 stale-only incremental.

## 2026-10-24 — Jobs docs: current status, schema harvest, session logging for agents

- **What:** Added `docs/jobs/` — `README.md`, `current-status.md` (tier incremental/overwrite snapshot), `schema-harvest-guide.md` (single `catalog.schema.*` harvest), `AGENT_INSTRUCTIONS.md`, `session-log.md`. Updated `AGENTS.md`, `CLAUDE.md`, `docs/estate-jobs.md`, remediation charter cross-links.
- **Why:** User wants easy per-schema harvest, run-only-what’s-needed + optional overwrite, full job status documentation, and mandatory per-session logs for Claude/Cursor on this workstream.
- **Verified:** Docs cross-linked; agent checklist references CHANGELOG + session-log.
- **Not done:** No code; P0-3 and one-click schema harvest UI still open.

## 2026-10-24 — Harvest jobs remediation charter (cockpit UX + phased fixes)

- **What:** Added `docs/audits/harvest-job-pipeline-remediation-charter.md` — vision, UX spec (pipeline strip, 4-step launch wizard, copy/vocabulary), four engineering phases mapping all P0–P3 issues from the register, technical anchors (`planEstateSplit`, `JobScope`), tests and governance. Linked from `harvest-job-pipeline-issues.md`.
- **Why:** User asked for a charter to fix audit issues and make Jobs a clear, non-confusing cockpit.
- **Verified:** Issue IDs cross-walked against `harvest-job-pipeline-issues.md` §4–7.
- **Not done:** No application code; wizard and APIs not built.

## 2026-10-24 — Harvest job pipeline audit (T0 launch modal field report)

- **What:** Updated `docs/audits/harvest-job-pipeline-issues.md` — expanded P0-3/P1-1/P1-7/P2-16, added P1-20 (exclude tree vs Focus), new symptom→issue rows, §13 operator field report (T0 blocked with valid Focus e.g. `curated_db.<schema>*`), code touchpoints for a fix PR.
- **Why:** Operator hit “No objects in scope” with discovery objects visible and a correct-looking Focus glob; triage showed launch gate uses Scanned rows only, not operator misconfiguration.
- **Verified:** Cross-checked `jobs.tsx`, `plan/route.ts`, `launch/route.ts`, `queue.ts` `planSplit`, `harvest.ts` `runT0Harvest`.
- **Not done:** No application fix for P0-3; T0 plan/assert still Scanned-only.

## 2026-10-24 — Typography and font system audit

- **What:** Added `docs/audits/typography-audit.md` (12-section report: font inventory, 17 verified findings TYP-01…17, 6 design recommendations, font shortlist, proposed token table, implementation architecture, phased roadmap, acceptance criteria) and nine screenshots in `docs/audits/typography-audit-assets/`.
- **Why:** The UI feels like fonts were applied without a plan. The audit establishes the cause before anything is changed.
- **Headline findings:** `Source Serif 4` and `Inter Tight` are named in ~100 places but never imported, so Estate, Lineage, Entities, Chat History and BORN headings render in Times New Roman; FOER loads them from Google Fonts via inline `@import`; three sans families and no type scale (39 distinct sizes, 71 % of text ≤ 13 px); Plex Mono used for UI chrome with faux bold.
- **Verified:** Source and `web/dist` CSS read; Chrome (playwright-core, API stubbed with `web/e2e/fixtures.mjs`) swept 25 routes in light and dark, checked the painted font with `CSS.getPlatformFontsForNode` (Google Fonts allowed and blocked), measured contrast heuristically on 6 routes, and checked 390/820 px overflow.
- **Not done:** No application code, fonts, theme settings or tokens changed; none of the recommendations are implemented. A font decision (D-1) is awaiting review. Not tested: real data, macOS/Linux, screen readers, dark-mode contrast on Estate Jobs, font-swap layout shift. The probe scripts were not committed.

## 2026-10-24 — Knowledge base design report

- **What:** Added `docs/reports/ALOFT knowledge base design.md` — design for one typed, governed knowledge layer: eleven knowledge types with trust tiers, a `kb_index` retrieval projection on Aurora (RLS, tsvector + trigram + vector fused by RRF, governance priors, one-hop edges), a 12k-token context envelope, five `kb_*` agent tools, governance rules, an evaluation harness, twelve fix-first defects with file citations, and four build phases with exit criteria. Also added `docs/research_notes/ALOFT knowledge base design/aloft_current_state.md` (code inventory of knowledge stores).
- **Why:** User asked for deep research on what knowledge base ALOFT needs and how to build it.
- **Verified:** Synthesised from the five research-note files. Spot-checked the top defect against code: T3 writes a summary-less `observed` card as newest version (`src/lib/context/usage.ts` 414–424) and readers take the newest card regardless of status (`src/lib/context/describe.ts` 290–301, `src/lib/context/embed.ts` 172–181).
- **Not done:** No application code changes. Deployed Aurora indexes, presence of `knowledge_chunks` rows, and model citation support remain unverified. The cross-org embedding upsert risk (fix #2) is low in practice because subject IDs are UUIDs.

## 2026-10-24 — Research notes: agent memory, context engineering, knowledge governance

- **What:** Added `docs/research_notes/ALOFT knowledge base design/agent_memory_context_governance.md` — cited notes on context engineering (Anthropic context-engineering, tools and Agent Skills posts; Manus KV-cache and file-system-as-memory lessons; LangChain write/select/compress/isolate; OpenAI Agents SDK sessions/trimming/summarization; Chroma context rot), memory systems (Letta core/archival + sleep-time agents, Mem0, Zep/Graphiti bi-temporal graph, LangMem memory types, ChatGPT memory, Claude memory tool, LongMemEval/LoCoMo), retrieval tool design and MCP primitives, prompt-injection and memory-poisoning governance (OWASP LLM01:2025, spotlighting, lethal trifecta, design patterns, AgentPoison, MINJA, tenant-scope findings), and knowledge lifecycle (invalidation, conflict surfacing, 2026 preprints TEPA/TRACE/StateFuse).
- **Why:** Input for designing the memory + knowledge harness of the ALOFT analytics agent platform.
- **Verified:** Every finding has an inline source link; Mem0-vs-Zep benchmark dispute and LoCoMo weaknesses flagged; 2026 preprints labelled as abstract-level reads.
- **Not done:** OWASP LLM02/LLM04/LLM08 entries, Anthropic "Building effective agents" primary page, and PII-in-context patterns not covered in depth. No application code changes.

## 2026-10-24 — Research notes: enterprise retrieval architecture

- **What:** Added `docs/research_notes/ALOFT knowledge base design/enterprise_retrieval.md` — cited notes on chunking (Contextual Retrieval, late chunking, semantic vs fixed, hierarchical), hybrid search on Postgres/Aurora (tsvector + RRF; ParadeDB `pg_search` not supported on Aurora), rerankers on Bedrock (Cohere 3.5 / Amazon Rerank pricing and regions), Bedrock embedding models and dimensions, pgvector 0.8 HNSW tuning and iterative scans, agentic / just-in-time retrieval vs long context, GraphRAG/LightRAG/LazyGraphRAG costs, incremental indexing, RLS-based permission-aware retrieval, and Claude `search_result` citations on Bedrock.
- **Why:** Input for choosing the ALOFT knowledge-base retrieval architecture (Aurora pgvector + Bedrock + Databricks).
- **Verified:** Every finding has an inline source link; vendor benchmarks flagged; gaps listed per section.
- **Not done:** No application code changes.

## 2026-10-24 — Research notes: text-to-SQL grounding / catalog knowledge

- **What:** Added `docs/research_notes/ALOFT knowledge base design/text_to_sql_grounding.md` — cited notes on the knowledge artifacts and retrieval used by Databricks Genie, Snowflake Cortex Analyst, dbt/AtScale/Looker semantic layers, Google/AWS/Microsoft copilots, academic systems (CHESS, Spider 2.0, BIRD), open-source tools (Vanna, WrenAI), large-catalog production systems (Uber, Pinterest), and feedback loops.
- **Why:** Input for designing the catalog knowledge layer of the analytics agent platform over Unity Catalog.
- **Verified:** Every finding links to a fetched source; vendor claims are labeled separately from independent benchmarks.
- **Not done:** Did not cover Cube, Dataherald, LangChain, or the DIN-SQL, MAC-SQL, and CHASE-SQL ablation papers in depth. No application code changes.

## 2026-10-24 — Research notes: KB evaluation and operations

- **What:** Added `docs/research_notes/ALOFT knowledge base design/evaluation_operations.md` — cited notes on retrieval metrics and golden-set construction, RAG grounding metrics and tools (RAGAS, TruLens, MLflow/Databricks, Bedrock, Braintrust), LLM-as-judge reliability, text-to-SQL evaluation (EX vs EM, FLEX, Spider 2.0, BIRD annotation-error audits), tau-bench pass^k, OpenTelemetry GenAI spans, CI gating, and anti-patterns.
- **Why:** Input for designing the eval-and-observability harness for the ALOFT knowledge base (text-to-SQL and document-RAG agents).
- **Verified:** Every finding has an inline source link; gaps (DeepEval/Phoenix/LangSmith docs, freshness SLOs, drift detection) are listed explicitly.
- **Not done:** No application code changes.

## 2026-10-24 — Harvest job pipeline issues audit

- **What:** Added `docs/audits/harvest-job-pipeline-issues.md` — register of P0–P3 findings for estate inventory vs Scanned context, Jobs launch/Focus/sequential chain, T3/embed scope, duplicate job rows, `scope.path` ignored at runtime, API entry-point fragmentation, orchestrator stub/success behavior, and recommended fix themes.
- **Why:** Capture the full pipeline analysis from the harvest debugging session so engineering can prioritize fixes without re-deriving issues from chat.
- **Verified:** Document only; cross-checked against `orchestrator.ts`, `queue.ts`, `harvest.ts`, `usage.ts`, `jobs/launch`, and `jobs.tsx`.
- **Not done:** No application code changes.

## 2026-10-24 — Inspector architecture HTML documentation

- **What:** Added `docs/inspector-architecture.html` — standalone browser documentation for Inspector (harness layers, end-to-end SSE flow, context stack, tools, sub-pipelines, UI composition, limits, file index). Mermaid sequence diagram via CDN.
- **Why:** Capture the Inspector execution model from the architecture review in a shareable HTML doc alongside `docs/audits/business-ai-studio-current-state.md`.
- **Verified:** Not opened in browser from this session.
- **Not done:** No changes to application code.

## 2026-10-24 — UI no longer imports `next/*` for routing, links, lazy loading or images

- **Why:** First step toward dropping Next.js. The UI is already the Vite + React Router app; Next.js only hosts the API (`src/app/api`, 158 route files), next-auth, and serves `public/spa` in production. The UI still imported `next/link`, `next/navigation`, `next/dynamic` and `next/image`, which only worked through aliases to `web/src/compat/*`.
- **What:**
  - Moved the navigation shim to `src/lib/navigation/index.ts` (`useRouter`, `usePathname`, `useSearchParams`, `useParams`, `ReadonlyURLSearchParams`; same behavior) and the link shim to `src/lib/navigation/link.tsx`. Dropped the unused `redirect` / `notFound`.
  - Rewrote the imports in 60 files under `src/components`, `src/views` and `web/src` (`next/navigation` to `@/lib/navigation`, `next/link` to `@/lib/navigation/link`). Only the import line changed.
  - `src/components/studio/StudioChart.tsx` and `src/components/agent-lab/memory/ForgettingPanel.tsx` use `React.lazy` for ECharts (ForgettingPanel now wraps it in `Suspense`). `src/components/shell/BrandMark.tsx` uses a plain `<img loading="eager">`.
  - Deleted `web/src/compat/` (the image and dynamic shims and their tests). The link/navigation tests moved to `src/lib/navigation/__tests__/` with a jsdom docblock.
  - Removed the `next/*` aliases from `web/vite.config.ts`, `web/vitest.config.ts` and `web/tsconfig.json`. `web/vitest.config.ts` now includes the `src/lib/navigation` tests. Added `src/lib/navigation` to `tailwind.config.js` `content` (required by `web/src/tailwind-content.test.ts`). Updated `web/README.md`.
- **Verified:** `npm run web:typecheck` and root `npx tsc --noEmit` exit 0. `npm run web:test` passes 62 tests; the one failure (the Tailwind content guard) was fixed and re-run green with the navigation tests. Root `npx vitest run src/lib/navigation` passes 13 tests. `npm run web:build` succeeds, `web:check-bundle` reports a clean bundle, and `web/dist/assets` contains no `next/*` references.
- **Not done:** No browser click-through. ESLint could not run: it crashes loading `eslint.config.cjs` ("Converting circular structure to JSON" in `@eslint/eslintrc`), unrelated to this change. `next-auth/react` and `next-themes` stay in the UI because they work without Next. Replacing the Next.js API server (Hono plus a new auth layer) is a separate, larger phase that hasn't started.

## 2026-10-24 — CI: single-platform ECR images (arm64 web / amd64 harvester)

- **What:** `.github/workflows/ecr-push.yml` builds **one** platform per image (not multi-arch): web defaults to **`linux/arm64`** for **t4g** Beanstalk; harvester defaults to **`linux/amd64`** for x86 Fargate. Optional repo vars `DOCKER_PLATFORM_WEB` / `DOCKER_PLATFORM_HARVESTER` to switch without code changes. Web job uses Buildx for cross-build on GHA.
- **Docs:** `docs/deploy-beanstalk.md` — t4g vs t3 platform mapping.
- **Verified:** Workflow YAML only (not run on GHA from this session).
- **Not done:** Redeploy EB after the next successful `main` build.

## 2026-10-23 — New companion: Mochi (white login-style character)

- **What:** Added a fifth companion character, Mochi, based on the "Login Character – White" sheet: a soft white sphere with big glossy black eyes, a small smile, stubby arms and feet. New `src/components/companion/Mochi.tsx` + `Mochi.module.css`; registered in `src/lib/companion/preferences.ts` (`'mochi'` in `CompanionCharacter` / `COMPANION_CHARACTERS`), `src/components/companion/Companion.tsx`, and the picker in `src/components/companion/CompanionSettings.tsx` (grid now `sm:grid-cols-3 lg:grid-cols-5`).
- **Expressions mapped to companion states:** idle = blink, glance left/right, wink (expressive also waves); reading = Listening (sound arcs, leans in); thinking = eyes up, flat mouth, dots; tools = Curious (looks around); writing = Typing (looks down at input); success = Delighted (^ ^ eyes, open smile, arms up, sparks); clarification = Confused (tilt, bigger right eye, "?"); error = Surprised (wide eyes, "o" mouth); stopped = eyes closed. The body stays white; the chosen colour tints the rim shading, shadow and effects (sparks, "?", arcs, dots). Quiet personality, off-screen and reduced motion stop animation like the other characters.
- **Verified:** `npx tsc -p web/tsconfig.json --noEmit` and root `npx tsc --noEmit` both exit 0.
- **Not done:** visual check in the browser. The running Vite server on `:3000` returns 504 for every module after the restart loop at 9:50 ("Port 3000 is already in use"), so it needs a restart. Login page still shows the canvas Captain (`src/components/login/AgentScene.tsx`) regardless of the chosen companion.

## 2026-10-23 — Dark sidebar nav surface `#16171A`

- **Change:** Data 360 Night command/rail sidebar uses `--rail-bg: #16171A` and `--rail-bg-top: #1B1C1F` in `globals.css`; `MODE_DEFAULTS.dark.rail` in `appearance.ts` matches (same as the Graphite preset).
- **Verified:** Not run in browser.
- **Not done:** Main canvas stays `--main-bg: #121314`; only the sidebar rail uses `#16171A`.

## 2026-10-23 — Dev: next-auth CLIENT_FETCH_ERROR during Vite restart

- **Cause:** `[next-auth][error] CLIENT_FETCH_ERROR` / `Failed to fetch` on `/api/auth/session` when the Vite dev server fully restarts (e.g. after editing `appearance.ts` while it was imported from `vite.config.ts`). The `/api` proxy is down for a few seconds; the next lines in the log usually show `GET /api/auth/session 200` again.
- **Fix:** Moved `APPEARANCE_BOOT_SCRIPT` to `src/lib/theme/appearance-boot-script.ts` so routine `appearance.ts` edits only HMR, not a full Vite restart.
- **If it keeps failing:** Use `npm run dev:all`, open **http://localhost:3000**, wait until `[api] ✓ Ready`, then refresh once.

## 2026-10-23 — Dark shell: sidebar, header, and page share one surface stack

- **Problem:** In Data 360 Night, the command sidebar used navy (`#0B1426`) while the header and dashboard used neutral graphite (`#121314` / `#151617`), so dark mode looked like three different themes.
- **Fix:** Theme v2 in `src/app/globals.css` sets `--rail-bg` / `--rail-bg-top` from `--shell-bg` / `--main-bg` in light and dark; header uses `--main-bg` and `--line-1` (removed the semi-transparent header override). `MODE_DEFAULTS` rail hexes in `appearance.ts` match the shell defaults. Midnight remains available under Colors → Sidebar for users who want a navy rail.
- **Verified:** Not run in browser.
- **Not done:** Custom `railDark: #0B1426` in localStorage still forces navy by design.

## 2026-10-23 — Dark mode uses the dark sidebar (not light Sage)

- **Problem:** Choosing Dark while a light sidebar color was saved (legacy single `rail` in `localStorage`, often Sage `#E3E9DE`) kept applying light `--rail-*` inline styles on `<html>`, so the command sidebar stayed beige while the main canvas was Data 360 Night.
- **Fix:** `resolveRailHex()` in `src/lib/theme/appearance.ts` applies legacy light rails in light mode only and legacy dark rails in dark mode only; new `railLight` / `railDark` fields for explicit per-mode picks. Boot script strips stale rail vars when they do not apply. `AppearanceControls` saves sidebar color for the active theme. `AppearanceSync` re-applies on `resolvedTheme` change.
- **Verified:** `src/lib/theme/__tests__/appearance.test.ts`.
- **Not done:** Hard refresh may still show one frame of stale boot vars until React mounts; use Colors → Reset if an old pick persists.

## 2026-10-23 — Shell header row aligned across sidebar, main header, and estate nav

- **Problem:** The main `StagingHeader` was 64px tall with a bottom border, but the command sidebar workspace row was shorter and had no matching rule, so the top bar looked misaligned—especially when switching light and dark (different header vs page background on `EstateNav`).
- **Fix:** Added `--shell-header-h: 4rem` in `src/app/globals.css`. `StagingHeader`, `CommandSidebar`, and rail `StagingSidebar` (rail mark + slide-out panel title) use that height and `border-[var(--header-border)]`. `EstateNav` now uses `--header-bg` / `--header-border` and a theme-token active tab background instead of `bg-black/[0.04]` + `dark:` mix. Login top bar uses the same height (fallback `4rem` on the login-only palette).
- **Verified:** Not run in a signed-in browser (session required).
- **Not done:** Signed-in browser pass in both themes.

## 2026-10-22 — Merge `synergy-marine/main` into `feature/ui-redesign` (PR #25)

- Merged upstream `main` (`a8776e4` estate-jobs / Titan bulk embeds, SSO-only auth, `typecheck` script) into the ui-redesign branch to clear GitHub merge conflicts.
- **Kept ui-redesign:** Vite login (`src/views/login.tsx`), Titan-only catalog embed path (`embedWithTitan` / `embedBulkWithTitan`), redesigned Jobs UI (`src/views/agent-lab/estate/jobs.tsx`), workbench/inspector UI, API 401 JSON via `src/proxy.ts`.
- **Integrated from main:** `npm run typecheck`, merged auto-resolved context files (`mapping.ts`, `silo.ts`, `knowledge/embed.ts`, `log-agent-cost.ts`, `middleware/auth.ts`, `scripts/context/backfill-t2.ts`, `users/route.ts`), harvester task env (`XAI_MODEL`, `CONTEXT_HARVEST_MODEL`, Foundry endpoints) while keeping `HARVESTER_VERSION=ch4`.
- **Removed:** `src/app/login/page.tsx` (deleted on ui-redesign; login is the Vite route only).
- **Verified:** `npm run typecheck` exit 0 after merge.
- **Not done:** full `vitest` / `web:test` on this Windows host (runner `describe`/`config` failures appear environmental, not merge-specific); browser smoke of Jobs and login.

## 2026-10-22 — Prompts and Evals removed from the sidebar

- Removed the Prompts and Evals items from the Build group in `src/components/agent-lab/staging/nav-config.ts`.
- The pages stay reachable at `/agent-lab/ops/prompts` and `/agent-lab/ops/evals`. They are just no longer in the nav.
- **Verified:** the Build group in `nav-config.ts` now ends at History. Browser check of the signed-in sidebar was not run.


## 2026-10-22 — Jobs API no longer returns the login page as JSON

- **Cause:** a signed-out `fetch('/api/agent-lab/context/jobs/queued')` was answered with `307` to `/login`. The browser followed it and got `index.html` (`<!doctype html>`) with status 200, then `res.json()` threw `Unexpected token '<'`. The same happened for the jobs summary, dates and list calls. `src/proxy.ts` used `withAuth`, which always redirects.
- **Fix:** `src/proxy.ts` now returns `{ error: 'UNAUTHORIZED' }` with status 401 for a signed-out `/api/**` call. `/api/auth/*` and `/api/health` stay public via the existing matcher. `src/views/agent-lab/estate/jobs.tsx` reads JSON only when the response content type is JSON, so a bad body cannot throw on the 15s poll.
- **Verified:** `curl` against the running dev server (`localhost:3000` and `:3001`) now returns `401` and `{"error":"UNAUTHORIZED"}` for `/api/agent-lab/context/jobs/queued` with no session. Before the change the same call was `307` to `/login` and, followed, `200` HTML.
- **Not done:** a signed-in browser pass of the jobs page. The console stack that names `src/app/(agent)/agent-lab/estate/jobs/page.tsx` and Next.js 15.5.20 is the older app at `C:\ALOFT\aloft-d360`, which is not the server running here.

## 2026-10-22 — Fix the production build: harvester LLM file was UTF-16

- **Deployment error:** `npm run build` (`next build`, the step the Docker image runs) failed with `Turbopack build failed` on `src/lib/context/harvester-llm.ts`: `invalid utf-8 sequence`. The committed file is UTF-16 LE (BOM `FF FE`). Turbopack only reads UTF-8, so the image build, and therefore the Elastic Beanstalk deploy, stops there.
- **Fix:** rewrote `src/lib/context/harvester-llm.ts` as UTF-8. The text is unchanged (compared against the committed UTF-16 bytes, line endings normalized). A scan of `src`, `web`, `packages`, `prisma`, and `scripts` found no other UTF-16 source file.
- **Type error:** root `tsc` failed with `Cannot find module '@radix-ui/react-switch'` because the local install of that package (and `@radix-ui/react-collection`, `react-focus-scope`, `react-portal`) had only `dist/index.js` and was missing the type declarations. Restored those four folders from the published npm tarballs. This is a local `node_modules` repair, not a source change. A fresh `npm ci` in Docker already gets the complete packages, so this was not the deploy failure.
- **Verified:** `tsc --noEmit --incremental false` exit 0. `npm run build` with `WEB_SKIP_BUILD=1` (Vite output already built) exit 0: compiled, TypeScript finished, static pages generated. Next.js added `.next-deploy-check` includes to `tsconfig.json` because the check used `NEXT_DIST_DIR`; that edit was reverted and the temporary output directory removed.
- **Not done:** a Docker image build and an Elastic Beanstalk deploy. Next.js printed a warning that React 18 support is deprecated in Next.js 16; the build still succeeded.

## 2026-10-22 — Remove leftover Next.js frontend files after the Vite cut-over

- **Removed:** `src/app/icon.png` and `src/app/icon.svg`. These were Next metadata icon routes and are unused because Next renders no pages. Also removed the create-next-app starter SVGs `public/{next,vercel,file,globe,window}.svg`, which nothing references.
- **Moved:** `src/app/favicon.ico` to `public/favicon.ico`, so the browser's automatic `/favicon.ico` request still resolves in production and now also resolves in Vite dev.
- **Removed dead `export const metadata` and the `next` `Metadata` import** from `src/views/agent-lab/{teach/index,teach/digest,memory/index,memory/contributions}.tsx`. The same titles are already set as `handle.title` in `web/src/router.tsx`. Updated the outdated route-table comment in that file.
- **Kept on purpose:** Next.js is still the API and auth server, so `src/app/api/**`, `src/proxy.ts`, `next.config.ts`, `next-env.d.ts`, and the `next`, `next-auth` and `eslint-config-next` packages stay. `src/app/globals.css` stays because `web/src/main.tsx` imports it. The `next/link`, `next/navigation`, `next/dynamic` and `next/image` imports in about 60 UI files stay too; Vite maps them to the shims in `web/src/compat`.
- **Verified:** `tsc -p web/tsconfig.json` is clean. Root `tsc` shows only the existing `@radix-ui/react-switch` error. `npm run web:test` passed 9 files / 61 tests, and `npm run web:build` succeeded.
- **Not done:** rewriting the `next/*` imports to `react-router` and dropping the compat shims. `next build` and the browser were not re-run.

## 2026-10-22 — Login page drops the Particles switch

- Removed the “Particles: always / on action” button from the login header (`src/views/login.tsx`).
- The aura stays on the default: visible during sign-in, errors, and clicks, hidden while the page is idle. A saved `login-particles` preference is no longer read.
- **Verified:** `/login` in the browser shows the header without the Particles switch. Idle page has no floating motes; they still run on sign-in, error, and click.

## 2026-10-22 — Agents list and chat look like a conversation

- `/agent-lab/agents` is a searchable card grid: avatar, class, status, Chat / View / Edit (`src/views/agent-lab/agents/index.tsx`).
- Opening an agent fills the page as a chat: header, starter prompts, message thread, and a composer pinned to the bottom (`src/views/agent-lab/agents/use.tsx`).
- **Verified:** components read for structure. Opening `/agent-lab/agents` in a fresh browser stopped at the Microsoft login screen, so the signed-in layout was not clicked through.
- **Not done:** chat threads are still kept in the browser tab only.

## 2026-10-22 — Saved workbench agents can be used, viewed, and edited later

A commissioned agent stays available after you leave the Workbench.

- **Agents list** at `/agent-lab/agents` (sidebar Build → Agents, and an Agents button in the Workbench). Each row has Use, View, and Edit.
- **Use** opens `/agent-lab/agents/:slug` and chats with the saved instructions and the same read-only data tools as a test run. The conversation is kept in this browser tab only.
- **View** is the existing catalog page (`/docs/agents/:slug`), which now links to Use and Edit.
- **Edit** reopens the Workbench session. The blueprint is no longer locked after commission. Panel edits and later builder turns write back to the catalog agent and the platform agent. The catalog slug does not change when the name changes.
- Files: `src/app/api/agent-lab/agents/route.ts`, `src/app/api/agent-lab/agents/chat/route.ts`, `src/views/agent-lab/agents/{index,use}.tsx`, `src/lib/construction/{catalog-sync,persist-commissioned,prompts}.ts`, `src/app/api/agent-lab/{construction/route,workbench/chat/route,workbench/commission/route}.ts`, `src/components/workbench/{ConfigPanel,WorkbenchShell}.tsx`, `src/components/docs/AgentDocPage.tsx`, `src/components/agent-lab/staging/nav-config.ts`, `web/src/router.tsx`.
- **Verified:** `src/lib/construction/__tests__/catalog-sync.test.ts`. Route table updated (`web/src/router.test.tsx`, `web/e2e/smoke.mjs`).
- **Not done:** no publish step, no automatic agent routing in Inspector, and chat threads are not stored on the server. Agents commissioned before this change have no `platformAgentId`; edits still find the platform row by the `<slug>-runtime` slug.

## 2026-10-22 — Port today's estate-jobs changes to the ui-redesign Jobs section

- **Source:** `feature/estate-jobs` (uncommitted work in the `aloft-d360` checkout, plus commit `a8776e4`). Ported as commit `292d5ca`.
- **Embedding coverage UI** (applied cleanly with a 3-way merge onto the redesigned components):
  - `src/components/estate/JobDetailDrawer.tsx`: embed jobs show a note that stats are per-run deltas, not estate totals. The note uses the `--text-muted` theme token so it reads correctly in light and dark themes.
  - `src/components/estate/ScannedObjectsTab.tsx`: shows table and column vector totals; the Embed tier label now says "tables with object-level vectors".
  - `src/lib/context/embedding-presence.ts` (new), `src/lib/context/reads.ts`, `src/lib/dashboard/summary.ts`: `EXISTS … embedding IS NOT NULL` replaces the brittle `e.org_id` join. Estate discovery joins by source and path. The scanned API returns `embeddingTotals`.
- **Bulk embeds** (`a8776e4`, adapted):
  - `src/lib/azure/embed-client.ts`: new `embedBulkWithTitan`, with concurrency set by `EMBED_BULK_CONCURRENCY` (1–16, default 8). The Titan region now also honours `BEDROCK_REGION`.
  - `src/lib/context/embed.ts`: `embedSubjects` queues changed rows and embeds them concurrently.
  - Deliberately **Titan-only** (no OpenAI fallback): catalog search only compares vectors from the same model, so OpenAI fallback rows would be invisible to search.
  - `scripts/context/embedding-audit.ts` copied as-is.
- `infra/context/deploy-notes.md`: added a note on bulk embedding and region. `task-definition.json` kept as-is on this branch (it already sets `BEDROCK_REGION`; ui-redesign runs harvester `ch4`, not main's `ch5-titan-embed-bulk`).
- **Verified:** new `src/lib/azure/embed-client.test.ts` (order preserved, null on failure, concurrency limit respected, empty batch) passes 3/3. Root `vitest run` passes 68 files / 533 tests (run before the new test was added). `tsc -p web/tsconfig.json` is clean. Root `tsc` shows only the existing `@radix-ui/react-switch` error.
- **Not done:**
  - No browser check of the Jobs drawer or the Scanned tab.
  - No live embed job run.
  - The untracked ops scripts in `aloft-d360` (`embedding-by-source`, `job-inspect`, `list-embed-jobs`, etc.) were not ported.
  - The knowledge-base embedding path (`embedWithFallback`) was left on OpenAI.

## 2026-10-22 — Restore pre-integration work dropped when stash@{0} was never re-applied

- **What happened:** the wip stash `dceacb5` ("wip before estate-jobs merge 2026-10-21") was taken before the Jobs/estate cherry-picks (`0b0e8ae`, `a6a8f6b`, `22ae77b`) and never popped, so 25 tracked-file changes and 10 new files were missing from `feature/ui-redesign`.
- **Restored (commit `afdbef1`, exact file contents from the stash):**
  - Companions: character picker Nova / Orbit / Lumi / Captain (`src/components/companion/{Companion,Wobble,useAnimateWhenVisible}.*`, `Captain*`, `CompanionSettings.tsx`, `src/lib/companion/preferences.ts` with v1→v2 migration, `useCompanionPreferences.ts`, `PromptCanvas.tsx`); companion colour follows the app accent; account menu auto-closes (`UserMenu.tsx`, `AppearanceControls.tsx`).
  - Workbench agent planning: first-turn schema research, active tool catalog, `select_agent_class` / `select_agent_tools` builder tools that respect user locks (`src/app/api/agent-lab/workbench/chat/route.ts`, `src/lib/construction/{builder-tools,prompts}.ts`, `FieldEditors.tsx`).
  - Catalog integrity: paged `resolveScope` and scope-safe drop logic (`src/lib/context/{databricks-adapter,harvest,scope-match,dispatch}.ts`).
  - Embeddings/search: Bedrock Titan v2 embeddings, always-on vector retrieval with ranked hybrid results (`src/lib/azure/embed-client.ts`, `src/lib/context/{embed,describe,keywords,search-ranking}.ts`).
  - Docs and tests: `docs/{creating-agents,ops-failure-log,commissioned-agent-usage-brainstorm,incident-2026-10-18-catalog-mass-drop}.md`, plus the stash's tests.
- `src/components/login/AgentScene.tsx`: login robot LED eyes painted `#fff` again (the stash's white-eyes fix); the 2026-10-22 login text changes were kept as they are.
- Historical stash entries (2026-10-20/21) inserted below in date order.
- **Kept:** all Jobs/estate work from main (no Jobs/estate file is in the restore set; the only shared file was this changelog).
- **Verified:** done first in an isolated worktree. Root `vitest run` 68 files / 533 tests passed. Web `vitest` 9 files / 61 tests passed. `tsc -p web/tsconfig.json` clean. Root `tsc --noEmit` shows only the existing `@radix-ui/react-switch` error, which is also present before the restore.
- **Not done:**
  - No signed-in browser check of the Workbench or the companion picker.
  - Bedrock credentials and live catalog search were not exercised.
  - Upstream `synergy-marine/main` changes are not reconciled: Titan-first embedding fallback (`a8776e4`), the `typecheck` script (`778ad37`), SSO-only login (`00c507d`).
  - `stash@{0}` has not been dropped.

## 2026-10-22 — Remove personalized returning-user login welcome

- `src/views/login.tsx`: login page always displays “Welcome to Agent Lab”; removed the saved-name greeting and “Not [name]?” control.
- `src/components/login/AgentScene.tsx`: removed the returning-user name from the robot's greeting and props; the generic greeting remains.
- **Why:** keep the login welcome consistent and avoid displaying a remembered first name.
- **Verified:** `git diff --check` passed; a focused search found no returning-user greeting or name-specific control in the login page/robot. TypeScript check reached an unrelated existing failure because `@radix-ui/react-switch` is missing.
- **Not done:** no browser visual check.

## 2026-10-22 — Remove login robot's HI visor message

- `src/components/login/AgentScene.tsx`: stopped scrolling “HI” greetings across the login robot's visor, including initial, returning-user, typing, and wake-up greetings. The robot's expressions and screen-reader announcements remain unchanged.
- **Why:** keep the robot's expression visible without the greeting text on its LED face.
- **Verified:** `git diff --check` passed; TypeScript check reached an unrelated existing failure because `@radix-ui/react-switch` is missing. Focused ESLint could not run because the repository config crashes while formatting a circular configuration.
- **Not done:** no visual browser check.

## 2026-10-21 — Estate inventory + source scope (Synergy `main` / PR #23)

- `src/lib/context/estate.ts`: partial inventory no longer soft-deletes unscanned catalogs (`catalogsSeen`).
- `GET` / `PATCH` / `POST` `src/app/api/agent-lab/context/sources/[id]/route.ts`; facets `?sourceId=`; restore scripts under `scripts/context/`.
- Cherry-picked onto `feature/ui-redesign` as commit `c0a7657`.

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

## 2026-10-21 — Login robot eyes stay white across themes

**Changed:** [AgentScene.tsx](../src/components/login/AgentScene.tsx) now paints the login robot's lit LED pixels and glow explicitly white instead of inheriting the companion accent. The earlier login greeting change also keeps the visor text at `HI` rather than appending the user's name; screen-reader greetings remain personalized.
**Why:** Keep the login robot's eyes white regardless of theme or companion color preference.
**Verified:** `npm.cmd run web:typecheck` passed. Browser DOM/computed-style checks under both light and dark root classes, with the inherited companion color overridden to red: lit pixels and glow remained white. The shared browser tab was hidden, so animation frames were advanced explicitly for these checks. Targeted ESLint could not run because the existing configuration throws a circular-JSON error.
**Not done:** No changes to other companions, particle colors, expressions, or screen-reader greetings.

---

## 2026-10-20 — Documented: how commissioned agents are used (brainstorm)

**What changed:** New [commissioned-agent-usage-brainstorm.md](./commissioned-agent-usage-brainstorm.md). Docs only, no code.
**Why:** After COMMISSION the agent is a catalog `draft` and is only reachable via Try → plain Inspector. The Inspector hint `aloft.catalogAgent.slug` is written but never read, nothing routes a question like "Latest SIRE observations for IMO N" to an agent, and there is no publish step.
**Verified:** By reading the code (`commission/route.ts`, `ConfigPanel.tsx`, `views/agent-staging/try.tsx`, grep for the hint key). Not exercised in the UI.
Also added option E: an agent gallery ("app store") with sharing. `/docs/agents` is only a searchable list today, and `agent_catalog` has no visibility or share model.
**Not done:** Explicit agent pick in Inspector, automatic routing, runtime chat, publish lifecycle, gallery and sharing. Options and open questions are in the doc.

---

## 2026-10-20 — Harvester no longer drops tables it did not see (SIRE tables restored)

**Problem:** Workbench said `sire_report` was not in the catalog. `landing_zone_dev.sire_2_0.sire_report` was harvested in July and has a semantic card. But a full T0 sweep on 2026-10-18 18:36 (source `b491…`, scope `open_analytics_zone.*.*`) marked 1,387 objects `dropped`, leaving exactly 1,000 active. The Estate inventory showed every one of the 1,554 dropped objects as still active. Two bugs caused this:
1. `DatabricksAdapter.resolveScope()` listed `information_schema.tables` with no row limit, so the 1,000-row `DATABRICKS_MAX_ROWS` default silently truncated the listing. It saw 1,000 tables, so the rest of `open_analytics_zone` was treated as deleted (190 dropped in that catalog at restore time).
2. The full-sweep drop pass in `harvest.ts` dropped every active object missing from the sweep, including objects outside the (narrowed) scope. That removed `landing_zone_dev`, `reporting_layer`, `curated_db` and other catalogs. The scoped branch matched on schema name only, across catalogs, and compared against the budget-capped harvested set.

**Changes:**
- `src/lib/context/databricks-adapter.ts`: `resolveScope()` pages the listing (`ORDER BY … LIMIT 1000 OFFSET n`, explicit `rowLimit`). A failed page discards that catalog's refs, so a partial listing never reaches the drop pass.
- `src/lib/context/scope-match.ts`: new pure `selectDroppedPaths()`. An object is dropped only if it is inside the sweep's include/exclude scope, its `catalog.schema` was actually listed, and it is absent from the resolved listing.
- `src/lib/context/harvest.ts`: both drop branches are replaced by `selectDroppedPaths()` over the resolved refs, not the harvested set. Updates are chunked by id, and the step logs a drop-pass summary.
- `src/lib/context/scope-match.test.ts`: 4 tests (narrowed scope, unlisted schema, empty listing, excludes).

**Data fix (prod-writer DB, user-approved):** set `lifecycle='active'` on the 1,554 dropped objects whose Estate row is active. Embedded 742 restored objects with Titan v2: 0 failed, 22 skipped as unchanged. Active objects 1,000 → 2,554; Titan-embedded active objects 467 → 1,520.

**Verified:**
- `vitest run src/lib/context` passes (10 tests).
- `tsc` shows only the existing `@radix-ui/react-switch` error.
- Live `describe_schema research`:
  - "sire_report" returns `landing_zone_dev.sire_2_0.sire_report` first (0.52), then `q88_report` and `classnk_report_metadata`.
  - "SIRE inspection report observations findings vessel IMO" also returns `sire_report` first.
- `describe` on `sire_report` returns its card.

**Not done:**
- 1,034 active objects still have no semantic card or embedding.
- The 2 jobs stuck `running` since 2026-10-18 and 49 queued T0 jobs are untouched.
- The Workbench conversation was not re-run in the UI.

**Incident write-up (timeline, root cause, actor findings, follow-ups):** [incident-2026-10-18-catalog-mass-drop.md](./incident-2026-10-18-catalog-mass-drop.md). Ops tracking: `ops-failure-log.md` **F-005**. Still open: `scripts/context/orchestrator.ts` ignores the Estate `scope.path`, so per-table harvest requests run source-wide, and queued `{path}` jobs will likely not harvest their table.

---

## 2026-10-20 — Catalog/memory embeddings back on Bedrock Titan v2; vector search fixes

**Why:** Analysis of Workbench session `41cb8ff9…` showed vector search returning noise: all 13,508 stored catalog
vectors (and agent-memory vectors, written Jun–Jul) are `amazon.titan-embed-text-v2:0`, but since the Oct 12 refactor
query embeddings came from Azure OpenAI `text-embedding-3-large`. Cross-model cosine scores were ~0.03–0.10 (random),
e.g. "mintra training courses" → defect/purchase tables in Inspector. Inspector's apparently good results came from
keyword routing (which skipped vectors and labelled keyword hits "semantic"), not from Azure embeddings.
Search also returned `dropped` objects that `describe` cannot open (every candidate showed `inspected:false`).

**Changes:**
- `src/lib/azure/embed-client.ts` — new `embedWithTitan()` (Bedrock Titan v2, 1024-dim, normalized). Uses a Bedrock
  API key (`AWS_BEARER_TOKEN_BEDROCK` / `BEDROCK_API_KEY` / `BEDROCK_MANTLE_API_KEY`) as bearer auth, else the AWS SDK
  credential chain. Region `BEDROCK_EMBED_REGION` (default `us-east-1`). The IAM key in `.env` is rejected by AWS
  (`UnrecognizedClientException`); the Bedrock API key works. `embedWithFallback` (OpenAI) is unchanged and still used
  by the knowledge base, whose vectors are OpenAI.
- `src/lib/context/embed.ts` — catalog ingest and `embedQuery` (catalog, memory, intent, estate briefing) use Titan;
  `CURRENT_EMBEDDING_MODEL` is now the Titan id.
- `src/lib/context/describe.ts` — vector search only compares vectors of the query model and only active objects;
  result candidates are restricted to active objects; responses include `vector_index` health (active objects,
  comparable embeddings, other-model embeddings).
- `src/lib/context/search-ranking.ts` — vector hits below `MIN_SEMANTIC_SIMILARITY` (0.15) are discarded.
- `src/lib/context/dispatch.ts` — `research` notes say when the index is empty/incompatible or sparse.

**Verified:** ran the real `describe_schema research` path against the dev server's DB: Titan query embeddings,
related tables score 0.2–0.33, all candidates active and inspected (columns returned). Unrelated queries now return
0 vector hits instead of noise. Focused tests pass (42); `tsc` shows only the existing `@radix-ui/react-switch` error.

**Data fix (run 2026-10-20, with user approval):** embedded the 460 active catalog objects that had semantic cards but
no Titan vector (460 embedded, 0 failed) against the DB the dev server uses (`.env`'s last `DATABASE_URL`,
aloft-prod-writer). Index coverage went from 7 to 467 of 1,000 active objects. "AI inspection agent for vessel
inspections, PSC, ISM audits, deficiencies and corrective actions" now returns `vw_audit_and_inspection`,
`vw_audit_inspection_testing`, `vw_corrective_action`, `sm2_psc`, `data_audit.report_info` (similarity 0.40–0.53).

**Not done:** 533 active objects have no semantic card (T2) and so cannot be embedded yet.
`landing_zone_dev.sire_2_0.sire_report` is active in Estate but `dropped` in the harvested context; its on-demand
`t0_structural` job (2026-10-20 14:02) is one of 47 queued harvest jobs, and 2 jobs have been stuck `running` since
2026-10-18. Nothing has been processed since then, so the ECS `aloft-context-harvester` / EventBridge worker appears
to be down. The Estate harvest route also skips re-requests while `harvest_state = 'queued'`, so the UI cannot retry it.

---

## 2026-10-20 — Require semantic evidence in Workbench catalog research

Workbench catalog search now always queries the pgvector embedding index, even when keyword routing is confident, and blends vector similarity with keyword and exact-name evidence. Search responses expose the evidence signals instead of presenting lexical matches as semantic matches. The Workbench's initial research now inspects the top candidates' harvested semantic cards, columns, and relationship evidence before the builder selects sources; the prompt requires relevance justification and rejects name-only matches. Files: `src/lib/context/search-ranking.ts`, `src/lib/context/search-ranking.test.ts`, `src/lib/context/describe.ts`, `src/lib/context/dispatch.ts`, `src/app/api/agent-lab/workbench/chat/route.ts`, `src/lib/construction/prompts.ts`, `docs/creating-agents.md`.

Verified: focused search-ranking, keyword, and construction tests pass (37 tests); `git diff --check`. Root TypeScript check remains blocked by the missing `@radix-ui/react-switch` package, and ESLint remains blocked by its existing circular React plugin/config error. Not done: live vector-database/Estate lookup, signed-in Workbench flow, or warehouse test run.

---

## 2026-10-20 — Match natural-language catalog searches to underscored table paths

Fixed harvested-catalog name matching so natural-language queries such as “there is a table called SIRE report” are
tokenized into meaningful terms and matched against each term in a catalog path like
`landing_zone_dev.sire_2_0.sire_report`. Previously, schema search compared the full input phrase against the table
name/path, so spaces and conversational words prevented this existing harvested object from being found.
Files: `src/lib/context/keywords.ts`, `src/lib/context/describe.ts`, `src/lib/context/keywords.test.ts`.

Verified: focused keyword and construction tests pass; `git diff --check` passes. Live search against the shared Estate
catalog is not available in this environment.

---

## 2026-10-20 — Workbench agent research and planning

Workbench chat now searches the harvested catalog for a new mission, exposes catalog-only schema research to the builder,
and gives it active tool inventory plus explicit class/tool selection actions. Confident mission-to-class matches are
saved into the blueprint; user-owned class/tool edits remain protected. Updated the Workbench tools panel copy and the
agent-creation capability note. Files: `src/app/api/agent-lab/workbench/chat/route.ts`,
`src/lib/construction/prompts.ts`, `src/lib/construction/builder-tools.ts`,
`src/lib/construction/__tests__/user-edits.test.ts`, `src/components/workbench/config/FieldEditors.tsx`,
`docs/creating-agents.md`.

Verified: focused construction tests passed (32 tests). Root TypeScript check is blocked by the existing missing
`@radix-ui/react-switch` dependency in `packages/aloft-shared/src/components/ui/switch.tsx`; ESLint is blocked by the
existing circular React plugin/config error.
Not done: no signed-in browser flow, live LLM/catalog lookup, or Databricks test run.

---

## 2026-10-20 — Wobble companion, login greeting, account menu auto-close

1. **Wobble companion (Nova concept).** New `src/components/companion/Wobble.tsx` + `Wobble.module.css`: SVG blob with
   glossy eyes, same `CompanionState` states as Captain — idle (blink, float when expressive), reading (pulse + listening
   waves), thinking (slow tilt, eyes up), tools (focused squint + wobble), writing (bob, eyes down), success (happy arcs,
   bounce, sparks), clarification (tilt, one eye bigger), error (worried brows), stopped (closed eyes). Respects
   personality `quiet`, reduced motion, and pauses off screen / in background tabs.
   `Companion.tsx` picks Wobble or Captain from a new `character` preference (`src/lib/companion/preferences.ts`,
   default `wobble`, default colour now lavender `#b9a4ff`, which also tints the login robot's eyes).
   Used in `CaptainStatus` (chat messages) and `PromptCanvas` empty state; `CompanionSettings` gained a Character picker.
   Visibility logic moved to `useAnimateWhenVisible.ts` (shared with Captain).
2. **Login:** heading is always "Welcome to Agent Lab"; removed the "Not {name}?" link (`src/views/login.tsx`). The login
   robot's spoken greeting still uses the remembered name.
3. **Account menu:** closes 400 ms after the pointer leaves it (`src/components/shell/UserMenu.tsx`).

Verified: editor diagnostics clean on changed files. Tests updated/added in `web/src/companion.test.tsx` but **not run**
(`node_modules` install was failing locally). Not browser-checked.

**Follow-up (same day): all three characters + app accent.** `Wobble` takes `shape` = `nova` | `orbit` | `lumi`
(own body path, eye placement, and per-character motion: Orbit sways/leans/stretches, Lumi squashes and moves slower).
`character` preference is now `nova` | `orbit` | `lumi` | `captain` (legacy `wobble` → `nova`); default colour is
`accent`, so the companion follows the app accent (`--brand-a`) from the account menu. Settings shows a live preview card
per character. Motion-off rules (`quiet`, off screen) now use `!important` so state animations can't override them.

**Follow-up: companion colour uses the app accent palette.** `COMPANION_COLORS` is now "Match app accent" (default) plus
the account menu's `ACCENT_PRESETS`; `CompanionSettings` renders them as the same round swatches + rainbow custom picker
as the account menu. Browsers that already saved a companion colour keep it until "Match app accent" is picked.

**Follow-up: Captain redesigned as a glossy sphere.** `src/components/companion/Captain.tsx` + `Captain.module.css`:
white sphere, dark visor with glowing crescent eyes, glowing side ear and floor pad (all in the companion colour).
States: listening waves (reading), thinking dots + float, rotating orbit ring (tools / analyzing), spinning progress arc
(writing / executing), happy eyes + burst (success), curious tilt (clarification), lidded eyes (error), closed (stopped).
The login page's canvas robot (`AgentScene.tsx`) is unchanged.

**Fix: companion ignored the app accent for existing users.** Colours saved under the old palette (e.g. mint) kept
overriding "Match app accent". Storage key bumped to `aloft-companion-v2` (`src/lib/companion/preferences.ts`); the hook
(`src/hooks/useCompanionPreferences.ts`) reads v1 as a fallback but keeps only personality/character, so the colour
falls back to the accent. Test added in `web/src/companion.test.tsx` (not run).

**Captain colour variants.** The companion colour now tints Captain's whole shell (radial gradient from near-white to a
shaded tone, via `--cap` in `Captain.tsx`), with eyes/ear/rings glowing a lighter tint of the same colour, matching the
Ocean/Purple/Green/Amber/Red concept sheet. Not browser-checked.

**Companion follows accent changes + playful idle.** `src/components/shell/AppearanceControls.tsx`: picking (or
resetting) the app accent in the account menu now sets the companion colour back to "Match app accent", so a colour
saved earlier in companion settings no longer hides the change. Idle is now a 12s CSS loop for Captain and
Nova/Orbit/Lumi (`Captain.module.css`, `Wobble.module.css`): glance left, glance up-right with a small lean, a wink with a
happy squint, then settle; Expressive adds a gentle float/hop, Lumi runs it slower (16s). Quiet/off-screen/reduced
motion still stop it. Not browser-checked; tests not run.

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
