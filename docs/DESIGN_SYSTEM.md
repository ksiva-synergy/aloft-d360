# Aloft D360 — Design System

**Brand:** Spinor Labs (rebranded from a Synergy Marine Group–inspired maritime theme)
**Product:** Agent Lab — "Design, stage, and operate AI agent pipelines. Powered by ALOFT."

This document captures the design system as it currently exists in the app. It is descriptive (what the code does today), not aspirational. The source of truth is:

- [`src/app/globals.css`](../src/app/globals.css) — CSS custom properties (design tokens) for both themes, plus component classes and keyframes.
- [`tailwind.config.js`](../tailwind.config.js) — Tailwind color scales, fonts, radii, shadows, and animations.
- [`src/app/layout.tsx`](../src/app/layout.tsx) — theme bootstrapping (anti-flash script).
- [`src/components/providers/ThemeProvider.tsx`](../src/components/providers/ThemeProvider.tsx) — `next-themes` wiring.

---

## 1. Theming architecture

### How the theme is applied

- The app uses **`next-themes`** with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, and `storageKey="theme"`.
- The active theme is expressed as a **class on `<html>`**: either `.dark` or `.light`.
- Tailwind is configured with **`darkMode: 'class'`**, so `dark:` variants key off the `.dark` class.
- A **blocking inline script** in [`layout.tsx`](../src/app/layout.tsx) runs before first paint. It reads `localStorage.getItem('theme')`, resolves `system` against `prefers-color-scheme`, and adds `dark`/`light` to `<html>` plus sets `style.colorScheme`. This prevents a theme flash on load.
- `<meta name="color-scheme" content="dark light">` is set in `<head>`.

### Reading the theme in JS

Use the SSR-safe [`useIsDark()`](../src/hooks/useIsDark.ts) hook when inline styles need to branch on theme. Before hydration it reads the `.dark` class directly off `document.documentElement`; after mount it uses `next-themes`' authoritative `resolvedTheme`. This keeps inline styles in sync with CSS variables without a half-light/half-dark flash.

### Token model

Design tokens are **CSS custom properties**. The base set is declared on `:root` (light values) and overridden inside the `.dark` selector. Some subsystems layer additional scoping:

- Global tokens: `:root` (light) → `.dark` (dark overrides).
- Some tokens have explicit **`.light`** overrides too (e.g. the Agent Lab shell nav), because the app ships an explicit light class rather than relying only on the absence of `.dark`.
- **Scoped subsystems** (Workbench, Agent Graph) define their own token namespace under a wrapper class (`.workbench-frame`, `.agent-graph`) with light defaults and a `.dark .<scope>` override block.

> **Note on the base palette:** `:root` (light) is a warm **parchment + Berkeley-navy + gold** brand palette. The base `.dark` block, however, is a **GitHub-style neutral dark** palette (`#0f1419` background, `#539bf5` primary blue) — it does **not** simply darken the parchment brand. Several newer subsystems (Workbench, Data Estate, Performance Lab) reintroduce the navy/gold brand identity in their own dark scopes.

---

## 2. Brand foundations

### Brand colors (from `tailwind.config.js` and brand tokens)

| Token | Hex | Role |
|---|---|---|
| Berkeley Navy | `#003262` | Primary brand color |
| Gold / Saffron | `#FDB515` | Accent brand color |
| Dark background | `#0D1B2A` | Brand dark surface |
| Light background | `#F5F2EB` | Brand parchment surface |

Brand aliases in Tailwind: `brand.navy` (`#003262`), `brand.gold` (`#FDB515`). Spinor brand tokens are also exposed as CSS vars: `--color-primary`, `--color-accent`, `--color-bg-dark`, `--color-bg-light`, `--color-text-primary`, `--color-text-muted`.

### Typography

Three typefaces, loaded via `@fontsource` in [`globals.css`](../src/app/globals.css):

| Family | Font | Usage | Tailwind alias |
|---|---|---|---|
| Sans (UI/body) | **Inter Tight** | Default UI text, labels, body | `font-sans`, `font-body` |
| Serif (display) | **Source Serif 4** | Headings, agent names, display | `font-serif`, `font-display` |
| Mono (code) | **IBM Plex Mono** | Code, terminal, section labels | `font-mono` |

`body` font stack: `'Inter Tight', var(--font-sans), Arial, Helvetica, sans-serif`.
Font fallbacks: sans → `Inter, system-ui`; serif → `Georgia`; mono → `JetBrains Mono, SF Mono, monospace`.

### Border radius

Deliberately small ("Spinor Labs: 4px base, 6px max"):

| Token | Value | Usage |
|---|---|---|
| `rounded-sm` | `4px` | Interactive elements — inputs, chips, buttons |
| `rounded-card` | `6px` | Surfaces — cards, panels |
| `rounded-brand` | `6px` | Max radius — do not exceed |
| `--radius` (CSS var) | `0.5rem` | shadcn-style base radius |

> `md`/`lg`/`xl` radii are intentionally **not** overridden — their appearance in JSX is treated as a violation to be surfaced, not silenced.

### Shadows

| Token | Value |
|---|---|
| `shadow-nav` (Tailwind) | `0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)` |
| `.shadow-card` (light) | `0 1px 3px rgba(0,0,0,0.04)` |
| `.shadow-card` (dark) | `0 1px 3px rgba(0,0,0,0.2)` |

---

## 3. Core semantic tokens (global)

These are the primary tokens most components consume. Light values are on `:root`; dark values on `.dark`.

| Token | Light (`:root`) | Dark (`.dark`) | Meaning |
|---|---|---|---|
| `--background` | `#F5F2EB` | `#0f1419` | App background |
| `--foreground` | `#0f172a` | `#e6edf3` | Default text |
| `--primary` | `#003262` | `#539bf5` | Primary action / brand |
| `--primary-foreground` | `#ffffff` | `#ffffff` | Text on primary |
| `--secondary` | `#1e3a5f` | `#1e40af` | Secondary |
| `--secondary-foreground` | `#ffffff` | `#ffffff` | Text on secondary |
| `--accent` | `#FDB515` | `#6cb6ff` | Accent |
| `--accent-foreground` | `#0D1B2A` | `#ffffff` | Text on accent |
| `--muted` | `#EDE9DF` | `#2d333b` | Muted surface |
| `--muted-foreground` | `#8892A4` | `#adbac7` | Muted text |
| `--border` | `#C8C2AD` | `#444c56` | Default border |
| `--border-subtle` | `#edf0f4` | `#373e47` | Subtle border |
| `--input` | `#ffffff` | `#2d333b` | Input background |
| `--ring` | `#003262` | `#539bf5` | Focus ring |
| `--card` | `#FFFFFF` | `#1c2128` | Card surface |
| `--card-elevated` | *(n/a)* | `#22272e` | Higher elevation |
| `--card-foreground` | `#0f172a` | `#e6edf3` | Card text |
| `--popover` | `#FFFFFF` | `#1c2128` | Popover surface |
| `--popover-foreground` | `#0f172a` | `#e6edf3` | Popover text |
| `--radius` | `0.5rem` | `0.5rem` | Base radius |

### Text hierarchy

| Token | Light | Dark |
|---|---|---|
| `--text-primary` | `#0f172a` | `#e6edf3` |
| `--text-secondary` | `#475569` | `#adbac7` |
| `--text-tertiary` | `#64748b` | `#768390` |

### Semantic status

| Token | Light | Dark |
|---|---|---|
| `--destructive` | `#dc2626` | `#f85149` |
| `--destructive-foreground` | `#ffffff` | *(inherits)* |
| `--success` | `#16a34a` | `#3fb950` |
| `--warning` | `#b45309` | `#d29922` |

### Shell surfaces

| Token | Light | Dark |
|---|---|---|
| `--shell-bg` | `#EDE9DF` | `#0b0e14` |
| `--main-bg` | `#F5F2EB` | `#0f1419` |
| `--header-bg` | `#F5F2EB` | `#11151d` |
| `--header-border` | `#C8C2AD` | `#252b37` |

### Navigation

| Token | Light (`:root`) | Light shell (`.light`) | Dark (`.dark`) |
|---|---|---|---|
| `--nav-bg` | `#f0f1f3` | `#F5F2EB` | `#0D1B2A` |
| `--nav-text` | `#1a2332` | `#0D1B2A` | `#e6edf3` |
| `--nav-hover` | `#e2e6ed` | `#E4DFCF` | `#0F2236` |
| `--nav-active` | `#003262` | — | `#FDB515` |
| `--nav-border` | `#d8dde6` | `#C8C2AD` | `#1E3A5F` |
| `--nav-section-label` | `#8892A4` | `#8A9BAD` | `#4a5068` |
| `--nav-item-text` | `#4b5563` | `#2C3E50` | `#8892A4` |
| `--nav-item-text-active` | `#003262` | `#003262` | `#FDB515` |

> The Agent Lab shell has an explicit `.light` override block (in addition to `:root`) so its sidebar uses the parchment brand rather than the cooler default nav grays.

### Chart tooltip

| Token | Light | Dark |
|---|---|---|
| `--tooltip-bg` | `rgba(255,255,255,0.95)` | `rgba(28,33,40,0.95)` |
| `--tooltip-border` | `#e5e7eb` | `#444c56` |
| `--tooltip-text` | `#374151` | `#e6edf3` |

### Table (dark only)

| Token | Dark |
|---|---|
| `--table-header-dark` | `#22272e` |
| `--table-row-hover-dark` | `#2d333b` |

---

## 4. Tailwind color scales

Full numeric scales defined in [`tailwind.config.js`](../tailwind.config.js):

- **`navy`** — 50–400 are cool indigo tints; `500 = #003262` (brand), 600–900 darken toward `#001028`.
- **`marine`** — sky-blue scale (`500 = #0ea5e9`).
- **`saffron`** — gold scale; `400 = #FDB515` (brand), fades to `#704a01` at 900.
- **`gold`** — `DEFAULT #FDB515`, `light #fec84b`, `dark #c48a0a`.
- **`success`** — teal scale (`500 = #14b8a6`).
- **`info`** — blue scale (`500 = #3b82f6`).
- **`warning`** — amber scale (`500 = #f59e0b`).
- **`danger`** — red scale (`500 = #ef4444`).
- **`terminal`** — `bg #0d1117`, `surface #161b22`, `border #30363d`, `muted #8b949e` (GitHub-dark palette for terminal UI).
- **`builder`** — a set of aliases mapped to the `--builder-*` CSS vars (theme-reactive; see §5).

---

## 5. Subsystem palettes

The app is composed of several distinct surfaces, each with its own token namespace. All define light values and dark overrides.

### 5.1 Agent Builder (`--builder-*`)

Also exposed as Tailwind `builder.*` colors (they reference the CSS vars, so they adapt to theme).

| Token | Light | Dark |
|---|---|---|
| `--builder-bg` | `#F5F2EB` | `#0D1B2A` |
| `--builder-surface` | `#EDE9DF` | `#0F2236` |
| `--builder-surface-raised` | `#E4DFCF` | `#162D44` |
| `--builder-border` | `#C8C2AD` | `#1E3A52` |
| `--builder-border-bright` | `#003262` | `#2A5070` |
| `--builder-gold` | `#FDB515` | `#FDB515` |
| `--builder-gold-dim` | `#C48A00` | `#C8901A` |
| `--builder-text` | `#0D1B2A` | `#F0F4F8` |
| `--builder-text-muted` | `#2C3E50` | `#8BAFC8` |
| `--builder-text-label` | `#5A6A7A` | `#5A82A0` |
| `--builder-green-live` / `--builder-green` | `#22C55E` | `#22C55E` |
| `--builder-amber-preview` / `--builder-amber` | `#F59E0B` | `#F59E0B` |
| `--builder-red-fail` / `--builder-red` | `#EF4444` | `#EF4444` |
| `--builder-text-secondary` | `#2C3E50` | `#8BAFC8` |

**`.builder-input` utility:** 2px radius, `--builder-border`, `--builder-surface` bg, gold focus border.

### 5.2 Activity-Tracking analytics (`--at-*`)

A violet-accented analytics palette (does not follow the navy/gold brand).

| Token | Light | Dark |
|---|---|---|
| `--at-bg-base` | `#F5F2EB` | `#0A0E27` |
| `--at-bg-gradient` | `#EDE9DF` | `#0D1238` |
| `--at-surface` | `#ffffff` | `#151A3A` |
| `--at-surface-hover` | `#f1f5f9` | `#1C2347` |
| `--at-border-subtle` | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.08)` |
| `--at-border-emphasis` | `rgba(0,0,0,0.10)` | `rgba(255,255,255,0.12)` |
| `--at-text-primary` | `#0f172a` | `#F1F3F9` |
| `--at-text-secondary` | `#475569` | `#A0A7C4` |
| `--at-text-tertiary` | `#94a3b8` | `#6B7299` |
| `--at-accent` | `#7C3AED` | `#7C3AED` |
| `--at-accent-secondary` | `#8B5CF6` | `#8B5CF6` |
| `--at-success` | `#10B981` | `#10B981` |
| `--at-warning` | `#F59E0B` | `#F59E0B` |
| `--at-error` | `#EF4444` | `#EF4444` |
| `--at-info` | `#3B82F6` | `#3B82F6` |

### 5.3 Workbench canvas (`--wb-*`) + `.workbench-frame` scope

Two layers exist: global `--wb-*` tokens, and a fuller scoped token set under `.workbench-frame` (light default + `.dark .workbench-frame` override). The scoped block is themed as "CERN control room at noon" (light) vs. deep navy (dark).

**Global `--wb-*`:**

| Token | Light | Dark |
|---|---|---|
| `--wb-canvas` | `#EDE9DF` | `#001f3f` |
| `--wb-surface` | `#E4DFCF` | `#0a1628` |
| `--wb-surface2` | `#DDD8C6` | `#0d1d33` |
| `--wb-muted` | `#5A6A7A` | `#4a6080` |
| `--wb-ink` | `#0D1B2A` | `#e8eef5` |
| `--wb-ink-dim` | `#2C3E50` | `#aeb9c7` |
| `--wb-border-subtle` | `rgba(13,27,42,0.10)` | `rgba(253,181,21,0.08)` |

**Scoped `.workbench-frame`** defines a richer set: surface stack (`--bg-base/surface/elevated/sunken`), borders (`--border-default/subtle/strong`), ink (`--text-primary/secondary/tertiary/muted`), brand (`--accent-gold/navy/gold-dim`), status (`--status-live #22C55E`, `--status-preview #F59E0B`, `--status-draft #6B7280`), functional shadows, a "live commission" green panel palette (`--live-*`), and typography vars (`--display`, `--mono`, `--sans`). It also carries **legacy aliases** (`--bg`, `--surface`, `--raised`, `--gold`, etc.) for inline styles in workbench components.

> In dark mode, `.workbench-frame`'s `--display` switches from Source Serif 4 to Inter Tight.

### 5.4 Guided blueprint palette (`--bp-*`)

Used by the Inspector guided dashboard builder to color measures / dimensions / undefined items. Light values are darkened for parchment legibility (there is a contrast test: `blueprint-palette-contrast.test.ts`).

| Token | Light | Dark |
|---|---|---|
| `--bp-card-bg` | `rgba(13,27,42,0.02)` | `rgba(0,0,0,0.15)` |
| `--bp-card-border` | `rgba(13,27,42,0.12)` | `rgba(136,146,164,0.2)` |
| `--bp-measure` | `#0F766E` | `#34D399` |
| `--bp-dimension` | `#1D4ED8` | `#93C5FD` |
| `--bp-undefined` | `#7C3AED` | `#C4B5FD` |

### 5.5 Data Estate (`--estate-*`)

The most extensive subsystem palette. Surfaces, text hierarchy, borders, plus **status chips**, **trust chips**, **role badges**, and **table striping**.

| Token | Light | Dark |
|---|---|---|
| `--estate-bg` | `#F5F2EB` | `#0a0d12` |
| `--estate-surface` | `#FFFFFF` | `#121922` |
| `--estate-raised` | `#FFFFFF` | `#111D2E` |
| `--estate-ink` | `#0D1B2A` | `#E8E6E1` |
| `--estate-text-secondary` | `#5A6A7A` | `#8B9BB5` |
| `--estate-text-muted` | `#8892A4` | `#5A6A85` |
| `--estate-text-dim` | `#aab3bb` | `#4a5765` |
| `--estate-border` | `rgba(0,50,98,0.12)` | `#1e2935` |
| `--estate-border-gold` | `rgba(0,50,98,0.12)` | `rgba(253,181,21,0.12)` |
| `--estate-hover` | `rgba(0,50,98,0.02)` | `#0e131a` |
| `--estate-active-bg` | `rgba(0,50,98,0.04)` | `rgba(253,181,21,0.08)` |
| `--estate-btn-border` | `#d0d6dc` | `#2a3a4a` |
| `--estate-th-bg` | `#FAFAF7` | `#0F2236` |
| `--estate-row-even` | `#FFFFFF` | `#111D2E` |
| `--estate-row-odd` | `#F7F7F5` | `#0F1A2E` |
| `--estate-role-badge-text` | `#003262` (navy on gold tint) | `#FDB515` (gold on gold tint) |

**Status chips** (bg / border / text triplets): `--estate-status-{success,error,warning,default}-*`.
**Trust chip:** `--estate-trust-confirmed-*` (navy in light, blue `#5B9DFF` in dark).
**Kind badge bg:** `--estate-kind-bg`.

**Per-role badge text** (`--role-badge-*`, also used by `UserMenu`):

| Role | Light | Dark |
|---|---|---|
| platform-admin | `#92400e` | `#FBBF24` |
| admin | `#1e40af` | `#93C5FD` |
| member | `#6b7280` | `#B6BECD` |
| readonly | `#9ca3af` | `#9CA6B5` |

### 5.6 Performance Lab (`--pl-*`)

Parchment + navy (light) vs. near-black + gold (dark). Includes a gradient token.

| Token | Light | Dark |
|---|---|---|
| `--pl-bg` | `#F5F2EB` | `#070b11` |
| `--pl-surf` | `#FFFFFF` | `#0d1520` |
| `--pl-surf2` | `#FAFAF7` | `#111a27` |
| `--pl-border` | `rgba(0,50,98,0.14)` | `rgba(253,181,21,0.12)` |
| `--pl-border2` | `rgba(0,50,98,0.22)` | `rgba(253,181,21,0.22)` |
| `--pl-txt` | `#0D1B2A` | `#e6ecf4` |
| `--pl-txt2` | `#5A6A7A` | `#8892A4` |
| `--pl-hair` | `rgba(0,50,98,0.12)` | `rgba(28,44,63,1)` |
| `--pl-hair2` | `rgba(0,50,98,0.06)` | `rgba(255,255,255,0.04)` |
| `--pl-stripe` | `rgba(0,50,98,0.03)` | `rgba(255,255,255,0.015)` |
| `--pl-grad` | `linear-gradient(135deg, rgba(253,181,21,0.12), #fff)` | `linear-gradient(135deg, rgba(0,50,98,0.4), #0f1a28)` |

### 5.7 BORN / Bandits (`--born-*`)

Parchment + navy (light) vs. near-black + navy (dark). Mirrored in JS at `src/lib/bandits/born-tokens.ts`.

| Token | Light | Dark |
|---|---|---|
| `--born-bg` | `#F5F2EB` | `#05090f` |
| `--born-surface` | `#FFFFFF` | `#0a1320` |
| `--born-border` | `rgba(0,50,98,0.14)` | `#16273d` |
| `--born-text-pri` | `#0D1B2A` | `#e8eef5` |
| `--born-text-sec` | `#445566` | `#8a9bb5` |
| `--born-text-mut` | `#7A8896` | `#5e7790` |
| `--born-hover` | `rgba(0,50,98,0.05)` | `#0d1a2a` |
| `--born-overlay` | `rgba(0,50,98,0.04)` | `rgba(255,255,255,0.04)` |
| `--born-overlay-2` | `rgba(0,50,98,0.07)` | `rgba(255,255,255,0.07)` |

### 5.8 Agent Graph (`.agent-graph` scope, `--ag-*`)

A large scoped design system for the node/edge canvas editor. Light defaults on `.agent-graph`, dark on `.dark .agent-graph`. Notable: this subsystem uses a **violet accent** (`#6d48f5` light / `#7c5cfc` dark), not the brand gold.

Categories of tokens:
- **Canvas & surfaces:** `--ag-canvas-bg`, `--ag-surface-1/2/3`, `--ag-page-bg`, `--ag-dot-pattern`, `--ag-minimap-bg`.
- **Accent:** `--ag-accent`, `--ag-accent-secondary`.
- **Borders & text:** `--ag-border`, `--ag-border-emphasis`, `--ag-text-primary/secondary/tertiary`.
- **Node interaction:** `--ag-node-selected-border/ring`, `--ag-node-hover-border/shadow`, `--ag-hover-bg`, `--ag-input-bg`.
- **Status dots:** `--ag-dot-{idle,running,success,failed,retrying}` (+ `-glow` variants). Running = amber, success = green, failed = red, retrying = blue.
- **Badges:** `--ag-badge-{nocfg,cfg,schema}-{bg,text,border}`.
- **Edge contract:** `--ag-edge-{stroke,active,typed-*,untyped-text,mismatch-*}`.
- **Buttons:** `--ag-btn-{run,ai,ghost}-*`, `--ag-save-ok/fail`.
- **Lifecycle pills:** `--ag-pill-{active,inactive}-{bg,text,border}`.
- **Health:** `--ag-health` (green) + `--ag-health-glow`.
- **Run tint:** `--ag-run-tint` (used by `.canvas-run-tint`).

Sample light→dark shifts:

| Token | Light | Dark |
|---|---|---|
| `--ag-canvas-bg` | `#EDE9DF` | `#0c0d0f` |
| `--ag-surface-1` | `#ffffff` | `#131416` |
| `--ag-accent` | `#6d48f5` | `#7c5cfc` |
| `--ag-text-primary` | `rgba(0,0,0,0.82)` | `rgba(255,255,255,0.88)` |
| `--ag-health` | `#16a34a` | `#4ade80` |
| `--ag-dot-running` | `#d97706` | `#fbbf24` |

### 5.9 Teach ("Marcus Reflect") surface

Intentionally **has no scoped palette**. The Teach components consume the app's own global light/dark tokens (`:root`/`.dark`). The prior prototype `--tm-*` palette was removed. What remains scoped under `.teach-surface`:
- A native, theme-aware **scrollbar** (uses `--border`).
- Pure-motion **keyframes** (`tm-spin`, `tm-shimmer`, `tm-pulse`, `tm-up`, `tm-ring`). `tm-ring` borrows `--primary` via `color-mix`.

> There is a JS token helper at `src/components/teach/teach-tokens.ts` for component use.

---

## 6. Component classes & utilities

Defined in [`globals.css`](../src/app/globals.css):

- **`.shadow-card`** — subtle card shadow (heavier in dark).
- **Navigation:** `.nav-container`, `.nav-link`, `.nav-link:hover`, `.nav-link.active`, `.theme-toggle`.
- **Sidebar:** `.sidebar-nav-item` (with animated shimmer sweep on hover via `::before`), `.sidebar-collapsed` variants, collapsed tooltip via `::after`, `.vessel-selector-dropdown` (z-index 9999, isolated stacking context).
- **`.builder-input`** — Agent Builder text input.
- **Agent Labs UI:**
  - Glow utilities: `.glow-{indigo,emerald,red,amber,violet,blue}` (colored box-shadow halos).
  - `.lab-shimmer-bg` (shimmer sweep, lighter in dark), `.lab-gradient-border` (animated multi-color underline), `.lab-kbd` / `.lab-kbd-dark` (keyboard key chips), `.lab-ring-spin-overlay`.
  - Scrollbars: `.agent-labs-scrollbar`, `.bandit-scrollbar`, `.wb-scroll`, `.teach-surface` scrollbar — all thin, accent-tinted.
- **Bandits:** `.bandit-card` (glassmorphism — `backdrop-filter: blur(12px)`, translucent surface, theme-aware), `.bandit-medal-{gold,silver,bronze}` (animated gradient text clip).
- **Workbench:** `.wb-mono`, `.wb-upper`, plus many `.light .workbench-frame .wb-*` component-polish rules (terminal, template cards, config panel, tabs, input dock, send button, pill menu, status bar).
- **Global scrollbar** (`::-webkit-scrollbar`): 8px, track = `--muted`, thumb = `--accent`, hover = `--primary`.

---

## 7. Motion / animation

### Global scrollbar & keyframes in `globals.css`

- **Maritime set** (legacy brand): `wave-rotate`, `wave-flow`, `beacon-rotate`, `cargo-sway`, `shimmer` + utility classes (`.maritime-wave*`, `.maritime-rotate-beacon`, `.compass-rose`, etc.).
- **Agent Lab set** (`lab-*`): `lab-shimmer`, `lab-gradient-x`, `lab-ring-spin`, `lab-count-pulse`, `lab-stagger-in`, `lab-slide-in-right`, `lab-float`, `lab-pulse-dot`, `lab-scale-in`, `lab-panel-fade`.
- **Supervisor Orbit / Gantt:** `brain-pulse`, `brain-pulse-success`, `orbit-beam(-reverse)`, `orbit-dot-travel`, `gantt-bar-grow`, `progress-ring-fill`, `node-check-pop`.
- **Bandits:** `bandit-slot-spin`, `bandit-arm-pull`, `bandit-shimmer`, `bandit-fade-in-up`, `bandit-pulse-glow`.
- **Workbench:** `blink`, `spin`, `pulse`, `haloPulse` (uses `--live-halo-*` tokens).
- **Agent Designer:** `msg-in`, `designer-node-in`.
- **Run mode:** `edge-flow` (`.edge-flowing`), `.plan-priority-high`.
- **Teach:** `tm-spin`, `tm-shimmer`, `tm-pulse`, `tm-up`, `tm-ring`.

### Tailwind animations (`tailwind.config.js`)

Enter/exit primitives: `fade-in/out`, `slide-in-from-{top,bottom,left,right}` (+ `-2`, `-4`, `-5` distance variants), `zoom-in-95`, `zoom-out-95`.
Lab set: `lab-glow`, `lab-shimmer`, `lab-float`, `lab-bar-grow`, `lab-ring-spin`, `lab-count-pulse`, `lab-gradient-x`, `lab-stagger-in`, `lab-scale-in`, `lab-slide-in-{left,right}`, `lab-slide-down`.
Misc: `shimmer`, `progress-slide`, `builder-dot-pulse`, `builder-toast-in/out`.
Custom easing: `transitionTimingFunction.sidebar = cubic-bezier(0.32, 0.72, 0, 1)`.

Plugin: **`tailwindcss-animate`**.

---

## 8. Practical guidance

- **Prefer semantic CSS vars over raw hex.** Use `var(--card)`, `var(--foreground)`, `var(--border)`, etc. so components track both themes automatically. Reach for a subsystem namespace (`--estate-*`, `--pl-*`, `--builder-*`, `--ag-*`) only inside that subsystem.
- **Prefer the theme-reactive Tailwind aliases** (`builder.*`, `brand.*`) or `dark:` variants over hardcoded colors.
- **Radius discipline:** `rounded-sm` (4px) for controls, `rounded-card` (6px) for surfaces; never exceed 6px. `md`/`lg`/`xl` in JSX are considered violations.
- **Theme branching in JS:** use `useIsDark()` — do not read `matchMedia` or `localStorage` directly.
- **Fonts:** `font-display`/`font-serif` (Source Serif 4) for headings & agent names, `font-sans`/`font-body` (Inter Tight) for UI, `font-mono` (IBM Plex Mono) for code and small caps-y section labels.
- **Two dark identities coexist:** the global `.dark` is a neutral GitHub-style dark; the branded subsystems (Workbench, Data Estate, Performance Lab, BORN) reassert navy/gold. When adding a surface, decide which family it belongs to and reuse that namespace rather than inventing new tokens.

---

## 9. Token source-of-truth map

| Concern | File |
|---|---|
| Global light tokens | [`src/app/globals.css`](../src/app/globals.css) `:root` |
| Global dark tokens | `globals.css` `.dark` |
| Explicit light shell overrides | `globals.css` `.light`, `.light .workbench-frame` |
| Scoped subsystem tokens | `globals.css` `.workbench-frame`, `.agent-graph` (+ `.dark` variants) |
| Component classes / keyframes | `globals.css` |
| Color scales, fonts, radii, shadows, animations | [`tailwind.config.js`](../tailwind.config.js) |
| Theme bootstrapping (anti-flash) | [`src/app/layout.tsx`](../src/app/layout.tsx) |
| `next-themes` provider | [`src/components/providers/ThemeProvider.tsx`](../src/components/providers/ThemeProvider.tsx) |
| Dark detection hook | [`src/hooks/useIsDark.ts`](../src/hooks/useIsDark.ts) |
| JS token mirrors | `src/lib/bandits/born-tokens.ts`, `src/components/teach/teach-tokens.ts` |
