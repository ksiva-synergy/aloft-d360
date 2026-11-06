# Typography Implementation Plan

**Date:** 24 October 2026
**Builds on:** [`typography-audit.md`](typography-audit.md) (findings TYP-01…TYP-17, tokens in §8)
**Status:** plan only. Nothing here is implemented yet.

This plan answers one question for every place in the app: **which typography goes here, and how do we get there safely?**

---

## 1. The decision

**One sans family, one mono family.**

| Role | Font | Package (already installed) | Weights / styles to load |
|---|---|---|---|
| Everything people read | **Inter Variable** | `@fontsource-variable/inter` | `wght` 400–600 upright **and italic** (`wght-italic.css`) |
| Machine text only (code, SQL, IDs, cron, paths, hashes) | **IBM Plex Mono** | `@fontsource/ibm-plex-mono` | 400 and 500 (Latin) |

**Removed:** DM Sans, Inter Tight, Source Serif 4 (and the Google Fonts `@import` on the FOER pages).

Why this and not the alternatives (full comparison in the audit, §7):

- Inter is already installed, already loaded on every page, and handles dense tables and numbers best of the candidates. Choosing it adds no new weight, removes ~37 KB (DM Sans) and fixes the Times New Roman headings in one step.
- Restoring Source Serif 4 would add a third family to maintain for a style that exists properly on one page (FOER). The editorial feel of FOER comes from size contrast, italics and spacing. Inter can carry all three once its real italic is loaded.
- Plex Mono stays because code, SQL and identifiers need a mono, and it already matches the app.

**One correction found while planning:** only upright Inter ships today (all 7 Inter `font-face` rules in the build are `font-style: normal`). Every Inter italic on screen (e.g. the word "understand" in the Teach hero) is a synthesised slant. The plan loads the real italic.

**Brand note:** this replaces the serif described in `docs/DESIGN_SYSTEM.md`. That document is updated in PR-2 so code and docs agree.

---

## 2. The system in one table

Every piece of text in the app uses exactly one of these. A component never sets its own size, weight, line height or letter spacing.

| Token (Tailwind class / TS key) | Size | Weight | Line height | Tracking | Family |
|---|---|---|---|---|---|
| `text-display` / `type.display` | clamp(28→40px) | 600 | 1.1 | −0.02em | sans |
| `text-title-page` / `type.titlePage` | clamp(22→28px) | 600 | 1.2 | −0.02em | sans |
| `text-title-section` / `type.titleSection` | 20px | 600 | 1.3 | −0.01em | sans |
| `text-title-card` / `type.titleCard` | 15px | 600 | 1.35 | 0 | sans |
| `text-body-lg` / `type.bodyLg` | 16px | 400 | 1.6 | 0 | sans |
| `text-body` / `type.body` | 15px | 400 | 1.55 | 0 | sans |
| `text-ui-lg` / `type.uiLg` *(added for large controls)* | 15px | 500 | 1.4 | 0 | sans |
| `text-ui` / `type.ui` | 13px | 500 | 1.4 | 0 | sans |
| `text-ui-regular` / `type.uiRegular` | 13px | 400 | 1.45 | 0 | sans |
| `text-label` / `type.label` | 12px | 500 | 1.35 | 0 | sans |
| `text-caption` / `type.caption` | 12px | 400 | 1.4 | 0 | sans |
| `text-eyebrow` / `type.eyebrow` | 11px | 600 | 1.3 | +0.08em, UPPERCASE | sans |
| `text-kpi-lg` / `type.kpiLg` | 28px | 600 | 1.1 | −0.02em, tabular | sans |
| `text-kpi-md` / `type.kpiMd` | 20px | 600 | 1.2 | −0.01em, tabular | sans |
| `text-kpi-sm` / `type.kpiSm` | 15px | 600 | 1.3 | 0, tabular | sans |
| `text-code` / `type.code` | 13px | 400 | 1.55 | 0 | mono |
| `text-code-inline` / `type.codeInline` | 0.92em | 400 | inherit | 0 | mono |
| `type.chart` (TS only) | axis 11 / legend 12 / tooltip 13 | 400 | 1.3 | 0 | sans |

Plus two utilities: `tnum` (tabular numbers) and `italic` (now a real italic).

**Hard rules**

1. **Mono only for machine text.** If it is a sentence, label, tab, button, heading or placeholder, it is sans.
2. **Uppercase only via `eyebrow`.** Tabs, buttons and titles are sentence case.
3. **Weights are 400, 500, 600.** No bold (700) or extra-bold (800) anywhere.
4. **Nothing below 11 px.** 11 px is for `eyebrow` only; everything else is 12 px or more.
5. **Numbers that line up use `tnum`:** KPIs, table numerics, durations, counts, timestamps in lists.
6. **Colour comes from text role tokens** (`--ink-1/2/3`, `--brand-a-ink`, status inks), never from `opacity` on text.
7. **Light and dark use the same tokens.** The theme changes colour only.

---

## 3. Universal role map: what to use for each kind of text

This is the reference the migration follows on every screen.

### Page structure
| Place | Token | Notes |
|---|---|---|
| Hero line (Dashboard greeting, Teach prompt, FOER/BORN name) | `display` | max one per page |
| Page title (`<h1>`) | `title-page` | exactly one per page, via `<PageTitle>` |
| Page subtitle / description | `body`, `--ink-2` | max width ~70ch |
| Section heading (`<h2>`) | `title-section` | |
| Card / panel / dialog / drawer title (`<h3>`) | `title-card` | |
| Small overline above a section ("01 · Distil", "Schedules") | `eyebrow`, `--ink-3` | the only uppercase text |

### Navigation and controls
| Place | Token |
|---|---|
| Top-bar breadcrumb, current page | `ui-lg`, `--ink-1` |
| Top-bar breadcrumb, ancestors | `ui-lg` at weight 400, `--ink-3` |
| Sidebar nav item | `ui` |
| Sidebar group heading | `eyebrow` |
| Tabs (page tabs, panel tabs) | `ui`, sentence case |
| Buttons: default and small | `ui` |
| Buttons: large CTA (login, primary page action) | `ui-lg` |
| Chips, filters, segmented controls | `ui` |
| Menu items, select options | `ui-regular` (selected: `ui`) |
| Keyboard hints | `caption` + `<kbd>` in `code-inline` |

### Forms
| Place | Token |
|---|---|
| Field label | `label` |
| Input, select, textarea value | `body` (15px, so iOS does not zoom on focus) |
| Placeholder | `body`, `--ink-3` (sans, never mono) |
| Helper text | `caption`, `--ink-2` |
| Validation error | `caption`, `--bad` |
| Code / SQL / JSON editor | `code` |

### Data
| Place | Token |
|---|---|
| Table header | `label`, `--ink-2`, sentence case |
| Table cell (text) | `ui-regular` |
| Table cell (number, duration, count, date) | `ui-regular` + `tnum`, right-aligned |
| Identifier cell (schema.table, column, model id, run id, hash) | `code-inline` |
| Status badge / pill | `label` |
| Tiny count badge | `eyebrow` |
| KPI tile: label / value / delta-subtext | `label` / `kpi-lg` or `kpi-md` / `caption` |
| Inline stat in a row | `kpi-sm` |
| Chart axis, legend, tooltip | `type.chart` |
| Cron expression, path, SQL snippet inside a chip | `code-inline` |
| Log stream | `code` |

### AI conversation (Inspector, Workbench, Teach, Agent "Try")
| Place | Token |
|---|---|
| User message | `body` |
| AI answer prose | `body-lg` |
| Markdown `#` / `##` / `###` inside an answer | `title-section` / `title-card` / `ui` (600) |
| Lists and tables inside an answer | `body-lg` / table rules above |
| Inline code in an answer | `code-inline` |
| Code / SQL block | `code` |
| Tool-call row (name, status, duration) | `ui` + `caption` + `tnum` |
| Tool input / output | `code` |
| Composer input and placeholder | `body` |
| Model picker, "send / newline" hints | `ui-regular` / `caption` |
| Empty-state heading / text | `title-card` / `body` `--ink-2` |
| Suggestion prompts | `body`, italic allowed |

### Feedback
| Place | Token |
|---|---|
| Toast title / body | `ui` / `ui-regular` |
| Inline alert title / body | `title-card` / `body` |
| Empty state title / body / link | `title-card` / `body` `--ink-2` / `ui` |
| Tooltip | `caption` |
| Timestamp, "updated 2m ago" | `caption` + `tnum` |
| Error page title | `title-page` |

---

## 4. Screen-by-screen assignments

"Hits" = typography declarations found in that area's source (fontSize, fontFamily, letterSpacing, lineHeight, heavy weights, mono, uppercase, serif constants). 7,178 hits across 220 files in total; they show where the work is.

### 4.1 Login — `views/login.tsx` (8 hits)
| Element | Now | Target |
|---|---|---|
| "Welcome to Agent Lab" | DM Sans 28/600 | `title-page` |
| Sign-in buttons | 15/600 | `ui-lg` |
| Brand line "Synergy Group" | `text-sm font-semibold` | `ui` |
| Toast | `text-sm font-semibold` | `ui` |
| Captain canvas text (`AgentScene.tsx:8,497`) | DM Sans | `FONT_SANS` from `tokens.ts` |

### 4.2 Shell — `components/agent-lab/staging/*`, `components/shell/*`, `app-breadcrumb.tsx` (41 hits)
| Element | Now | Target |
|---|---|---|
| Breadcrumb | DM Sans 15 | `ui-lg` (current) / `ui-lg` 400 `--ink-3` (ancestors) |
| Sidebar group label (`StagingSidebar.tsx:141`) | 10.5px uppercase 0.08em | `eyebrow` |
| Sidebar section in CSS (`globals.css:1363-1368`) | Plex Mono 12px `!important` | delete rule; `eyebrow` |
| Sidebar title (`:142`) | `text-sm font-semibold` | `title-card` |
| Nav search | `text-[13px]` | `ui-regular` |
| User menu name / role pill / avatar initials | mixed 13/600, `text-xs font-semibold` | `ui` / `label` / `label` |
| Appearance controls headings (`AppearanceControls.tsx:46,112`) | `text-xs font-bold uppercase` | `eyebrow` |

### 4.3 Dashboard — `components/dashboard/*` (100 hits)
| Element | Now | Target |
|---|---|---|
| Greeting `DashboardView.tsx:488` | 32→36px **800** | `display` (600) |
| Subtitle | 15 | `body` `--ink-2` |
| Role badge, date | mixed | `label`, `caption` |
| KPI tile label / value / subtext (`:98,426`) | 13 / 26–34px 800 / 15 | `label` / `kpi-lg` / `caption` |
| Card title "Data Estate", "Memory" (`:202`) | `text-xl font-extrabold` | `title-section` |
| Card subtitle | 15 | `ui-regular` `--ink-2` |
| Card stat triplets (1.2K / Objects) | 22/700 + 13 | `kpi-md` + `label` |
| Progress rows label / numbers / % | 15 / 15 / 15 coloured | `ui` / `ui-regular tnum` / `ui tnum` (status ink) |
| Footer stats ("Swept 1m ago") | 15/600 | `caption` |
| Pill buttons "Explore", "Inspect" | 15/600 | `ui` |
| `MemoryCredCard.tsx` (79 hits, mono) | mono labels | labels `label`, values `kpi-sm`, ids `code-inline` |

### 4.4 Data Estate — `views/agent-lab/estate/*` (546) + `components/estate/*` (1,417)
This area is the largest and the one most affected by the Times New Roman headings.

| Element | Now | Target |
|---|---|---|
| Estate tabs (`EstateNav.tsx`) "OVERVIEW · CATALOG · …" | mono, uppercase, tracked | `ui`, sentence case: "Overview · Catalog · …" |
| "DATA ESTATE SYSTEM" (top right) | mono caps | `eyebrow` |
| Page titles (`index.tsx:153,230`, `entities.tsx:110`, `lineage.tsx:119`, `JobRunPage.tsx:1160`, `StubPage.tsx:39`) | Source Serif → **Times** 30/700 | `title-page` via `<PageTitle>` |
| Page subtitle | DM Sans 15 | `body` `--ink-2` |
| Empty state ("No sources configured") | Times serif + mono link | `title-card` / `body` / `ui` link |
| **Jobs** (`jobs.tsx`, 242 hits, 114 mono) | | |
| — "SCHEDULES" header | mono caps | `eyebrow` |
| — Schedule chip: job name / cron / next run | mono bold / mono / mono | `ui` / `code-inline` / `caption tnum` |
| — "RUN JOB" button | mono caps bold | `ui` "Run job" |
| — "JOB TYPES / SCANNED OBJECTS" tabs | mono caps | `ui` tabs |
| — Group header "01 ESTATE FOUNDATION" + subtitle | mono caps + mono | number `label tnum` + `title-card` + `caption` |
| — Job card title "ESTATE INVENTORY" | mono caps orange (2.26:1) | `title-card`, `--ink-1`; accent stays on the left bar |
| — Job card description | DM Sans 13 | `ui-regular` `--ink-2` |
| — "no runs yet", "Never run", "in 2d" | mono | `caption`; "in 2d" `label tnum` |
| **Catalog** (`catalog.tsx`, `CatalogTree`, `CatalogBrowser`, `EstateFacetTree`) | 77 % mono | tree labels `ui-regular`; object names `code-inline`; counts `caption tnum` |
| **Tables** (`EstateTable`, `ObjectTable`, `ColumnsTable`, `PreviewColumnsDrawer`, `JobsMiniTable`, `ChildJobsPanel`) | per-file sizes, mono headers | §3 table rules |
| **Object page** (`object.tsx`, `HeroSection.tsx`, `ObjectKnowledgePage.tsx`, `MonoPath.tsx`) | serif title 28/600, 13px meta | title `title-page`; path stays `code-inline`; meta `caption`; readiness numbers `kpi-sm` |
| `SemanticCard`, `UsagePanel`, `EntityModelCard`, `RelationshipList`, `RelationshipGraph` (≈ 380 hits) | inline mono and sizes | titles `title-card`, body `ui-regular`, identifiers `code-inline`, graph labels `type.chart` |
| **Job run / detail** (`JobRunPage.tsx` 170 hits, `JobDetailDrawer.tsx:383`, `LogStreamPanel`, `HarvestTimeline`) | serif titles, mono everywhere | title `title-page` / `title-card`; step names `ui`; durations `caption tnum`; logs `code` |
| **Lineage / Entities / Mapper / Silo** (`silo.tsx` 121, `mapper.tsx` 69) | serif titles, mono | as above; node labels `type.chart` / `ui-regular` |
| Badges (`KindBadge`, `LifecycleBadge`, `DataReadinessPill`, `HeroLifecycleBadge`) | mixed caps | `label` (or `eyebrow` for 1–2 letter kinds) |

### 4.5 Inspector — `components/inspector/*` (1,915) + `views/inspector/*` (73)
| Element | Now | Target |
|---|---|---|
| Local header "DATA 360 / INSPECTOR / New Session" | mono caps | `label`, sentence case (or remove: the top bar already shows it) |
| Status pills "Databricks checking…", "Catalog + BQ" | mono caps | `label`; also fix the overlap with "New" seen in the audit screenshot |
| "Session ——", "Powered by ALOFT · v0.4" | mono caps | `caption` |
| Right-panel tabs "RESULTS · SEMANTIC · DEVELOPER" | mono caps | `ui` tabs |
| Empty states (both panes) | mono | `title-card` + `body` `--ink-2` |
| Composer, placeholder, model picker, hints | mono | §3 AI conversation |
| Messages / answers / tool calls | see Workbench `StreamingMessage` (shared) | §3 AI conversation |
| `QueryProgressCard`, `RawSqlBadge`, `TrustPanel`, `DisambiguationCard`, `SemanticChartCard`, `SemanticGovernancePanel` | inline sizes, mono | titles `title-card`, body `ui-regular`, SQL `code` |
| **Boost / Performance Lab** (`BoostTabs.tsx` 236 hits, `ModelPerformanceLab.tsx` 112, `views/performance-lab.tsx` 52) | 111 inline sizes in one file | tabs `ui`; tables §3; metrics `kpi-md`/`kpi-sm`; model ids `code-inline` |
| **Dashboards list** (`views/inspector/dashboards.tsx:120`) | Inter 20/600 via local `SERIF` | `title-page` |
| **Dashboard viewer / builder** (`DashboardViewer`, `DashboardBuilder` 77, `WidgetConfigPanel` 90, `DefinitionPicker`, `ShareDialog` 73, `PinToDashboardDialog`, `PinRawSqlDialog`) | mono labels, mixed sizes | panel titles `title-card`; field labels `label`; inputs `body`; widget titles `title-card`; widget KPIs `kpi-md` |
| Guided builder (`guided/*`: `BlueprintStage` 14 serif refs, `BlueprintDetailDrawer`, `DrillInStage`, `IntentStage`) | `SERIF` constants, mono | stage title `title-section`; option cards `title-card` + `ui-regular` |
| **Metrics catalog** (`metrics-catalog/*`) | `mc-*` palette, mixed | table rules; metric names `ui`; formulas `code` |

### 4.6 Workbench — `components/workbench/*` (348) + `globals.css` `.workbench-frame`
| Element | Now | Target |
|---|---|---|
| Local breadcrumb "DATA 360 / AGENT LAB / WORKBENCH" | mono 10px caps | remove or `label` |
| "NEW", "AGENTS" buttons | mono 10px caps | `ui` |
| "CONFIG · DEVELOPER" tabs | mono caps | `ui` |
| Empty state "Describe your agent mission" | mono | `title-card` + `body` |
| Composer, "+ Tool", model picker | mono placeholder | §3 AI conversation |
| "COMMISSION" button | mono caps | `ui-lg` "Commission" |
| Config panel labels / values (`.wb-config-label` `globals.css:1270`) | 12px 0.08em `!important` | `label` / `ui-regular`; delete the `!important` rules |
| Terminal hero headline (`.wb-terminal-headline`, `globals.css:1239`) | Inter forced with `!important` | `display` |
| `StreamingMessage.tsx` (67 hits; shared with Inspector) | 13px everywhere; constant named `serif` holding Inter | answers `body-lg`; tool rows `ui` + `caption`; I/O `code`; delete the local `mono/serif/sans` constants |
| `HistoryDrawer`, `PromptCanvas`, `InputComposer`, `atoms.tsx`, `marcus/*`, chips | mixed | list items `ui-regular` + `caption tnum`; raw prompt editor `code`; rendered prompt preview `body` |
| `.workbench-frame` `--display/--sans/--mono` (`globals.css:1150-1152, 1223`) | Inter / Inter Tight, differs by theme | point at `--font-sans` / `--font-mono`; same in both themes |

### 4.7 Teach — `components/teach/*` (227)
| Element | Now | Target |
|---|---|---|
| Hero "What should Captain … understand today?" | Inter 40/400 + faux italic | `display` with real Inter italic on the emphasised word |
| Intro paragraph | 15 | `body` `--ink-2` |
| "REFLECT MODE · … LISTENING" pill | mono caps | `eyebrow` |
| "TRY STARTING WITH" | mono caps | `eyebrow` |
| Suggestion cards | italic 15/600 | `body` italic |
| "NEW / HISTORY / CANDIDATE HAND-OFF" | mono caps | `ui` |
| Right rail title "WHAT CAPTAIN … IS LEARNING" | mono bold caps | `title-card` sentence case |
| `LearningCard`, `ConflictResolver`, `VerificationChip`, `MemoryRecallExpander`, `TeachThread` | mono labels | titles `title-card`; body `ui-regular`; tags `label` |
| `teach-tokens.ts:13` `FONT_MONO` (adds JetBrains) | own stack | re-export `FONT_MONO` from `tokens.ts` |

### 4.8 Memory / FOER — `components/agent-lab/memory/*` (1,094; `FoerOpsDashboard.tsx` alone 328)
Keep the editorial character; change the means.

| Element | Now | Target |
|---|---|---|
| Google Fonts `@import` (`FoerOpsDashboard.tsx:436`, `FoerStoryDashboard.tsx:217`) | runtime CDN load | **delete** |
| Overline "ALOFT · AGENT WORK-MEMORY · …" | mono caps, wide tracking | `eyebrow` |
| "FOER" hero | Source Serif 64/600 | `display` |
| Lead paragraph | serif italic 20px | `body-lg` italic, `--ink-2`, max 60ch |
| KPI cards: label / value / subtext | mono caps / 26px coloured, wraps / mono | `label` / `kpi-md` `--ink-1` (no wrap; time and "ago" split onto the subtext line) / `caption` |
| Filter groups "TOPIC / WINDOW / RULE TYPE" + chips | mono | `eyebrow` + `ui` chips |
| Section overline "02 · DISTIL · THE KEEPER" | mono caps | `eyebrow` |
| Section title "The Nightly Distillation" | Source Serif 30 | `title-section` |
| Story copy | Inter Tight 15 | `body` |
| "RUN SWEEP" | mono caps | `ui` "Run sweep" |
| Panels (`ShelvesPanel`, `MountPanel`, `ForgettingPanel`, `KeeperChoicePanel`, `DistillationStage`, `CollapseGuardrail`, `EasterEggs`) | per-file sizes, 0.55–0.72rem text | titles `title-card`; rule text `body`; rule ids / hashes `code-inline`; meta `caption` |
| Drawers (`MemoryDrawer`, `SessionDetailDrawer`) | serif titles, mono | `title-card`; trace JSON `code` |
| `foer-tokens.ts:48-50` `SERIF/BODY/MONO` | separate constants | re-export from `tokens.ts` (`SERIF` → `FONT_SANS`) |
| FOER contrast (KPI value 1.74:1) | translucent accent | `--ink-1` value; accent as a small dot or bar |

### 4.9 BORN / Bandits — `BanditsDashboard.tsx` (119) + `components/agent-lab/bandits/*` (345)
| Element | Now | Target |
|---|---|---|
| In-page breadcrumb "DATA 360 / ALOFT � AGENT LAB / BORN" | mono, mojibake | remove (duplicates top bar) or `label`; fix `�` → `·` |
| "BORN" hero | Times 44/700 | `display` |
| Lead | Times italic | `body-lg` italic |
| KPI tiles | mono caps label + Times value | `label` + `kpi-md tnum` |
| Window and source filters | mono | `ui` chips |
| Panel titles "Posterior Evolution", "Live Feed" | Times 18/600 | `title-card` |
| Panel subtitle | mono | `caption` |
| Live feed table | mono caps headers | §3 table rules; model ids `code-inline` |
| `SuperpositionPanel` (`:637,669` serif), `ArmDetailDrawer` (86), heatmaps, `BornVerdict`, `BornDistributionPanel` | serif + mono | titles `title-card`; values `kpi-sm`; charts `type.chart` |
| `born-tokens.ts:41-43` | duplicate of FOER | re-export from `tokens.ts` |

### 4.10 Chat History — `ChatHistoryPage.tsx` (191 hits) and Runs
| Element | Now | Target |
|---|---|---|
| Title (`:390`) | Times 26/700 | `title-page` |
| Session row title / preview / time | inline mixed | `ui` / `ui-regular --ink-2` / `caption tnum` |
| Filters | mono | `ui` chips |
| Empty states (`:715,724`) | Times | `title-card` + `body` |
| Run session detail (`RunDetailPage`, `AgentTraceTimeline`) | mono | step names `ui`; durations `caption tnum`; payloads `code` |

### 4.11 Agents, Docs, Staging, Users, Audit, Policies, Settings (≈ 120 hits)
| Element | Now | Target |
|---|---|---|
| Titles (Agents 26/600, Docs 26/700, Users 22/600, Audit 19/600, Profile 22/700) | five treatments | `title-page` |
| Agent / tool cards: name / description / meta | mixed | `title-card` / `ui-regular --ink-2` / `caption` |
| Doc detail pages (`AgentDocPage`, `ToolDocPage`) | mixed | headings `title-section`; prose `body-lg`; schemas `code` |
| Users table (`UserTable.tsx`, 42 % small text) | `text-xs`, uppercase headers | §3 table rules; email `ui-regular`; role `label` |
| Audit log | `text-xs` | table rules; actor `ui`; action `code-inline`; time `caption tnum` |
| Policies | mixed | form rules |
| Settings profile | DM Sans | form rules; section titles `title-section` |
| Agent "Try" (`agent-staging/try`) | chat | §3 AI conversation |

### 4.12 Ops, Metrics, Studio, Agent Ops cockpit
| Element | Now | Target |
|---|---|---|
| Evals / Prompts titles (`evals.tsx:33`, `prompts.tsx:36`) | mono 14px caps `h1` | `title-page` "Eval suites" / "Prompt registry" |
| Evals / Prompts lists | mono | table rules; prompt keys `code-inline`; prompt text `code` |
| Metrics page | Inter / DM Sans mix | KPI rules |
| Studio (`DataStudio` 100 hits, `InsightRail.tsx:51` serif italic headline, `DatasetRail`, `DashboardGrid`) | serif, mono | insight headline `title-card` italic; body `ui-regular`; dataset names `code-inline` |
| Agent Ops cockpit (`SessionCockpit`, `cockpit/format.ts:5` DM Sans) | own `sans` constant | re-export `FONT_SANS`; numbers `tnum` |

### 4.13 Charts, canvas and exported images
| Place | Now | Target |
|---|---|---|
| ECharts themes (`aloftDarkTheme.ts`, `inspectorEchartsTheme.ts`, `spinorEchartsTheme.ts`, `foer-theme.ts`) | `'Inter Tight'` (not loaded) at 10–13px | `FONT_SANS` + `type.chart` sizes |
| `inspector-viz-tokens.ts:127` `UI_FONT` | Inter Tight | re-export `FONT_SANS` |
| Server-rendered chart PNGs (`ssr-render.ts:15,66,90`) | embeds `inter-tight-400.ttf` | add `Inter` 400 and 600 TTF to `assets/fonts/` (OFL, from the Inter release) and set `defaultFontFamily: 'Inter'`; keep Plex Mono TTF |
| Captain canvas (`AgentScene.tsx:497`) | DM Sans | `FONT_SANS` |

### 4.14 Shared primitives — `packages/aloft-shared/src/components/ui/*`
These are clean Tailwind already, but feature code rarely uses them (Button has 5 importers, Dialog 2, Badge 2). Map them to tokens so every future screen gets the right type for free:

| Primitive | Now | Target |
|---|---|---|
| `button.tsx:29-38` | `text-xs/sm/lg/xl font-medium` by size | `sm`/`default` → `ui`; `lg` → `ui-lg`; drop `xl` |
| `badge.tsx:6` | `text-xs font-semibold` | `label` |
| `dialog.tsx:142` / `alert-dialog.tsx:151` / `modal.tsx:68` | `text-lg`/`text-xl font-semibold tracking-tight` | title `title-card` (dialogs) or `title-section` (full modals); description `body` |
| `card.tsx:40,56` | `font-semibold tracking-tight` / `text-sm` | `title-card` / `ui-regular` |
| `label.tsx:12`, `form-field.tsx:15,19` | `text-sm font-medium` | `label` / helper `caption` |
| `input.tsx`, `textarea.tsx:13`, `select.tsx:22,108,121`, `searchable-select.tsx` | `text-sm` | value `body`; options `ui-regular` |
| `table.tsx:12,53,85,117` | `text-sm`, `font-medium` headers | header `label`, cell `ui-regular` |
| `tabs.tsx:32` | `text-sm font-semibold` | `ui` |
| `tooltip.tsx:22` | `text-sm` | `caption` |
| `breadcrumb.tsx:22` | `text-sm` | `ui` |
| `calendar.tsx:35` | `text-[0.8rem]` | `caption` |
| `json-exploder-dialog.tsx:79` | `text-xs font-mono` | `code` |

New small components (in `src/components/type/`): `PageTitle`, `SectionTitle`, `Eyebrow`, `Num` (tnum span), `Code` (inline). They exist so the 90 % case is one import, not a class list.

---

## 5. How the code is organised

```
src/styles/typography.css      NEW  @fontsource imports (Inter upright + italic, Plex Mono 400/500),
                                    --font-sans, --font-mono, --type-<token>-* variables,
                                    @layer base h1–h4 defaults, .tnum, .type-* classes
src/lib/typography/tokens.ts   NEW  FONT_SANS, FONT_MONO, type.<token> as React.CSSProperties
                                    (values are var(--type-…) references), CHART sizes
src/components/type/*.tsx      NEW  PageTitle, SectionTitle, Eyebrow, Num, Code
src/app/globals.css            EDIT import typography.css; body uses tokens; font !important rules removed
tailwind.config.js             EDIT fontFamily → var(--font-*); fontSize adds the token classes
                                    (old xs/sm/base/lg/xl/2xl kept as aliases until the last PR)
src/lib/{foer,bandits}/*-tokens.ts, teach-tokens.ts, inspector-viz-tokens.ts, cockpit/format.ts
                               EDIT re-export from tokens.ts (importers do not change)
docs/DESIGN_SYSTEM.md          EDIT typography section rewritten
```

**The bridge for inline styles.** 150 files style text with `style={{ … }}`. Rewriting them all to Tailwind is not required. They switch to spreading a token:

```tsx
// before
<div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: TEXT_MUT }}>
// after
<div style={{ ...type.eyebrow, color: TEXT_MUT }}>
```

Because `type.*` values are CSS variables, a later change to the scale updates inline-styled and class-styled text together.

---

## 6. Delivery sequence

Each step is one PR with light/dark screenshots at 1440 and 390 px. No step changes colours except where listed, and none changes layout beyond what the new sizes require.

| PR | Scope | Fixes | Hits touched | Effort | Visible change |
|---|---|---|---|---|---|
| **PR-0 Guards** | Vitest test: every `font-family` named in source has a loaded face; a baseline file of today's literals (`fontSize`, `fontFamily`, `letterSpacing`, `text-[Npx]`, weights ≥700, `@import url(http`) that may shrink but not grow. Commit the audit's browser probes beside `web/e2e/smoke.mjs`. | prevents regressions | 0 | 1 d | none |
| **PR-1 Foundation** | `typography.css`, `tokens.ts`, `components/type/*`, Tailwind mapping (additive), Inter italic + Plex Mono 500 imports, base `h1–h4` | enables all | ~10 files | 1–2 d | none intended (body still DM Sans) |
| **PR-2 One family** | `body` → Inter; token modules re-export `FONT_SANS`/`FONT_MONO`; replace the 94 `'Source Serif 4'` and the `'Inter Tight'` literals with the token; delete both Google `@import`s; remove DM Sans, Inter Tight, Source Serif 4 packages; fix mojibake; update `DESIGN_SYSTEM.md` and `ARCHITECTURE.md` | TYP-01, 02, 03, 04, 13, 17 | ~45 files | 1–2 d | **Large and immediate:** no Times New Roman anywhere; all text in Inter |
| **PR-3 Primitives** | §4.14 shared `ui/*` → tokens | partial TYP-05/08 | 20 files | 1 d | small |
| **PR-4 Shell, Login, Settings** | §4.1, 4.2, 4.11 settings; delete sidebar `!important` | TYP-12 (part) | ~60 | 1 d | small |
| **PR-5 Dashboard** | §4.3 | TYP-09 | ~100 | 1 d | greeting and KPIs lighter (600) |
| **PR-6 Admin pages** | Agents, Docs, Users, Audit, Policies, Staging (§4.11) | TYP-06, 08 | ~120 | 1–2 d | small text grows to 12–13 px |
| **PR-7 Estate (views)** | §4.4 views, `EstateNav` | TYP-07, 08 | ~550 | 2–3 d | tabs sentence case; mono only for ids |
| **PR-8 Estate (components)** | §4.4 components and tables | TYP-05, 07, 15, 16 (orange titles) | ~1,400 | 3–4 d | denser screens become readable |
| **PR-9 Chat surfaces** | `StreamingMessage`, Inspector chat/composer/empty states, Workbench chat, Teach thread (§4.5–4.7 chat rows) | TYP-07, S-04 | ~500 | 2–3 d | answers 16 px sans; mono only in code |
| **PR-10 Inspector rest** | dashboards, builder, guided, boost/performance lab, metrics catalog | TYP-05, 07, 15 | ~1,500 | 4–5 d | |
| **PR-11 Workbench + Teach rest** | config panel, `.workbench-frame` vars, `!important` removal | TYP-12 | ~400 | 2 d | |
| **PR-12 FOER / Memory** | §4.8 | TYP-06, 07, 15, 16 | ~1,100 | 3 d | hero in Inter; KPIs no longer wrap |
| **PR-13 BORN / Bandits, History, Studio, Ops, cockpit** | §4.9, 4.10, 4.12 | remaining | ~900 | 3 d | |
| **PR-14 Charts and exports** | §4.13; add Inter TTF for SSR | TYP-14 | ~150 | 1–2 d | chart labels match UI |
| **PR-15 Polish and lock** | remove Tailwind aliases (`text-xs/sm/…` old meanings), remove remaining `!important` font rules, set guard baseline to zero, preload Inter Latin, contrast pass for any text still under AA | TYP-10, 11, 16 | — | 2 d | |

**Total:** about 6–7 engineer-weeks, of which PR-0 to PR-2 (≈ 1 week) remove most of what users notice.

### Why this order
- **PR-2 is the biggest win for the smallest diff.** It swaps family names, not sizes, so layouts barely move, yet it removes the Times headings, the third sans and the CDN dependency.
- **Primitives before screens** so screen PRs inherit correct buttons, dialogs and tables.
- **Small, low-risk areas first** (shell, dashboard, admin) to settle the tokens visually before the large Estate and Inspector migrations.
- **Chat surfaces as one PR** because Inspector, Workbench and Teach share `StreamingMessage` and must change together.
- **FOER last among the big screens** because it is the best-looking page today and benefits from a settled system.

---

## 7. Migration mechanics

1. **Mechanical mapping for inline values** (applied per PR, then reviewed by eye):

   | Literal found | Becomes |
   |---|---|
   | `fontFamily` naming Source Serif 4 / Inter Tight / DM Sans / Inter | remove (inherit) or `FONT_SANS` |
   | `fontFamily` naming Plex Mono on a sentence / label / tab / button | remove (inherit sans) |
   | `fontFamily` naming Plex Mono on an id / SQL / cron / path | `...type.codeInline` or `...type.code` |
   | mono + `uppercase` + tracking on a short label | `...type.eyebrow` |
   | size ≤ 11.5px | `eyebrow` if uppercase, else `caption` |
   | size 12–12.8px | `label` or `caption` |
   | size 13–14.5px | `ui` / `ui-regular` (or `code` if mono) |
   | size 15px | `body` or `ui-lg` |
   | size 16–17px | `body-lg` |
   | size 18–22px | `title-section` or `kpi-md` |
   | size 24–34px | `title-page` or `kpi-lg` |
   | size ≥ 36px | `display` |
   | `fontWeight` 700/800, `font-bold`, `font-extrabold` | 600 via token |
   | any `letterSpacing` / `lineHeight` alongside a token | delete |

2. **Roles are decided by a person**, not by the size table: a 22px number is `kpi-md`, a 22px heading is `title-section`.
3. **Keep the old Tailwind sizes working** until PR-15, so unmigrated screens never break.
4. **One area per PR**, reviewed against the before/after screenshots.
5. **Do not mix in colour work** except the contrast fixes named in the table.
6. **Rollback** is per PR; PR-2 can be reverted alone if the family switch needs to wait.

---

## 8. Done when

| Check | Target |
|---|---|
| Fonts painted (Chrome `getPlatformFontsForNode`, all e2e routes) | Inter and IBM Plex Mono only; no Times or system fallback |
| Network | no request to `fonts.googleapis.com` or `fonts.gstatic.com` |
| Distinct computed sizes across all routes | ≤ 12, all from §2 |
| Weights | 400, 500, 600 only |
| Letter-spacing values other than `normal` | ≤ 4 |
| Text under 12 px | eyebrow only (< 2 % of characters) |
| Sentences or labels in mono | 0 |
| Page titles | one style on every route (`display` allowed as an extra hero) |
| Contrast | ≥ 4.5:1 body, ≥ 3:1 large, no opacity on text |
| Guard test | baseline at zero; new literals fail CI |
| Docs | `DESIGN_SYSTEM.md` matches `typography.css` |

Then a design review with real data: long vessel names, 7-digit KPIs, multi-paragraph answers and a 30-column table, in both themes.
