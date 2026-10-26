# Business AI Studio — Typography & Font System Audit

**Date:** 24 October 2026
**Branch audited:** `feature/ui-redesign` (working tree, including uncommitted changes)
**Scope:** the Vite + React Router 7 SPA (`web/`) and everything it imports from `src/`.
**Status:** analysis only. No application code, fonts, theme settings or design tokens were changed. The only files added are this report and the screenshots in [`typography-audit-assets/`](typography-audit-assets/). Nothing described here as "recommended" has been implemented.

## How to read this report

Every claim is tagged by how it was established.

| Tag | Meaning |
|---|---|
| **[Source]** | Read in the repository, with file and line. |
| **[Built]** | Read from the production build in `web/dist` (built 24 Oct 2026, 11:02). |
| **[Rendered]** | Measured in real Chrome (Chrome 1440×900, plus 390 and 820 wide) against the Vite dev server on port 5190, with the API stubbed using the repo's own `web/e2e/fixtures.mjs`. Font identity came from Chrome DevTools Protocol `CSS.getPlatformFontsForNode`, which reports the font Chrome actually painted, not the font the CSS asked for. |
| **[Heuristic]** | A measurement with known limits, stated where used. |
| **[Opinion]** | A design judgement. Kept apart from verified defects. |

Product name: the UI calls itself Data 360 / Agent Lab / ALOFT. "Business AI Studio" appears in no source string, so it is used here only because the brief uses it.

### Limits of this audit

- Rendered checks used stubbed API data. Pages show empty or near-empty states, so dense-table and long AI-answer layouts were judged from source and from the few screens that had content (Dashboard, Estate jobs, FOER).
- Authentication was bypassed with a stubbed session. The login screen was rendered signed-out and measured; its design was not otherwise assessed.
- Dark mode was captured for all 25 routes; dark-mode contrast was sampled on 5 routes only. Dark Estate/Jobs returned no contrast sample.
- Tablet (820) and phone (390) widths were captured for three routes (Dashboard, Estate Jobs, Inspector) and inspected visually for one. Horizontal overflow was measured for all three.
- Font file sizes and licences were read from `node_modules` and `web/dist`. Metrics such as x-height and tabular-figure support of candidate fonts come from general knowledge of those families and were **not** benchmarked here; they are marked as such.
- macOS and Linux were not tested. The fallback fonts named below (Times New Roman) are what Chrome painted on this Windows 11 machine.
- The screenshots are of the working tree, which includes uncommitted redesign changes.

---

## 1. Executive Summary

**Short answer to "is the problem the font or the implementation?" — the implementation.** The shipped fonts are acceptable. The way they are wired is broken in one place and fragmented everywhere else.

The five things that matter most:

1. **Two of the five declared typefaces are never loaded, and the UI silently paints Times New Roman instead.** `Source Serif 4` is named 94 times in 37 files (page titles on Data Estate, Lineage, Entities, Chat History, BORN, job pages, Studio). `@fontsource/source-serif-4` and `@fontsource/inter-tight` are in `package.json` but are imported nowhere. Chrome reported **Times New Roman (system)** for the Data Estate, Lineage, Entities, Chat History and BORN headings. This is the single clearest cause of "fonts used without a plan". (TYP-01)
2. **The only places that do get Source Serif 4 and Inter Tight get them from Google's CDN, via an `@import` inside a React `<style>` tag on two FOER pages.** If that request is blocked, FOER also falls back to Times New Roman. While a FOER component is mounted those faces are document-wide, so the font a shared element shows can depend on which page is open. (TYP-02)
3. **Three sans families compete, and the documentation describes a fourth arrangement.** Body text is DM Sans; Tailwind's `font-sans` and many inline styles are Inter; design tokens and ECharts themes say Inter Tight; `docs/DESIGN_SYSTEM.md` says Inter Tight + Source Serif 4. Across the 24 non-login routes sampled, characters split 47.9 % IBM Plex Mono, 33.3 % DM Sans, 8.8 % Inter, 5.1 % Inter Tight, 5.0 % Source Serif 4 (Source Serif/Inter Tight "painted" as Times/system). (TYP-03, TYP-04)
4. **There is no type scale.** 39 distinct computed font sizes appear across the sampled routes; 60 % of text is 13 px, 71 % is 13 px or smaller, 10 % is under 12 px, and the smallest measured was 6 px. `fontSize` is set inline in 150 of 243 `.tsx` files (1,314 times as `13`). Page titles (H1) range from 14 px to 64 px with weights 400 to 800 and four different families. (TYP-05, TYP-06, TYP-10)
5. **Monospace is used as UI chrome, not just for code.** About half of all characters on several screens are IBM Plex Mono: tabs, buttons, section eyebrows, empty-state sentences, placeholders. 649 `uppercase` usages, 497 `font-mono` class uses and ~300 inline mono declarations. Plex Mono is shipped at weight 400 only, yet bold is applied to it in at least 210 places, so the browser fakes the bold. (TYP-07)

**What is good** (and should be kept): body base size of 15 px with 1.55 line height is sensible; Tailwind text sizes are already remapped to rem; the Dashboard's KPI cards use `tabular-nums` and a clear hierarchy; the FOER page, where the intended serif + sans + mono trio actually loads, looks deliberate and premium (screenshot below); all five font packages are SIL OFL licensed; fonts are self-hosted through `@fontsource` with `font-display: swap`; there is no horizontal overflow at 390 px or 820 px.

**Recommendation in one paragraph:** keep **Inter Variable** as the single sans (it is already installed, already loaded and has the best numeric and dense-UI support of the shortlist), keep **IBM Plex Mono** only for code, identifiers and SQL, and retire DM Sans, Inter Tight and Source Serif 4 as shipping fonts. Replace the scattered literals with one token layer (CSS variables → Tailwind → a small TS module for canvas/ECharts/inline styles), collapse the sizes to a nine-step scale, weights to 400/500/600, and tracking to four values. Do the one-line fix for the Times New Roman headings first, because it is user-visible today. This choice needs a brand decision, set out in §7 (Decision D-1).

**Verified defects: 17. Design recommendations: 6** (listed separately in §3.2).

---

## 2. Current Typography Inventory

### 2.1 What is declared versus what is shipped

| Family | Declared in | Imported / loaded? | Evidence |
|---|---|---|---|
| **DM Sans Variable** | `body` stack `src/app/globals.css:462`; `src/components/agent-ops/cockpit/format.ts:5`; `src/components/login/AgentScene.tsx:8` | Yes, `@import` at `globals.css:2` | [Built] `font-face` for DM Sans, weight 100–1000 |
| **Inter Variable** | Tailwind `sans/serif/display/body` `tailwind.config.js:150-155`; `.workbench-frame` `--display` `globals.css:1150`; ~60 inline literals | Yes, `globals.css:1` | [Built] weight 100–900, 7 unicode-range subsets |
| **IBM Plex Mono** | Tailwind `mono` `tailwind.config.js:152`; `globals.css:1366,1400,1805`; ~300 inline literals, 73 distinct stack spellings | Yes, `globals.css:3`, **weight 400 only** | [Built] 5 `font-face` rules, all `font-weight:400` |
| **Inter Tight** | `.workbench-frame` `--sans` `globals.css:1152`, dark `--display` `:1223`; `foer-tokens.ts:49`; `born-tokens.ts:42`; `inspector-viz-tokens.ts:127`; `aloftDarkTheme.ts:21-147`; `ssr-render.ts:66,90` | **No.** Package installed (`package.json:46`), never imported | [Built] no Inter Tight `font-face` in `index-D2WyfMSv.css` |
| **Source Serif 4** | 94 references in 37 files, e.g. `estate/index.tsx:153,230`, `entities.tsx:110`, `lineage.tsx:119`, `ChatHistoryPage.tsx:390`, `InsightRail.tsx:51`, `born-tokens.ts:41`, `foer-tokens.ts:48` | **No.** Package installed (`package.json:47`), never imported | [Built] none in bundle |
| **JetBrains Mono, Georgia, SF Mono, Menlo, ui-monospace** | Fallback stacks only (`tailwind.config.js:152`, `teach-tokens.ts:13`, `globals.css:836,1805`, `InsightRail.tsx:51`) | No | — |
| **Inter Tight, Source Serif 4, IBM Plex Mono 500 via Google Fonts** | `@import url('https://fonts.googleapis.com/...')` inside a `<style>` tag at `FoerOpsDashboard.tsx:436` and `FoerStoryDashboard.tsx:217` | Only when one of those two components is mounted, over the network | [Rendered] gstatic `.woff2` requests appear only after visiting `/agent-lab/memory` |

[Built] file sizes of the Latin subsets that actually ship: Inter 48.3 KB, DM Sans 36.9 KB, Plex Mono 400 14.7 KB, about 100 KB total, before the unused Source Serif and Inter Tight (never bundled). There is no `<link rel="preload">` in `web/index.html`.

### 2.2 Where typography is defined

| Layer | Location | What it controls | Used by |
|---|---|---|---|
| Font imports | `globals.css:1-3` | three `@fontsource` packages | everything |
| Body defaults | `globals.css:458-468` | DM Sans, 15 px, 1.55, `letter-spacing: 0`, `font-feature-settings: 'cv11','ss01'`, antialiased | everything not overridden |
| Tailwind sizes | `tailwind.config.js:140-147` | `xs 13 / sm 15 / base 16 / lg 19 / xl 22 / 2xl 26` px with line heights | 752 `text-xs`, 163 `text-sm`, 24 `text-lg`, 14 `text-2xl`, 13 `text-xl`, 6 `text-base` |
| Tailwind families | `tailwind.config.js:148-156` | `sans`, `serif`, `display`, `body` are **all Inter**; `mono` is Plex | `font-mono` 497, `font-sans` 16, `font-serif` 9, `font-display` 0, `font-body` 0 |
| Scoped CSS variables | `globals.css:1150-1152, 1223, 1805` | `--display`, `--mono`, `--sans`, `--font-mono`, only inside `.workbench-frame` / a few scopes | workbench components |
| Forced overrides | `globals.css`, 60 `!important`, e.g. `:1239, :1276, :1366` | font family, size, tracking in `.light .workbench-frame` and `.light aside` | workbench, sidebar |
| Duplicate token modules | `foer-tokens.ts:48-50`, `born-tokens.ts:41-43`, `teach-tokens.ts:13`, `inspector-viz-tokens.ts:127`, `cockpit/format.ts:5`, `StreamingMessage.tsx:21-23` | per-feature `SERIF`/`BODY`/`MONO`/`UI_FONT` string constants | inline styles |
| Chart / canvas / server render | `aloftDarkTheme.ts`, `inspectorEchartsTheme.ts:41-98`, `ssr-render.ts:15,66,90`, `assets/fonts/*.ttf`, `AgentScene.tsx:497` | ECharts text, server PNG text, canvas LED text | charts, exports, login mascot |
| Documentation | `docs/DESIGN_SYSTEM.md:54-65, 259, 429`; `ARCHITECTURE.md:1290-1291` | says Inter Tight + Source Serif 4 + Plex Mono | readers; **contradicts the code** |

### 2.3 Measured usage in source

[Source] counts across `src/`:

| Property | Finding |
|---|---|
| Inline `fontSize` | 150 files. Numeric: `13` ×1,314, `11` ×67, `10` ×36, `12` ×33, `18` ×17, `14` ×15, plus 9, 9.x, 13.5, 14.5, 15–44. String: `'13px'` ×186, and rem values `0.55rem` ×7 (8.8 px), `0.58rem` ×8, `0.6rem` ×7, `0.62rem` ×8, `0.65rem`, `0.68rem`, `0.72rem` ×10, `0.75rem`, `0.8rem` |
| Tailwind arbitrary sizes | `text-[13px]` ×30, `[11px]` ×22, `[12px]` ×19, `[10.5px]` ×14, `[12.5px]` ×13, `[10px]` ×11, `[15px]` ×10, `[11.5px]` ×9, down to `[9px]` ×2 and up to `[34px]` |
| Weights | inline: 600 ×232, 700 ×62, 500 ×54, 400 ×16. Classes: `font-semibold` 234, `font-bold` 156, `font-medium` 116, `font-extrabold` 4, `font-normal` 4 |
| Letter-spacing | inline: 20 distinct values from `-0.02em` to `0.5em`; top: `0.06em` ×140, `0.08em` ×113, `0.04em` ×86, `0.1em` ×72, `0.10em` ×45 (same value, spelled differently), `0.12em` ×38. Classes: `tracking-wider` 146, `tracking-widest` 64, `tracking-wide` 21, `tracking-tight` 13, plus arbitrary |
| Line height | inline: `1.5` ×43, `1.6` ×27, `1` ×19, `1.4` ×18, `1.45` ×13, `1.55` ×12, `1.35`, `1.2`, `1.1`, `1.7`, `1.3`. Classes: `leading-relaxed` 49, `leading-none` 9, `leading-tight` 5, `leading-[1.6]` 4 |
| Numerics | `tabular-nums` ×28, `fontVariantNumeric` ×7, across 243 files |
| Responsive type | 0 `sm:/md:/lg:text-*` outside two Dashboard classes; 0 `clamp()` font sizes |
| Semantic headings | `<h1>` 23, `<h2>` 50, `<h3>` 23, `<h4>` 8. **No global `h1–h6` rules** in `globals.css`, so headings take Tailwind preflight (inherit size) plus whatever each component adds. |

### 2.4 Measured usage in the rendered app

[Rendered] 24 routes (excluding login) × light and dark, first-family of every visible text element, weighted by character count:

- **Family share (light, pooled):** IBM Plex Mono 47.9 %, DM Sans 33.3 %, Inter 8.8 %, Inter Tight 5.1 %, Source Serif 4 5.0 %. Excluding the FOER page (which inflates mono): Plex Mono 37.8 %, DM Sans 46.9 %, Inter 12.5 %, Source Serif 4 2.7 %.
- **Size share:** 13 px 60.1 %, 15 px 13.3 %, 13.5 px 8.4 %, 10.5 px 4.3 %, 16 px 1.3 %, 20 px 1.1 %, then 30 further values. 39 distinct sizes. ≤13 px: 71.4 %. <12 px: 10.1 %. <11 px: 8.6 %.
- **Weight share:** 400 69.6 %, 600 14.5 %, 500 11.6 %, 700 3.9 %, 800 0.5 %.
- **Letter-spacing:** 72.7 % `normal`; 44 other distinct values carry the rest.
- Mono share per route: Estate Catalog 77 %, FOER 72 %, FOER Ops 87 %, Inspector 73 %, Estate Jobs 58 %, Bandits 50 %, Inspector Dashboards 48 %, Performance Lab 46 %. Agents, Audit, Docs, Login: 0 %.
- Light and dark mode produced **identical** family, size, weight and spacing numbers on every route; the theme changes colour only. That is a consistency strength.

---

## 3. Application-Wide Findings

### 3.1 Verified defects

Severity scale: **Critical** = visibly wrong output today; **High** = causes the inconsistency users perceive, or a dependency/privacy risk; **Medium** = quality and maintainability; **Low** = hygiene.
Effort: S ≤ 0.5 day, M 1–3 days, L > 3 days. All efforts assume one engineer who knows the repo.

---

#### TYP-01 — Declared display and "Tight" fonts are never loaded; headings render in Times New Roman
- **Severity:** Critical
- **Affected:** Data Estate overview, Entities, Lineage, Chat History, BORN (Bandits) hero and panel titles, job detail drawer, job run page, estate stub page, Studio insight rail, empty states titled in the same font.
- **Current:** [Rendered] Chrome painted `Times New Roman (system)` for `<h1>` "Data Estate" (30 px/700), "Lineage", "Entities", "Chat History" (26 px/700) and "BORN" (44 px/700). The same result with Google Fonts allowed and blocked.
- **Expected:** one deliberate display treatment, or none. DESIGN_SYSTEM.md:61 promises Source Serif 4 for these exact elements.
- **Evidence:** `package.json:46-47` install the two packages; `globals.css:1-3` imports a different three; no `import` of `inter-tight` or `source-serif-4` exists in `src/` or `web/src` (grep); [Built] CSS has `font-face` only for DM Sans, Inter, IBM Plex Mono. Usage: `estate/index.tsx:153,230`, `entities.tsx:110,150,185`, `lineage.tsx:119,259`, `ChatHistoryPage.tsx:390,715,724`, `JobRunPage.tsx:1160`, `JobDetailDrawer.tsx:383`, `StubPage.tsx:39`, `SuperpositionPanel.tsx:637,669`. Screenshots: `typography-audit-assets/light_agent_lab_estate.png`, `light_agent_lab_bandits.png`.
- **Root cause:** a "REBRAND" comment (`globals.css:461`, `tailwind.config.js:149`) records an intent to use Inter Tight and Source Serif 4; the packages were added, the imports and the Tailwind mapping were not (Tailwind maps `serif` to Inter, `tailwind.config.js:151`). Components that wrote `fontFamily: "'Source Serif 4', serif"` inline then fell through to the generic `serif` keyword.
- **Correction:** decide D-1 (§7). Under the recommended path, replace the 94 references with the `--font-sans` token (Inter). Under the alternative, import Source Serif 4 from `@fontsource-variable` in `globals.css` and restrict it to H1 titles.
- **Effort:** S for the stop-gap (point every serif/Tight reference at the token), M for the full codemod across 37 files.
- **Regression risk:** low–medium. Estate and BORN titles will change width; Source Serif 4 renders wider than Times, so check truncation in `HeroSection.tsx` and `JobDetailDrawer.tsx`.

#### TYP-02 — FOER pages pull fonts from Google at runtime through an inline `@import`
- **Severity:** High
- **Affected:** `/agent-lab/memory`, `/agent-lab/memory/ops` (and any view using these two components).
- **Current:** [Rendered] With Google blocked, the FOER hero "FOER" (64 px/600) falls back to Times New Roman; with it allowed, it renders Source Serif 4 and looks as designed. The `@import` sits in a `<style>` element, so its `@font-face` rules are document-wide while FOER is mounted. Whether they persist after navigating away was **not tested** (removing the element should remove the rules).
- **Expected:** every font self-hosted, same on first load and after navigation.
- **Evidence:** `FoerOpsDashboard.tsx:436`, `FoerStoryDashboard.tsx:217` (`@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4…&family=Inter+Tight…&family=IBM+Plex+Mono:wght@400;500…')`). The rest of the app is self-hosted, so the build's `web:check-bundle` and any CSP written for it do not cover this. Screenshot `light_agent_lab_memory.png` shows the designed result.
- **Root cause:** the FOER design was built standalone (from a design-tool export) and its font `@import` carried over verbatim into a React `<style>` block.
- **Correction:** delete both `@import` lines; load whatever FOER needs through the global font layer.
- **Effort:** S. **Dependencies:** TYP-01 decision. **Risk:** FOER is the only place the intended serif looks right, so the choice in D-1 must be made before this line is removed.
- **Privacy / policy note:** the request leaks the user's IP and referrer to Google. Whether that matters for a maritime enterprise customer is a policy question, not something measured here.

#### TYP-03 — Three sans families compete across screens
- **Severity:** High
- **Affected:** all. Body default is DM Sans; Tailwind `font-sans` and ~60 inline literals use Inter; token modules use Inter Tight.
- **Current:** [Rendered] one screen can mix all three: Estate Overview shows DM Sans (breadcrumb, subtitle), Source Serif/Times (title), Plex Mono (tabs, button, empty-state link). Teach renders Inter at 40 px/400 for its hero, DM Sans for chrome.
- **Expected:** one sans family for all non-code text.
- **Evidence:** `globals.css:462` (body), `tailwind.config.js:150` (`sans` = Inter), `globals.css:1152` (`--sans: 'Inter Tight'`), `cockpit/format.ts:5` (DM Sans), `AgentScene.tsx:8` (DM Sans), `StreamingMessage.tsx:22-23` (Inter), `teach` `Inter Variable` literals. [Rendered] per-page family counts, e.g. `/agent-lab/bandits` has 5 families, `/agent-lab/memory` has 5, `/agent-lab/estate` has 4.
- **Root cause:** three redesign passes each set their own default and none removed the previous one.
- **Correction:** one `--font-sans` token (§8).
- **Effort:** M. **Risk:** DM Sans and Inter have different metrics; wrap and truncation checks needed on nav, tabs and cards.

#### TYP-04 — Code, Tailwind config and documentation describe three different systems
- **Severity:** High
- **Evidence:** `DESIGN_SYSTEM.md:56-65` and `ARCHITECTURE.md:1290-1291` say Inter Tight + Source Serif 4 + Plex Mono, fallbacks "Inter, system-ui", "Georgia", "JetBrains Mono". `globals.css:462` ships DM Sans first. `tailwind.config.js:150-155` ships Inter for `sans`, `serif`, `display` and `body`, with a comment (`:149`) that says "Inter → Inter Tight". `font-display` and `font-body` are used 0 times; `font-serif` is used 9 times and renders sans unless an inline style overrides it (e.g. `JobDetailDrawer.tsx:383` sets both `className="font-serif"` and an inline Source Serif 4, so the inline wins and Times appears).
- **Root cause:** documentation was not updated when the implementation changed, and the Tailwind aliases were never connected to the actual choice.
- **Correction:** after D-1, update `DESIGN_SYSTEM.md` and delete the dead `display`/`body` aliases or give them real meaning.
- **Effort:** S. **Risk:** none.

#### TYP-05 — No type scale: sizes are set per element
- **Severity:** High
- **Affected:** all.
- **Current:** 39 distinct computed sizes in 24 routes [Rendered]; sizes set in px, rem, fractional px (10.5, 11.5, 12.5, 13.5, 14.5) and Tailwind arbitrary values. Tailwind's own scale was rewritten (`xs 13, sm 15, base 16, lg 19, xl 22, 2xl 26`) so `text-sm` is 15 px, not 14 px as in any Tailwind documentation.
- **Evidence:** §2.3 counts; `tailwind.config.js:140-147`; 150 files with inline `fontSize`.
- **Root cause:** inline `style={{ fontSize: … }}` objects in feature components, copied from design exports, bypass Tailwind and CSS variables entirely. Nothing (lint, test) stops it: ESLint does not run at all today (`docs/CHANGELOG.md`: "ESLint could not run: it crashes loading `eslint.config.cjs`"), and `web/src/tailwind-content.test.ts` guards only Tailwind content globs.
- **Correction:** nine-step scale as CSS variables, exposed through Tailwind, plus a test that fails on new literals (§10).
- **Effort:** L overall; the token definition is S, the migration is the cost.
- **Risk:** medium. Visual diffs on every page; migrate by area (§11).

#### TYP-06 — Excess small text
- **Severity:** High
- **Current:** [Rendered] 71.4 % of characters are ≤13 px, 10.1 % are <12 px, 8.6 % are <11 px, minimum measured 6 px (`0.55rem`/`6.5px` items). Worst routes by share under 12 px: `/agent-lab/ops/evals` 43 %, `/agent-staging/users` 42 %, `/agent-lab/ops/prompts` 28 %, `/agent-lab/workbench` 23 %, `/agent-staging/audit` 21 %.
- **Evidence:** `fontSize: '0.55rem'` ×7, `'0.58rem'` ×8, `'0.6rem'` ×7, `'0.62rem'` ×8, `text-[9px]` ×2, `text-[10px]` ×11, `text-[10.5px]` ×14; `.light .workbench-frame .wb-config-label` forces 12 px (`globals.css:1270`).
- **Root cause:** density achieved by shrinking text instead of by layout, combined with uppercase tracked mono labels that look smaller than their nominal size. WCAG has no minimum size, but text this small is below what most enterprise guidelines allow as a floor (11–12 px) and below it when the user enlarges text.
- **Correction:** floor of 12 px for readable text, 11 px only for uppercase eyebrow/badge; 13 px for table and control text; 15 px for prose.
- **Effort:** M. **Risk:** layouts that rely on tiny text will overflow; check `FoerOpsDashboard`, `BanditsDashboard` panels and the cockpit.

#### TYP-07 — Monospace used for interface chrome; faux-bold mono
- **Severity:** High
- **Affected:** Estate tabs and job cards, Inspector and Workbench empty states, FOER, BORN, Evals/Prompts pages, Teach pills, sidebar section headings, chat placeholders.
- **Current:** [Rendered] the Inspector empty state ("Ask a question about your data", "I can query your warehouse, build charts, and help you explore…") and the Workbench empty state and input placeholder are set in Plex Mono; Estate navigation is uppercase tracked mono; the Evals and Prompts page titles are 14 px mono uppercase (`evals.tsx:33`, `prompts.tsx:36`). Screenshots `light_inspector.png`, `light_agent_lab_workbench.png`, `dark_agent_lab_ops_evals.png`.
- **Evidence:** `font-mono` ×497; mono inline ×~300; `uppercase` ×649; `.light aside .agent-nav-section` forces mono 12 px uppercase (`globals.css:1363-1368`). Only weight 400 is imported (`globals.css:3`, [Built] 5 `font-face`, all 400). 166 lines combine `font-mono` with `font-semibold/bold` and 44 inline mono declarations carry `fontWeight` 600/700, so Chrome synthesises bold.
- **Root cause:** the mono face doubles as the "technical / ALOFT brand" voice. That voice is applied to prose, which makes the interface read as a terminal rather than a business product.
- **Correction:** restrict mono to code, SQL, IDs, paths, hashes, timestamps and numbers in logs. Eyebrows and tabs move to the sans. If mono bold is truly needed, import weight 600 (`@fontsource/ibm-plex-mono/latin-600.css` exists in the installed package).
- **Effort:** M–L. **Risk:** this is the most visible change in the plan and is partly an identity decision (see S-02).

#### TYP-08 — Heading levels are not consistent between pages
- **Severity:** Medium
- **Current:** [Rendered] page-title (`h1`/first heading) computed styles: Dashboard "Good evening" DM Sans 36 px/**800**; Agents DM Sans 26/600; Docs library 26/**700**; Users 22/600; Audit Log 19/600; Profile & appearance 22/**700**; Data Estate Times 30/700; Chat History Times 26/700; Inspector dashboards Inter 20/600; Eval Suites Plex Mono 14/**400**; Teach Inter **40**/400; FOER 64/600; BORN 44/700. Thirteen different treatments for the same role.
- **Evidence:** `DashboardView.tsx:488` (`text-[32px] font-extrabold … sm:text-4xl`), `agents/index.tsx:69` (`text-2xl font-semibold`), `evals.tsx:33`, `ChatHistoryPage.tsx:390`, `dashboards.tsx:120`, screenshots.
- **Root cause:** no heading component or global heading rule; no definition of "page title".
- **Correction:** `type-title-page` token applied through a `<PageTitle>` component and base `h1` rule (§10).
- **Effort:** M. **Risk:** low.

#### TYP-09 — Weights are over-spread and 700/800 add noise
- **Severity:** Medium
- **Current:** rendered shares: 400 69.6 %, 600 14.5 %, 500 11.6 %, 700 3.9 %, 800 0.5 %. Source: `font-semibold` 234, `font-bold` 156, `font-medium` 116, `font-extrabold` 4. KPI numbers on the Dashboard are `font-extrabold` (`DashboardView.tsx:98,202,426,488`). Weights 500, 600 and 700 are all used for the same roles (labels, card titles, badges).
- **Root cause:** no weight map; each author chose independently. Weight 800 on DM Sans at 36 px is also visibly heavier than every other title.
- **Correction:** 400 / 500 / 600 only; 700+ removed from the UI.
- **Effort:** M (mechanical). **Risk:** low.

#### TYP-10 — Letter-spacing has no system
- **Severity:** Medium
- **Evidence:** 20 distinct inline values, e.g. `0.1em` and `0.10em` counted separately (72 + 45), `0.04, 0.05, 0.06, 0.07, 0.08, 0.12, 0.13, 0.14, 0.16, 0.18, 0.22, 0.28, 0.5em`; Tailwind `tracking-wider` ×146, `tracking-widest` ×64, `tracking-wide` ×21. [Rendered] 44 distinct computed values besides `normal`.
- **Root cause:** every uppercase label picks its own tracking, which compounds with TYP-07.
- **Correction:** four tokens (§8).
- **Effort:** S–M.

#### TYP-11 — Line-height values are ad hoc
- **Severity:** Medium
- **Evidence:** inline `lineHeight` ×11 distinct values (1, 1.1, 1.2, 1.3, 1.35, 1.4, 1.45, 1.5, 1.55, 1.6, 1.7); `leading-relaxed` ×49 (Tailwind 1.625) next to the config's own paired line heights (`tailwind.config.js:141-146`) and body 1.55 (`globals.css:464`). Because most tables and rows use inline sizes, they inherit 1.55 regardless of font size.
- **Root cause:** same as TYP-05.
- **Correction:** line height is part of each type token, never set separately.
- **Effort:** included in TYP-05.

#### TYP-12 — Competing declarations: `!important` overrides and scoped re-definitions
- **Severity:** Medium
- **Evidence:** `globals.css` has 60 `!important`. Type-related: `:1239,1276` force `Inter Variable` on `.wb-terminal-headline` in light; `:1270-1272` force 12 px / 0.08em on `.wb-config-label`; `:1363-1368` force Plex Mono 12 px 0.06em on `aside .agent-nav-section`; `:1400` `.wb-mono`. `.workbench-frame` redefines `--display`, `--sans` differently for light (`:1150-1152`: Inter / Inter Tight) and dark (`:1223`: Inter Tight), so in dark the workbench display font is a different family than in light. In practice the dark `--display` resolves to system sans because Inter Tight is not loaded (TYP-01).
- **Root cause:** a scoped theme (`.workbench-frame`) grew its own typography, then light-mode patches used `!important` to override it.
- **Correction:** remove after migrating the workbench components to tokens; do not add more.
- **Effort:** M. **Risk:** medium; workbench is a dense screen.

#### TYP-13 — The same font constants are redefined in at least six modules
- **Severity:** Medium
- **Evidence:** `foer-tokens.ts:48-50` and `born-tokens.ts:41-43` are byte-identical (`SERIF`, `BODY`, `MONO`); `teach-tokens.ts:13` adds JetBrains Mono to the mono stack; `inspector-viz-tokens.ts:127` `UI_FONT = 'Inter Tight'`; `cockpit/format.ts:5` DM Sans; `StreamingMessage.tsx:21-23` defines a constant named `serif` whose value is Inter; `AgentScene.tsx:8`. Plex Mono is spelled 73 different ways in source (quoted/unquoted, `monospace` vs `ui-monospace, monospace`, `var(--mono)` vs `var(--font-mono)`).
- **Root cause:** each feature built its own token file.
- **Correction:** one exported module (`src/lib/typography/tokens.ts`) generated from, or mirroring, the CSS variables.
- **Effort:** S–M. **Risk:** low.

#### TYP-14 — Charts, canvas and server-rendered images use fonts the UI does not
- **Severity:** Medium
- **Evidence:** ECharts themes use `'Inter Tight', sans-serif` (`aloftDarkTheme.ts:21,28,33,135,142,147`) and `UI_FONT` (`inspector-viz-tokens.ts:127`, `inspectorEchartsTheme.ts:41-98`), at 10, 11 and 13 px. Inter Tight is not loaded on most routes (TYP-01), so chart axis labels fall back to a system sans. `ssr-render.ts:15,66,90` embeds `assets/fonts/inter-tight-400.ttf` and Plex Mono for server-rendered chart images, so exported images use Inter Tight while the UI shows DM Sans/Inter. Canvas text in `AgentScene.tsx:497` uses DM Sans.
- **Root cause:** chart libraries take a font string, not a CSS variable, and each was filled in separately.
- **Correction:** feed charts from the same token module; make the server renderer use the same family as the UI.
- **Effort:** M. **Risk:** low; ECharts text metrics shift slightly.
- **Unverified:** the visual difference between exported and on-screen charts was not measured in this audit.

#### TYP-15 — Numeric typography is only partly handled
- **Severity:** Medium
- **Evidence:** `tabular-nums` ×28 and `fontVariantNumeric` ×7 across 243 files; none on `body`. The Dashboard KPIs use it (`DashboardView.tsx:98,426`); the FOER KPI cards and Estate counts do not. [Rendered] FOER "LAST DISTILLATION" value "14:35 UTC · <1h ago" wraps at 20 px (`light_agent_lab_memory.png`). Many numbers are in mono, which is incidentally tabular.
- **Root cause:** numbers are styled per component; there is no `.num` / `data-numeric` convention.
- **Correction:** a `type-kpi-*` family and a `.tnum` utility with `font-variant-numeric: tabular-nums` applied to tables and metrics by default.
- **Effort:** S–M.

#### TYP-16 — Text contrast: a measurable slice fails WCAG AA
- **Severity:** Medium
- **Current:** [Heuristic] using computed text colour, composited background and element opacity, 12.1 % of sampled characters in light (6 routes, 9,912 characters) and 10.8 % in dark (5 routes, 7,964 characters) fall below 4.5:1 (3:1 for large text). Limits: backgrounds with gradients or images are approximated, opacity is applied to the element only, hidden/decorative elements may be included, and only six routes were sampled.
- **Concrete cases (reproducible in the browser):** Estate Jobs card titles `rgb(251,146,60)` on white, 2.26:1 (`light_agent_lab_estate_jobs.png`, "ESTATE INVENTORY"); FOER KPI values `rgba(111,157,196,0.565)` on white, 1.74:1; BORN muted labels in light and dark around 2.1–2.3:1 after opacity; a muted label `rgb(90,106,94)` on `rgb(223,227,218)`, 4.41:1 (just under 4.5), found on the Dashboard, Inspector and Docs pages.
- **Root cause:** accent colours and `opacity` are used on small text. This is colour, not font, but small mono text makes it worse.
- **Correction:** set text colour by role token only (`--text-*`), forbid opacity on text, and use the `-ink` variants (`--brand-a-ink`) for coloured small text. The repo already has `mc-palette-contrast.test.ts` for one palette; extend the idea.
- **Effort:** M. **Dependencies:** a colour pass, which is outside this audit.

#### TYP-17 — Mojibake in the BORN breadcrumb and copy
- **Severity:** Low (cosmetic, but visible in the first screenshot of the page)
- **Evidence:** `BanditsDashboard.tsx:285` contains U+FFFD in "ALOFT � AGENT LAB"; three occurrences in the file; [Rendered] "chosen ? it's measured into being" in the page subtitle. Committed in `6db3442`, not part of the uncommitted changes.
- **Root cause:** a non-UTF-8 save. CHANGELOG records a similar UTF-8 problem in the harvester only.
- **Correction:** restore the intended characters (probably `·` and `—`).
- **Effort:** S. **Risk:** none.

### 3.2 Design recommendations (not defects)

| ID | Recommendation | Why | Priority |
|---|---|---|---|
| S-01 | Decide the product's single type voice (Decision D-1) | Brand documents and shipped UI disagree | Decision first |
| S-02 | Retire uppercase tracked mono as the default label style | Reads as a developer tool; very small effective size | High |
| S-03 | Give the Dashboard greeting and page title distinct roles | A greeting is a display line, a title is not | Medium |
| S-04 | Treat AI answer text as its own type role at 15–16 px with 1.6 line height | The app's main output is generated prose; today it appears at 13 px in places | Medium |
| S-05 | Add fluid sizes for display and page titles only | Titles do not shrink on phones; body is fine | Low |
| S-06 | Keep the FOER page as a visual reference for "editorial" polish | It is the best-looking page; its qualities (generous size contrast, italic lead, spacing) can be reproduced in Inter | Medium |

### 3.3 Area-by-area summary

[Rendered] unless marked [Source]. "Intended" is what DESIGN_SYSTEM.md says.

| Area | Typography now | Main inconsistencies |
|---|---|---|
| **Login** (`views/login.tsx`) | DM Sans via body; title 28/600 with −0.02em (`:169`), buttons 15/600 | 0 % mono (as are Agents, Audit and Docs). Title size (28 px) matches no other page title. |
| **Shell / sidebar / breadcrumb** | Icon rail (no text); breadcrumb DM Sans 15 px; user menu 13/600 (`UserMenu.tsx:153`) | Section labels use `text-[10.5px] uppercase tracking-[0.08em]` (`StagingSidebar.tsx:141`); the CSS `.agent-nav-section` forces mono for the same role (`globals.css:1366`). |
| **Dashboard** | DM Sans, KPIs 26–34 px/800, tabular, greeting 36–40/800 | Clearest hierarchy in the app. Weight 800 is the heaviest anywhere. |
| **Data Estate** (overview, catalog, entities, lineage, jobs) | Titles in Times (TYP-01); tabs, cards, filters in uppercase mono; subtitles DM Sans | 4 families on the overview; Jobs is 58 % mono; card titles orange 2.26:1. |
| **FOER / Memory** | Source Serif 64 px hero, italic serif lead, mono eyebrows/labels, Inter Tight body, tabular-like KPIs | Only page where the full designed trio loads (via Google). 16 % of text <12 px, 27 distinct sizes (most of any route). |
| **BORN / Bandits** | Times serif title 44/700, italic serif lead, mono labels, serif panel titles | Same defect as Estate; mojibake (TYP-17); 25 % low-contrast sample. |
| **Inspector (AI chat)** | Chat chrome mono, empty state mono, header mono caps; right panel tabs mono | Header controls overlap in the captured state ("CATALOG + BQ" over "NEW"); prose in mono. Answer text uses `StreamingMessage.tsx` 13 px. |
| **Workbench** | Mono breadcrumb 10 px, mono placeholder, mono "COMMISSION" button | 23 % <12 px; `!important` overrides (TYP-12). |
| **Teach** | Inter 40 px/400 hero with italic emphasis; mono pills; Inter chrome | Intentionally editorial, but unique to this page. |
| **Settings / Users / Audit / Docs / Agents** | DM Sans, titles 19–26 px at 600–700 | Clean but inconsistent title sizes; Users 42 % and Audit 21 % under 12 px. |
| **Performance Lab, Metrics, History, Prompts, Evals** | Mixed Inter / DM Sans / mono | Evals and Prompts have a 14 px mono "title"; 43 % and 28 % small text. |
| **Tables / grids** | 13 px, mostly inline; mono for IDs and headers; no `tabular-nums` by default | Table header style differs by feature (uppercase mono vs sentence-case sans). |
| **Charts** | ECharts 10–13 px Inter Tight (falls back) | TYP-14. |
| **Dialogs, popovers, toasts** | `text-sm`/`text-xs` utilities | Login toast uses `text-sm font-semibold`; consistent where Tailwind utilities are used. |
| **Error / not-found** | Not separately measured | Not assessed. |

**Not implemented / not assessed:** no screen for multi-step agent creation wizards, workflow canvases beyond the Agent graph, or notification centre was found in the router (`web/src/router.tsx:36-141`). Workbench and Agents are the agent creation and management screens that exist. The pipeline graph (`@xyflow/react`) node text was not inspected.

---

## 4. Root Cause Analysis

Each of the brief's candidate causes, checked against evidence.

| Candidate cause | Verdict | Evidence |
|---|---|---|
| No centralised typography scale | **Confirmed** | TYP-05; no scale variables anywhere; 39 sizes |
| Multiple unrelated fonts | **Confirmed** | TYP-03; five families, three sans |
| Inconsistent weights | **Confirmed, moderate** | TYP-09 |
| Overuse of small text | **Confirmed** | TYP-06 |
| Poor distinction between headings and body | **Partly.** Titles are distinguishable by size, but 13 treatments of one role mean users cannot learn what a title looks like | TYP-08 |
| Excessive custom CSS overrides | **Confirmed in the workbench and sidebar** | TYP-12 |
| Different components applying conflicting defaults | **Confirmed** | TYP-04, TYP-13 |
| Improper line heights / letter spacing | **Confirmed (no system)**; not wrong in individual cases | TYP-10, TYP-11 |
| Inconsistent numerical typography | **Confirmed, moderate** | TYP-15 |
| Excessive visual density | **Partly.** Density comes from small text, not from tight spacing; spacing around type was not measured | TYP-06 |
| Weak alignment between type and layout spacing | **Not verified** (not measured; see §12) | — |
| Fonts loading incorrectly | **Confirmed, severe** | TYP-01, TYP-02 |
| A good font implemented poorly | **Yes** | Inter and Plex Mono are sound; the FOER page proves the intended look works |

### The causal chain

1. **A rebrand was documented but not completed.** `DESIGN_SYSTEM.md` and the "REBRAND" comments say Inter Tight + Source Serif 4. The packages were installed, the imports were not, so every `'Source Serif 4', serif` became Times.
2. **A later redesign (the "fresh brand layer", `globals.css:19-24`, and the current shell) picked DM Sans for body and Inter for Tailwind, without removing the earlier values.** Both defaults are live.
3. **Feature areas (FOER, BORN, Estate, Teach, Workbench, Inspector) were built from standalone design exports with inline styles,** each with its own font constants and sizes (TYP-13). Inline styles bypass Tailwind, so even the existing Tailwind scale does not constrain them.
4. **Nothing enforces the system.** ESLint does not currently run, no test checks type tokens, and `DESIGN_SYSTEM.md` has drifted from the code, so drift is not visible.

**Answer to "is the problem the font or the way typography is implemented?":** the implementation. If every Source Serif 4 and Inter Tight reference were pointed at Inter and every `13px` at one token, the UI would already look markedly more consistent. A font change alone, without the token layer, would add a fourth competing default.

---

## 5. Visual Consistency Assessment

[Opinion informed by [Rendered] evidence.]

- **What a user sees today:** a calm, readable Dashboard and Settings in DM Sans; then Estate and BORN where the headings look like a word-processor default, beside uppercase terminal-style tabs; then Inspector and Workbench where conversation and input look like a console; then FOER, which is the polished editorial outlier. The product does not look like one product.
- **The perceived "cheapness" is concentrated in three observable things:** serif fallback headings (Times is conspicuous next to a geometric sans), prose set in monospace, and very small uppercase tracked labels. None of these needs a new font to fix.
- **What already works:** the Dashboard (KPI hierarchy, tabular numerals, number-to-label contrast) and the login screen are consistent with each other and could serve as the anchor for the token set. The FOER page shows the product can carry an editorial voice; the lesson to take is its size contrast and generous line height, not its typefaces.
- **Hierarchy:** page title → section title → card title → body → meta is readable on the Dashboard and Settings, weak on mono-heavy screens where title, tab, button and body are all small mono capitals.
- **Light vs dark:** identical type metrics on every route (§2.4); the theme changes colour only. Dark mode keeps hierarchy. The only theme-conditional typography is `.workbench-frame --display` (TYP-12).
- **Dense vs spacious:** Dashboard (≈3 % small text) feels spacious; Users and Evals (≈42 %) feel cramped because small text is paired with large empty areas, not with efficient density.

Representative screenshots (all in `typography-audit-assets/`):

| File | Shows |
|---|---|
| `light_agent_lab_estate.png` | Times New Roman title above DM Sans subtitle and mono tabs |
| `light_agent_lab_bandits.png` | Times serif title and panel titles, mono labels, mojibake in breadcrumb |
| `light_agent_lab_memory.png` | FOER with Source Serif 4 loaded from Google: the intended editorial look |
| `light_agent_lab_estate_jobs.png` | Dense mono UI, 2.26:1 orange card titles |
| `light_inspector.png` / `light_agent_lab_workbench.png` | Empty states and placeholders in mono |
| `dark_dashboard.png` | Strongest hierarchy in the app (800 weight greeting, KPI cards) |
| `dark_agent_lab_teach.png` | Inter 40 px/400 hero, mono pills |
| `dark_agent_lab_ops_evals.png` | 14 px mono "title", 43 % small text |
| `w390__agent_lab_estate_jobs.png` | Phone width: scale does not change; mono labels wrap awkwardly |

---

## 6. Accessibility and Performance

### 6.1 Readability and zoom
- **Size floor:** TYP-06. 10 % of characters are under 12 px, with the minimum at 6 px.
- **Browser text-size preference:** [Rendered] raising the root font size from 16 px to 24 px (the equivalent of a 150 % browser font setting) enlarged average text size only 1.43× on Estate Jobs. Text set in Tailwind rem classes scales; text pinned in inline pixels does not (1,314 inline `13` plus 186 `'13px'`). This was tested on one page, so treat the ratio as indicative. Because body is `15px` (`globals.css:463`) and not rem, body prose does not respond to the user's setting either.
- **Page zoom** (Ctrl +) scales everything; not separately tested.

### 6.2 Contrast
TYP-16. Mostly a colour problem; small size amplifies it.

### 6.3 Responsive type
[Rendered] 390 px and 820 px: no horizontal overflow on Dashboard, Estate Jobs, Inspector (`scrollWidth` equals `clientWidth`). However, the type scale does not change at any breakpoint (0 responsive text utilities beyond the Dashboard H1; 0 `clamp()`), and uppercase mono labels wrap mid-phrase at 390 px (`w390__agent_lab_estate_jobs.png`: "Daily change-detect | 0 4 * * ? * | in 14h" breaks into three lines). Body stays at 15 px, which is appropriate on phones; the issue is titles and mono labels.

### 6.4 Font loading and performance
- **Strengths:** self-hosted via `@fontsource`, WOFF2, `font-display: swap`, unicode-range subsetting so only Latin files were requested [Rendered], total ≈100 KB for the three loaded families.
- **Weaknesses:**
  - No preload for the body font, so first paint uses the fallback, then swaps (FOUT). Not measured for layout shift.
  - Two variable sans fonts (Inter 48 KB, DM Sans 37 KB) ship for roles one can serve.
  - Two installed packages are dead weight in `package.json`/`node_modules`.
  - Third-party Google request on FOER (TYP-02) adds a render-blocking CSS `@import` inside the page.
  - Mono bold is synthesised (TYP-07).
- **Licensing:** [Source] `node_modules/@fontsource*/…/LICENSE` shows SIL Open Font License for Inter, DM Sans, Inter Tight, IBM Plex Mono and Source Serif 4. Self-hosting is permitted. This is a reading of the shipped licence files, not legal advice.
- **Missing resources:** none returned 404 in the rendered runs, except that fonts the code requests by name but that were never added fall back silently (TYP-01). The server-side renderer requires `assets/fonts/inter-tight-400.ttf` and `ibm-plex-mono-400.ttf` and throws at start if absent (`PHASE_LEDGER.md:311-313`); both are present.
- **Rendering:** `-webkit-font-smoothing: antialiased` is global (`globals.css:467`, `index.html` `antialiased`). On macOS this thins light-on-dark text; acceptable, but worth checking on the dark theme with a Retina display (not tested).

---

## 7. Font Evaluation

### 7.1 Should the current fonts be kept?

| Current font | Verdict | Reason |
|---|---|---|
| **Inter Variable** | **Keep as the single sans** | Already installed and loaded; designed for dense UI; strong tabular figures and feature set; opsz axis available in the installed package (`opsz.css` present) |
| **IBM Plex Mono** | **Keep, for code and data only** | Good legibility, matches Inter's tone. Import weight 500/600 only if mono bold is genuinely needed |
| **DM Sans Variable** | Retire | Not documented as the intended font; a third sans; lower x-height and more geometric than a dense-data UI wants; tabular-figure support not verified here |
| **Inter Tight** | Retire (not loaded anyway) | Same design as Inter with tighter spacing; headings can get this effect through negative tracking |
| **Source Serif 4** | Retire from product UI, or restrict (Decision D-1) | Currently absent in practice; where loaded (FOER) it looks good but exists on one screen |

### 7.2 Shortlist

Metrics in the right-hand column that were not measured here are marked *(general knowledge)*.

| Candidate | Role | Readability / density | Numbers | Weights | Loading and licence | Fit | Verdict |
|---|---|---|---|---|---|---|---|
| **Inter Variable** (installed) | UI + body | Excellent at 12–15 px, neutral *(general knowledge)* | Tabular figures and slashed zero via font features *(general knowledge)* | Variable 100–900 [Built] | 48 KB Latin, OFL, already shipped | Neutral, serious, "enterprise" | **Primary** |
| **Geist** (not installed) | UI + body | Similar to Inter, slightly more geometric *(general knowledge)* | Tabular figures *(general knowledge)* | Variable | OFL; would be a new dependency | Modern, but a visible stylistic change | Viable alternative if a more distinctive voice is wanted; needs a spike |
| **IBM Plex Sans** (not installed) | UI + body | Good; wider letterforms, lower density *(general knowledge)* | Tabular available | Static weights | OFL | Pairs naturally with Plex Mono; heavier, more "technical" | Alternative if the brand wants an IBM-like tone |
| **DM Sans** (installed) | UI + body | Geometric, low x-height | Not verified | Variable | 37 KB, OFL | Friendly; weaker for dense tables | Do not keep |
| **Inter Tight** (installed, unused) | Headings | Tighter spacing, good for headlines | As Inter | Static 400/500/600 per `FoerOps` import | OFL | Redundant with Inter | Do not keep |
| **Source Serif 4** (installed, unused) | Display | Strong editorial serif | — | Variable | OFL | Distinctive; only as a deliberate accent | Only under Decision D-1(b) |
| **IBM Plex Mono** (installed) | Code | Good legibility, clear 0/O and 1/l/I | Monospaced | 400 loaded; 500/600 available | 14.7 KB (400), OFL | Matches Inter | **Keep** |

### 7.3 Is one family enough?

Yes. Inter at 400/500/600 covers body, controls, headings, tables, KPIs (with tabular numerals) and AI prose. Weight and size give hierarchy; a second family is not needed for it. A mono is genuinely necessary (SQL, JSON, IDs, tool traces). A serif is a branding choice, not a necessity.

### 7.4 Decision required — D-1

| Option | What changes | Trade-off |
|---|---|---|
| **(a) Inter + Plex Mono (recommended)** | Retire DM Sans, Inter Tight, Source Serif 4 | One-sans consistency; least new weight; loses the editorial serif identity documented in DESIGN_SYSTEM.md |
| **(b) Restore the documented trio** | Import Source Serif 4 (display) and use Inter (not Inter Tight) for UI, Plex Mono for code | Honours the written brand; still needs the same token work; serif then appears only where explicitly assigned (page titles, FOER hero); adds ~one font file |
| **(c) Keep DM Sans as the primary** | Remove Inter and Inter Tight | Matches what most pages show today, so the smallest visual change, but weakest for dense numerics and charts that already use Inter |

The tokens in §8 work for any of the three; only `--font-sans` and an optional `--font-display` change.

---

## 8. Recommended Typography System

Written for option (a). Option (b) adds a single `--font-display` used only by the `display` and `title-page` tokens.

### 8.1 Font stacks

```css
--font-sans: 'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
--font-mono: 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
```

Global defaults (`body`): `--font-sans`, `font-feature-settings: 'cv11', 'ss01'` only after checking the effect on Inter (these are Inter features that the current stack applies to DM Sans, where the effect is unverified), `-webkit-font-smoothing: antialiased`. Add `font-variant-numeric: tabular-nums` to tables and any element with the `.tnum` utility, not to `body` (it widens prose digits).

### 8.2 Scale, weights, line heights, tracking

- **Scale (px):** 11, 12, 13, 15, 16, 20, 24, 28, 40 (nine steps, the only sizes allowed). 15 is the existing body size and 13 is the existing dense-UI size, so most current text lands on a token without visual change.
- **Weights:** 400 text, 500 controls and labels, 600 headings and emphasis. No 700/800.
- **Tracking:** `-0.02em` display and page title, `-0.01em` section title, `0` everything else, `+0.04em` uppercase labels (max `+0.08em` for the smallest eyebrow).
- **Responsive:** titles use `clamp()` (below); body and UI text do not scale with viewport.

### 8.3 Token table

| Token | Font size | Weight | Line height | Letter spacing | Intended usage |
|---|---|---|---|---|---|
| `type-display` | `clamp(28px, 4vw, 40px)` | 600 | 1.1 | −0.02em | Hero lines (Dashboard greeting, Teach prompt, FOER hero if kept) |
| `type-title-page` | `clamp(22px, 2.6vw, 28px)` | 600 | 1.2 | −0.02em | One per page: the H1 |
| `type-title-section` | 20px | 600 | 1.3 (26px) | −0.01em | H2: panel and section headings |
| `type-title-card` | 15px | 600 | 1.35 (20px) | 0 | H3: card titles, dialog titles, drawer titles |
| `type-body-lg` | 16px | 400 | 1.6 (26px) | 0 | AI answer prose, documentation, long descriptions |
| `type-body` | 15px | 400 | 1.55 (23px) | 0 | Default text (existing body size) |
| `type-ui` | 13px | 500 | 1.4 (18px) | 0 | Buttons, nav items, tabs, menu items, inputs |
| `type-ui-regular` | 13px | 400 | 1.45 (19px) | 0 | Table cells, list rows, dense secondary text |
| `type-label` | 12px | 500 | 1.35 (16px) | 0 (sentence case) or +0.04em (uppercase) | Form labels, table headers, field captions |
| `type-caption` | 12px | 400 | 1.4 (17px) | 0 | Descriptions under inputs, timestamps, metadata |
| `type-eyebrow` | 11px | 600 | 1.3 (14px) | +0.08em, uppercase | Section eyebrows only; the single place below 12 px |
| `type-kpi-lg` | 28px | 600 | 1.1 | −0.02em, tabular | Hero metrics |
| `type-kpi-md` | 20px | 600 | 1.2 | −0.01em, tabular | Card metrics |
| `type-kpi-sm` | 15px | 600 | 1.3 | 0, tabular | Inline stats |
| `type-code` | 13px | 400 | 1.55 (20px) | 0 | Code blocks, SQL, JSON, tool inputs/outputs (mono) |
| `type-code-inline` | 0.92em of parent | 400 | inherit | 0 | Inline code, IDs, paths (mono) |
| `type-chart` | 11px axis, 12px legend, 13px tooltip | 400 | 1.3 | 0 | ECharts and canvas text |

Rules for use:
- A component picks a **token**, never a size.
- Mono is for machine-readable content only. If the text is a sentence, it is sans.
- Uppercase text uses `type-label` or `type-eyebrow` and no other.
- Coloured text takes its colour from `--text-*` / `--ink-*` role tokens (contrast-checked), not from opacity.
- In dark mode the type metrics are identical; the only allowed theme difference is an optional `+0.005em` on `type-body` and `type-ui` (light-on-dark text reads tighter), to be judged visually, not assumed.

### 8.4 Mapping from today's values (shows the migration is mostly rounding)

| Current | Share (rendered) | Maps to |
|---|---|---|
| 13 px | 60.1 % | `type-ui` / `type-ui-regular` |
| 15 px | 13.3 % | `type-body` |
| 13.5 px, 14, 14.5 px | ≈9 % | 13 or 15 |
| 10–12.8 px | ≈8 % | `type-caption` (12) or `type-eyebrow` (11) |
| 16–20 px | ≈3 % | `type-body-lg`, `type-title-section` |
| 22–44 px | ≈2 % | `type-title-page`, `type-display`, `type-kpi-*` |

---

## 9. Component-Level Recommendations

| Component / screen | Files | Fix |
|---|---|---|
| **Page titles** (all) | `estate/index.tsx:153,230`, `entities.tsx:110`, `lineage.tsx:119`, `ChatHistoryPage.tsx:390`, `agents/index.tsx:69`, `DashboardView.tsx:488`, `dashboards.tsx:120`, `evals.tsx:33`, `prompts.tsx:36` | One `<PageTitle>` component using `type-title-page`; Evals/Prompts titles become real sentence-case titles |
| **Shell, sidebar, breadcrumb** | `StagingSidebar.tsx:141`, `UserMenu.tsx`, `globals.css:1363-1368` | Section labels `type-eyebrow` in sans; remove the mono `!important` override |
| **Dashboard** | `DashboardView.tsx:98,202,426,488` | Greeting `type-display` 600 (not 800); KPIs `type-kpi-lg/md`, keep `tabular-nums` |
| **Estate tabs, filters, cards** | `EstateNav.tsx` (`views/agent-lab/estate/`), `InPageNav.tsx`, `JobsMiniTable.tsx`, `HeroSection.tsx`, `ChildJobsPanel.tsx` | Tabs `type-ui` sans; keep mono for cron strings and IDs only; card titles `type-title-card` with an ink colour that passes contrast |
| **Tables** (`EstateTable`, `ObjectTable`, `ColumnsTable`, `UserTable`, FOER tables) | `src/components/estate/*`, `users/UserTable.tsx` | One table style: header `type-label`, cell `type-ui-regular`, numerics `tnum`, IDs `type-code-inline` |
| **Inspector chat and answers** | `InspectorShell.tsx`, `StreamingMessage.tsx:21-23,52,110-301` | Prose `type-body-lg`; tool input/output blocks `type-code`; placeholder and empty states in sans; delete the misnamed `serif` constant |
| **Workbench** | `WorkbenchShell.tsx`, `InputComposer.tsx`, `globals.css:1150-1152,1239-1272,1400` | Replace `--display/--sans/--mono` with the global tokens; remove `!important` font overrides |
| **FOER / BORN / Teach** | `FoerOpsDashboard.tsx:436`, `FoerStoryDashboard.tsx:217`, `BanditsDashboard.tsx:285`, `foer-tokens.ts`, `born-tokens.ts`, `teach-tokens.ts` | Remove Google `@import`; collapse `SERIF/BODY/MONO` into the shared module; mojibake fix; KPI values with `type-kpi-*` and a non-wrapping layout |
| **Forms and settings** | `views/settings/profile.tsx`, `views/login.tsx` | Labels `type-label`; inputs `type-ui`; helper text `type-caption`; login buttons already match `type-body`/`type-ui` closely |
| **Charts** | `aloftDarkTheme.ts`, `inspectorEchartsTheme.ts`, `spinorEchartsTheme.ts`, `inspector-viz-tokens.ts`, `ssr-render.ts` | Source family and sizes from `type-chart`; make the server renderer use the same family |
| **Badges, chips, status pills** | `KindBadge.tsx`, `LifecycleBadge.tsx`, `DataReadinessPill.tsx` | `type-eyebrow` or `type-label`; never below 11 px |
| **Dialogs, drawers, popovers** | `PinToDashboardDialog.tsx`, `JobDetailDrawer.tsx`, `MemoryDrawer.tsx` | Titles `type-title-card`; body `type-body`; Times-serif titles removed (`JobDetailDrawer.tsx:383`) |
| **Login mascot canvas** | `AgentScene.tsx:8,497` | Use the sans token string; no visual change expected |

---

## 10. Implementation Architecture

### 10.1 Where definitions live

```
src/styles/typography.css        (new)  @font-face imports, --font-*, --text-* tokens, @layer base heading rules, .type-* classes
src/lib/typography/tokens.ts     (new)  exports the same values as typed constants for canvas, ECharts, SSR, inline styles
src/app/globals.css                     imports typography.css; scoped --display/--sans/--mono and font !important rules removed over time
tailwind.config.js                      fontFamily and fontSize read var(--font-*) / var(--text-*)
docs/DESIGN_SYSTEM.md                   typography section rewritten from the above
```

`web/src/main.tsx` already imports `@/app/globals.css`, and the Vite config reads Tailwind from the repo root, so no build change is needed.

### 10.2 How components consume it

1. **Tailwind first.** `theme.extend.fontSize` maps each token to a `text-*` utility with size, line height, weight and tracking (e.g. `text-title-page`, `text-ui`, `text-label`). Components write `className="text-title-card"` and nothing else for type. Keep the existing `text-xs/sm/base` as aliases during migration so nothing breaks, then remove them.
2. **CSS classes for non-Tailwind files.** `.type-*` classes in `@layer components` for CSS modules and legacy files.
3. **TS constants for the few places that need a string.** `FONT_SANS`, `FONT_MONO`, `CHART_TEXT` exported from `tokens.ts` for ECharts, canvas and SSR. The existing `SERIF/BODY/MONO/UI_FONT` exports become re-exports of these, so no importer breaks.
4. **Headings.** Base rules for `h1–h4` in `@layer base`, so unclassed headings are right by default; a `<PageTitle>` component for the common case.

### 10.3 Guards (so it stays fixed)

ESLint does not run in this repo today (per `docs/CHANGELOG.md`), so rely on Vitest, which does:

- A test modelled on `web/src/tailwind-content.test.ts` and `mc-palette-contrast.test.ts` that scans `src/**/*.{ts,tsx,css}` and fails on: a `fontFamily` string literal naming a font; a numeric `fontSize` or `px` literal outside `src/styles/typography.css` and `tokens.ts`; `font-weight` 700+; `@import url(http…)`; `font-family` in new `!important` rules. Start with an **allow-list of today's violations** (a baseline file), shrinking as migration proceeds, so the test is green on day one.
- A test asserting every `font-family` named in CSS has a matching `@font-face` or `@fontsource` import (this would have caught TYP-01).
- Optionally restore ESLint (`no-restricted-syntax` on `Property[key.name='fontSize']`), but that is a separate fix.

---

## 11. Prioritised Remediation Plan and Roadmap

### 11.1 What gives the most for the least disruption

| Rank | Change | Fixes | Effort | Disruption |
|---|---|---|---|---|
| 1 | Make every `Source Serif 4` / `Inter Tight` reference resolve to a loaded font (shim or codemod) | TYP-01, TYP-04 (partly), TYP-14 (partly) | S | Low: only Times headings change |
| 2 | Delete the two Google `@import` lines after D-1 | TYP-02 | S | Low |
| 3 | Set `body`/Tailwind `sans` to one family | TYP-03 | S | Medium: DM Sans → Inter metrics |
| 4 | Fix mojibake | TYP-17 | S | None |
| 5 | Add `typography.css` with tokens and base heading rules (no component changes) | enables everything | S | None |
| 6 | Page-title and table-header normalisation | TYP-08 | M | Medium |
| 7 | Uppercase mono → sans for tabs, eyebrows, empty states | TYP-07 | M | High (visible) |

### Phase 1 — Foundation (≈ 1 week, includes review)

1. Decide D-1.
2. Create `src/styles/typography.css` and `src/lib/typography/tokens.ts` with the §8 tokens. Import the former from `globals.css`.
3. Point `tailwind.config.js` `fontFamily` and `fontSize` at tokens; keep old keys as aliases.
4. Resolve TYP-01: either import the chosen display font or alias the 94 references to the token. Remove the Google imports (TYP-02).
5. Set `body` font and the base `h1–h4` rules. Drop the unused `@fontsource` packages (and DM Sans if option (a)).
6. Add the baseline-allow-list Vitest guard and the "every named font is loaded" test.
7. Update `DESIGN_SYSTEM.md`.

**Acceptance:** no route paints Times New Roman; one sans family in `body` and Tailwind; no network request to `fonts.googleapis.com`.

### Phase 2 — Consistency (≈ 2–3 weeks)

Migrate area by area, smallest blast radius first, each in its own PR with before/after screenshots: Settings and login → Dashboard → Users/Audit/Docs/Agents → Estate → Inspector and chat answers → Workbench (remove `!important`) → FOER/BORN/Teach and their token modules → charts and SSR renderer → TYP-15 numerics → TYP-16 contrast.

For each area: swap inline `fontSize`/`fontFamily`/`letterSpacing`/`lineHeight` for tokens, collapse weights to 400/500/600, shrink the allow-list.

### Phase 3 — Polish (≈ 1–2 weeks, partly subjective)

Tune density (move small text up to 12–13 px with layout adjustments), fluid titles, optional `opsz` axis for Inter at display sizes, FOUT handling (preload the body font, `size-adjust` fallback), dark-mode tracking check on real devices, remove the guard allow-list, and run the §12 review.

### 11.2 Migrating without breaking existing styling

- **Additive first.** Tokens and aliases land before any component changes; nothing is removed until it has zero users.
- **Alias, don't rewrite.** `SERIF`, `BODY`, `MONO` become re-exports of the new constants, so the 37 importing files do not change in Phase 1.
- **One area per PR,** with screenshots for light and dark at 1440 and 390.
- **Do not change colour in the same PR as type.** Contrast (TYP-16) is its own change.
- **Rollback is cheap** because each phase is token-level.
- **Order matters:** do not delete `@import` from FOER (TYP-02) before D-1, or the page loses its only working serif.

---

## 12. Validation and Acceptance Criteria

### Objective checks (automatable)

| # | Check | How | Target |
|---|---|---|---|
| A1 | No fallback rendering of a named font | Chrome `CSS.getPlatformFontsForNode` on `h1`, nav, table cell, code on every route in the e2e route list | 0 `System` fonts for text that names a web font |
| A2 | Distinct families | Computed `font-family` first value across all routes | ≤ 2 (sans, mono) |
| A3 | Distinct sizes | Computed `font-size` across all routes | ≤ 10 distinct values, all from the scale |
| A4 | Distinct weights | Computed `font-weight` | 400, 500, 600 only |
| A5 | Distinct tracking | Computed `letter-spacing` | ≤ 4 non-`normal` values |
| A6 | Small text | Share of characters < 12 px | < 2 % (eyebrows only) |
| A7 | Mono share | Share of characters in mono outside code/IDs | measured per route; sentences in mono = 0 |
| A8 | External font requests | Network log | 0 requests to `fonts.googleapis.com` / `gstatic.com` |
| A9 | Source guards | Vitest | 0 new `fontFamily` / `fontSize` literals, 0 `@import url(http` |
| A10 | Contrast | Computed text contrast, per theme | ≥ 4.5:1 body, ≥ 3:1 large, 0 uses of opacity on text |
| A11 | Heading consistency | First `h1` computed style per route | One style (allowing `type-display` on Dashboard/Teach) |
| A12 | Layout | Horizontal overflow at 390 / 820 / 1440 | None |
| A13 | Text-size preference | Root font size 24 px | All non-icon text ≥ 1.4× |

The probe scripts used here (route sweep, platform-font check, contrast, responsive) can be re-run against the same stubbed API from `web/e2e/fixtures.mjs`; they were run from a scratch directory and are not committed. Turning them into a committed script beside `web/e2e/smoke.mjs` is a reasonable first task for Phase 1.

### Subjective review (after Phase 2)

- Side-by-side screenshots of Dashboard, Estate Jobs, Inspector with an answer, a table-heavy page, FOER and Settings in both themes, reviewed by a designer and one daily user.
- "Squint test": at 50 % zoom, can page title, section, body and metadata be told apart on each page?
- Real data check: long vessel names, 7-digit KPI values, multi-paragraph AI answers, 30-column tables. This audit could not do this.

---

## Appendix A — Questions the brief asked, answered

1. **Which fonts are actually used?** DM Sans (body default), Inter (Tailwind and many inline), IBM Plex Mono (≈ half of characters on mono-heavy screens). Inter Tight and Source Serif 4 are named everywhere but never loaded, except from Google on two FOER pages; elsewhere they paint as Times New Roman (serif) or the system sans.
2. **Why does it feel poorly selected or inconsistent?** TYP-01, 03, 05, 07, 08: fallback Times headings, three sans families, no scale, mono in the chrome, and thirteen different page-title treatments.
3. **Font or implementation?** Implementation. The shipped fonts are sound.
4. **Missing design decisions:** a single sans; a scale; a heading definition; a rule for when mono is allowed; a weight map; a tracking set; a numeric convention; a floor for text size; who owns chart text; whether the serif is part of the brand.
5. **Best font system for the product:** Inter Variable + IBM Plex Mono, with the §8 tokens (Decision D-1 decides the serif question).
6. **Components needing correction:** §9.
7. **How to implement safely:** §10–11.

## Appendix B — Method

- **Source inventory:** ripgrep counts across `src/`, `web/src`, `tailwind.config.js`, `package.json`, `docs/DESIGN_SYSTEM.md` and `ARCHITECTURE.md`. Line numbers refer to the working tree at audit time; uncommitted files in the redesign branch were included.
- **Build inspection:** `web/dist/assets/index-D2WyfMSv.css` and the emitted font files.
- **Rendered sweep:** Vite dev server on port 5190, Chrome via `playwright-core`, 25 routes × 2 themes at 1440×900; per-text-element computed `font-family`, `font-size`, `font-weight`, `letter-spacing`, weighted by character count. Theme set by `localStorage.theme` before load.
- **Font identity:** `CSS.getPlatformFontsForNode` on selected elements in a fresh page per route, run with Google Fonts allowed and blocked.
- **Contrast:** custom WCAG ratio script using computed colour, alpha-composited background chain and element opacity (heuristic; see TYP-16).
- **Responsive:** 390×844 and 820×1180, overflow measured; one screenshot inspected.
- **Not done:** real-data layouts, macOS/Linux, screen-reader checks, print, user testing, measurement of font-swap layout shift, and a benchmark of candidate fonts.
