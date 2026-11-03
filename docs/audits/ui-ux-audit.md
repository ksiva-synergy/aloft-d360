# UI/UX audit register — Data 360 (Agent Lab)

Living register for the whole-app UI/UX redesign. Branding: keep Data 360 (light = Sage Studio terracotta accent, dark = sapphire on graphite). Tokens and rules: [`../DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md).

Priority: **P0** broken / data loss · **P1** blocks a task or a11y failure · **P2** inconsistent / degraded · **P3** polish.

## Progress

- [x] Batch 1 — Foundations: radius / height / focus / shadow / z-index / motion tokens; reduced-motion; `cn()` merge fix; shared primitives on tokens (Button, Input, Textarea, Select, Popover, Tooltip, Dialog, Card, Badge, Tabs, Table).
- [x] Users & access page redesign (reference implementation).
- [x] Dummy-data route sweep (1366 / 390 px, light; dark spot-checked): a local mock API with realistic fixtures (session-only, not committed) replaced the blocked real-data sweep. No crashes with realistic shapes.
- [x] Batch 2: page-by-page pass. Changes:
  - global radius remap
  - card radius tier
  - `transition-all` removed
  - one `h1` per page
  - unnamed and small targets fixed
  - estate tab bar redesigned
- [ ] Batch 3 — Page-by-page restyle onto tokens (most pages use hand-rolled markup, not the shared primitives).

## Method

Playwright sweep at 1366×800, light theme, collecting: page errors, `h1` presence, distinct border radii, font families, interactive targets < 24px, elements overflowing horizontally. **Caveat:** the first sweep ran with a fetch stub that returned `{}` for most `/api/*` calls, so "crash" entries below show code that is brittle against unexpected API shapes — not confirmed production crashes. They must be re-checked with real data.

## Route inventory & first-sweep results

Source: `web/src/router.tsx` (~59 routes incl. dynamic `:id`/`:slug`/`:sessionId` routes, not swept).

| Route | h1 | Distinct radii | Small targets | Overflow | Stub crash |
|---|---|---|---|---|---|
| /dashboard | – | – | 1 | – | yes |
| /agent-lab/bandits | – | 11 | – | – | – |
| /agent-lab/estate | ✓ | 7 | 1 | – | console error |
| /agent-lab/estate/catalog | – | 18 | 1 | **12 els** | – |
| /agent-lab/estate/entities | – | – | 1 | – | yes |
| /agent-lab/estate/jobs | – | 23 | – | – | – |
| /agent-lab/estate/lineage | ✓ | 12 | – | – | – |
| /agent-lab/estate/mapper | – | 10 | 1 | – | – |
| /agent-lab/estate/silo | – | 10 | 1 | – | – |
| /agent-lab/automate | – | – | 1 | – | yes |
| /agent-lab/history | ✓ | 11 | 2 | – | – |
| /agent-lab/knowledge | ✓ | 8 | – | – | – |
| /agent-lab/memory | – | – | 1 | – | yes |
| /agent-lab/memory/contributions | ✓ | 13 | – | – | – |
| /agent-lab/memory/ops | – | – | 1 | – | yes |
| /agent-lab/metrics | – | – | 1 | – | yes |
| /agent-lab/ops/evals | ✓ | – | – | – | – |
| /agent-lab/ops/prompts | ✓ | – | – | – | – |
| /agent-lab/teach | ✓ | **40** | 1 | – | – |
| /agent-lab/teach/digest | – | – | 1 | – | yes |
| /agent-lab/agents | ✓ | 16 | – | – | – |
| /agent-lab/agents/workbench | – | 27 | 1 | – | – |
| /agent-staging/models | – | – | 1 | – | yes |
| /agent-staging/audit | ✓ | 3 | – | – | – |
| /agent-staging/connections | ✓ | 8 | – | – | – |
| /agent-staging/policies | ✓ | 7 | – | – | – |
| /agent-staging/try | – | – | 1 | – | – |
| /agent-staging/users | ✓ | 29 | 4 | – | – (redesigned) |
| /docs | – | – | 1 | – | yes |
| /docs/agents | ✓ | 10 | 1 | – | console error |
| /docs/tools | – | – | 1 | – | yes |
| /inspector | – | 22 | – | – | – |
| /inspector/dashboards | ✓ | 3 | – | – | – |
| /performance-lab | – | – | 1 | – | yes |
| /settings/profile | ✓ | 24 | **18** | – | – |
| /(404) | – | – | 1 | – | – |

## Issue register

| ID | P | Area | Issue | Status | Verification |
|---|---|---|---|---|---|
| UI-001 | P1 | 11 routes (dashboard, estate/entities, automate, memory, memory/ops, metrics, teach/digest, models, docs, docs/tools, performance-lab) | Page throws when an API returns an unexpected shape (e.g. `{}`) instead of showing an error/empty state | Downgraded to P2: no crashes with realistic fixtures. Hardening against malformed payloads is still open. | Route sweep with stubbed + real API |
| UI-002 | P1 | /settings/profile | 18 interactive targets < 24px (WCAG 2.5.8) | Open | Sweep `smallTargets` = 0 |
| UI-003 | P2 | /agent-lab/estate/catalog | 12 elements overflow horizontally at 1366px | **Fixed**: no overflow at 1366 or 390px with fixtures | Sweep `overflowEls` = 0 |
| UI-004 | P2 | ~19 routes | No page `h1` (screen-reader landmark / title hierarchy) | **Fixed**: exactly one `h1` on every swept route. The visible title was promoted to `h1`, or an `sr-only` `h1` was added where the page shows no title. | Sweep `h1` present |
| UI-005 | P2 | teach (40), workbench (27), estate/jobs (23), profile (24), inspector (22) | Radius sprawl — 20–40 distinct radii per page | **Fixed** (batch 2):<br>- bare `rounded` remapped from 4px to 8px<br>- inline `borderRadius` values of 3–5 raised to 6 or 8<br>- card containers moved to `rounded-card`<br>No 3–5px radii remain except on 14px checkboxes. | Distinct radii ≤ 5 |
| UI-006 | P2 | Shared primitives | Hard-coded Tailwind palette (`slate/gray/orange/indigo`) ignored theme accent and graphite dark | **Fixed** (batch 1) | `web:typecheck`, users tests, DOM check of Invite dialog |
| UI-007 | P2 | Dialog | `duration-250` not in config (silent 150ms), `transition-all` | **Fixed** — `duration-dialog` enter / 150ms exit, `opacity,transform` only | DOM check |
| UI-008 | P2 | `cn()` | tailwind-merge dropped `text-size-*` type tokens when followed by a colour class; custom radius/duration/ease/shadow didn't merge | **Fixed** — `extendTailwindMerge` | `src/lib/__tests__/cn-merge.test.ts` |
| UI-009 | P3 | Global | `prefers-reduced-motion` handled ad hoc in 13 files | **Fixed** — global rule in `globals.css` | Manual |
| UI-010 | P3 | Global | 61 `transition-all` usages in pages | **Fixed**: explicit properties | grep count → 0 |
| UI-011 | P1 | history, inspector/dashboards, estate entities/jobs/catalog | Icon-only buttons have no accessible name; a menu button stays hidden until hover, so keyboard users can't see it; some hit areas are smaller than 24px | **Fixed**:<br>- `aria-label`s added<br>- `focus-visible` now reveals the hidden button<br>- 28px buttons or a `::after` hit-area expansion | Sweep `unnamed` = 0 |

## Not yet audited

Dynamic routes (`jobs/:id`, `object/:id`, `knowledge/:id`, `runs/:sessionId`, `teach/:sessionId`, `agents/:slug`, `workbench/:sessionId`, `docs/*/:slug`, `inspector/*/:id`), 390px mobile, dark theme, keyboard-only walkthroughs.
