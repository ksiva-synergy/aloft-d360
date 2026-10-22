# Vite + React Router v7 migration — code analysis

Companion to [../vite-react-router-v7-migration-plan.md](../vite-react-router-v7-migration-plan.md) (the plan) and
[PROGRESS.md](./PROGRESS.md) (the tracker). This file records **what the code actually contains**, measured on
2026-10-18 by reading the repo and tracing its import graph. Nothing here is an estimate unless marked.

## 1. Method

| Check | How |
|---|---|
| Route inventory | Script walked `src/app/**` (excluding `api/`), recording per file: `'use client'`, `async`, props, `metadata`, `redirect`, `notFound`, `getServerSession`, `prisma`, imports of `next/*`, line count. |
| Next API surface | `grep` of every named import from `next/*` and every method called on the router. |
| Server-code leakage | Import-graph trace from all 210 `'use client'` files through value imports, flagging Prisma, `pg`, AWS SDK, `bcryptjs`, `jose`, `next-auth` (server), `next/headers`, `next/server`, `server-only`, Node built-ins. |
| Runtime/env | `process.env` in client-reachable code; React-19-only APIs; `'use server'`; CSS and font imports. |
| Tooling | Node, npm, Vite, React, React Router versions; workspace and path-alias config. |

## 2. Route inventory — 46 route files

43 pages + 3 layouts (`app/layout.tsx`, `(agent)/layout.tsx`, `agent-lab/estate/layout.tsx`).

### 2.1 Client pages (import unchanged) — 24
`agent-lab/bandits`, `estate` (index), `estate/catalog`, `estate/entities`, `estate/jobs` (2,616 lines), `estate/lineage`,
`estate/mapper` (1,110), `estate/object/:id`, `estate/silo` (902), `metrics`, `ops/evals`, `ops/prompts`, `agent-staging/audit`,
`agent-staging/policies`, `agent-staging/try`, `agent-staging/users`, `docs`, `docs/agents`, `docs/agents/:slug`, `docs/tools`,
`docs/tools/:slug`, `inspector/dashboards`, `performance-lab`, `login`.

These are `'use client'` already; they only need `next/link`, `next/navigation`, `next-auth/react` to resolve. `docs/*/:slug` and
`object/:id` read the param with `useParams` (client-side).

### 2.2 Thin server wrappers, no Next-specific logic — 7
`agent-lab/history`, `agent-lab/memory`, `memory/contributions`, `teach`, `teach/digest`, `workbench`, `inspector`.
Plain components that render a client component. Their only Next-ism is `export const metadata`, which Vite simply ignores.
**Imported directly.**

### 2.3 Server wrappers that read `params` (async, `params: Promise<…>`) — 6
`runs/:sessionId`, `teach/:sessionId`, `workbench/:sessionId`, `inspector/:sessionId`, `inspector/dashboards/:dashboardId`,
`inspector/dashboards/:dashboardId/builder`. Async server components cannot render in a browser app, so each gets a ~5-line
adapter that reads `useParams()` and renders the same client component with the same props.

### 2.4 Redirect-only pages — 4
`/` → `/dashboard`, `agent-lab/runs` → `/agent-lab/history`, `agent-staging` → `/docs/agents`. (`app/page.tsx`, `runs/page.tsx`,
`agent-staging/page.tsx`.) Become `<Navigate replace>` routes.

### 2.5 Pages with real server logic — 3 pages + 1 layout
| File | Server work | Replacement |
|---|---|---|
| `(agent)/layout.tsx` | `getServerSession` → `redirect('/login')`; passes `session` to `UnifiedAgentSidebar` | `RequireAuth` (client) using `useSession()`; sidebar already falls back to `useSession()` (`session ?? initialSession`) |
| `dashboard/page.tsx` | Prisma user + RBAC + `getDashboardSummary` | **New** `GET /api/dashboard/summary`; client page fetches it and renders the existing `DashboardView` |
| `estate/jobs/:id/page.tsx` | session + `getJob` + `notFound()` | **Existing** `GET /api/agent-lab/context/jobs/:id` (returns `{ data: job }`, 404 when missing) |
| `memory/ops/page.tsx` | session + `getCurrentTopicMap` → `topicMap` prop | **New** `GET /api/agent-lab/memory/topic-map`; page fetches it |
| `app/layout.tsx` | reads `theme` cookie for `initialIsDark`; `metadata`; `<html>` boot scripts | `web/index.html` carries the same two boot scripts; `ThemeIsDarkProvider` seeded from the `<html>` class |

## 3. Next.js API surface (the compatibility layer must cover exactly this)

| API | Count | Detail |
|---|---|---|
| `useRouter` | 32 files | `push` ×45, `replace` ×6, `back` ×2, `refresh` ×1 (login page, after sign-in) |
| `usePathname` | 11 | |
| `useSearchParams` | 10 | read side; writes go through `router.replace` |
| `useParams` | 3 | |
| `redirect` / `notFound` | 5 / 2 | **only** in the server pages being replaced |
| `next/link` | 30 files | **no** `prefetch`, `scroll`, `replace`, `legacyBehavior`, `passHref` props anywhere |
| `next/dynamic` | 2 files | both `dynamic(() => import('echarts-for-react'), { ssr: false })` |
| `next/image` | 1 file | `BrandMark` (`src`, `alt`, `width`, `height`, `priority`, `className`, `style`) |
| `next/script`, `next/font`, `next/server` in UI | 0 | `next/server` only in `lib/http.ts`, `lib/catalog-helpers.ts` (server libs) |
| `'use server'`, `generateStaticParams`, route segment config in UI | 0 | `dynamic = 'force-dynamic'` is the only config and is irrelevant client-side |

## 4. Server-code leakage — none
Of **210** client files, **0** reach database/AWS/server-only code through value imports. (5 files were flagged only for
`dagre`, which is browser-safe graph layout.) Type-only imports (e.g. `import type { … } from '@/lib/agent-ops/session-cockpit'`)
are erased by esbuild, so they do not drag server modules into the bundle.

## 5. Runtime and environment
- **React:** `react@18.3.1`. No React-19-only APIs (`use`, `useActionState`, `useFormStatus`, `useOptimistic`) in the UI.
- **Env vars:** no `process.env.*` in client-reachable code except `process.env.NODE_ENV` in `estate/mapper/page.tsx` →
  Vite `define`. Only 3 `NEXT_PUBLIC_*` references in the whole tree.
- **Auth client:** `useSession` ×14, `signIn` ×6, `signOut` ×2, `SessionProvider` ×8 — all from `next-auth/react`, which is a plain
  `fetch` client against `/api/auth/*` and works in a browser app.
- **CSS:** one global (`app/globals.css`), plus `@xyflow/react/dist/style.css` ×2. **Fonts:** `@fontsource*` via CSS `@import` (no `next/font`).
- **Assets:** `/synergy-mark.png`, `/synergy-group-logo.png` etc. from `public/` → Vite `publicDir: ../public`.
- **Aliases:** `@/*` → `src/*`, but `@/components/ui/*` and `@/lib/utils` resolve into `packages/aloft-shared/src` (most specific first).
  `@aloft/shared` is **not imported by name** anywhere in `src/`.
- **Tailwind 3.4:** `content` globs are relative to the working directory, so Vite must run from the repo root.

## 6. Tooling in place
Node 24.18, npm 11. Vite 7.3.6 and `@vitejs/plugin-react` 4.7.0 already installed (via Vitest). `react-router` not installed;
registry latest is 8.x, so this migration pins **7.x** as requested.

## 7. Decisions taken from the analysis
1. **Reuse, do not copy.** The Vite app imports page and component modules straight from `src/` through the `@` alias. Next keeps
   working, there is no duplicated UI code, and cut-over later is a file-move rather than a rewrite.
2. **Data mode** (`createBrowserRouter` + lazy routes) instead of Framework mode. The plan allowed either; Data mode needs only
   `@vitejs/plugin-react`, has no extra build plugin, and we only need route code-splitting, not typegen or route modules.
3. **Shims via Vite aliases** for `next/link`, `next/navigation`, `next/dynamic`, `next/image`, so the 200+ client components are untouched.
4. **Two additive API routes** (`dashboard/summary`, `memory/topic-map`); no existing route changes.
5. **Keep `src/proxy.ts`** (the only gate on `/api/*`); narrowing its matcher is deferred to cut-over so Next pages keep working meanwhile.
6. **Do not touch** the Azure AD app registration, the production database, or the running dev server.

## 8. Known risks specific to this code
- `estate/jobs/page.tsx` (2,616 lines) and `estate/mapper/page.tsx` (1,110) are large single files; they must lazy-load.
- `useSearchParams` consumers that write via `router.replace(?…)` (FOER filters) depend on `scroll: false`; the shim must preserve scroll.
- `login/page.tsx` calls `router.refresh()` after `signIn(..., { redirect: false })` — in a browser-only app navigation alone suffices.
- Azure AD sign-in redirects to `NEXTAUTH_URL` (the Next origin). In dev that means returning to `:3000`, not the Vite port (documented, not a bug).

## 9. Version decision: React Router 7.x now, 8.x later (decided 2026-10-18)
Checked against the npm registry on 2026-10-18:

| | React Router 7.18.4 | React Router 8.4.0 |
|---|---|---|
| Peer `react` / `react-dom` | `>=18` | `>=19.2.7` |
| Node engine | `>=20` | `>=22.22` |
| Released | 2026-09-15 | 2026-09-15 (8.0.0: 2026-06-17) |

- This repo runs **React 18.3.1**; React 19 is blocked on `lucide-react` 0.344 (changelog 3.3). v8 would force that upgrade first.
- `Dockerfile` builds on `node:20-alpine`, below v8's engine requirement.
- v7 is still patched in lockstep with v8, so it is a safe place to stay.
- Vite 8 is also released, but `@vitejs/plugin-react` 4.7.0 (installed) targets Vite 7; stay on **Vite 7.3.6**.
- **Upgrade order:** migrate on RR7 + React 18 → upgrade React/`lucide-react` → bump RR to 8 (and Vite/plugin-react to 8). Data-mode core APIs
  are expected to carry over; the v8 changelog has **not** been read yet, so treat that as unverified.
