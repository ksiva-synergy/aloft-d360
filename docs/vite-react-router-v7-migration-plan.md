# Migration plan — Next.js UI → Vite + React Router v7

> **Status (2026-10-19): EXECUTED. This is the original plan, kept for history; the live record is [vite-migration/PROGRESS.md](./vite-migration/PROGRESS.md).**
> Two things differ from the plan below: the UI runs on Vite port 3000 with the API on 3001, and the Next pages were removed in the same change (Next is the API and auth server only).
> Everything marked **[measured]** was read from this
> repo on 2026-10-18; everything marked **[assumed]** is judgement or external knowledge and must be
> confirmed in the Phase 0 spike before it is relied on.
>
> **Origin:** [CHANGELOG.md](./CHANGELOG.md) → *UI redesign & Next.js 16 upgrade* §3.3 "Evaluated, not done":
> "Moving to Vite: fastest dev loop. The suggested route is a Vite + React Router v7 UI with Next kept as the API server."
>
> **Related:** [../ARCHITECTURE.md](../ARCHITECTURE.md) · [CHANGELOG.md](./CHANGELOG.md) · [memory/](./memory/)

---

## 1. TL;DR

| | |
|---|---|
| **What** | Move the *browser UI* (43 pages, 210 client components) from Next.js App Router to a **Vite-built React single-page app routed by React Router v7**. Next.js stays, but only as the **API server** (149 route handlers, next-auth, Prisma). |
| **Why** | Sub-second hot reload, a much simpler UI build, and no more App-Router coupling (server/client component rules, `params` Promises, caching surprises) in a UI that is already ~96% client components. |
| **What it does *not* give you** | New features, better runtime performance for users, or SEO. The app is behind a login, so SSR buys nothing. |
| **Size** | Mostly mechanical. **[measured]** Only **4 pages/layouts** contain real server-side logic; the other server pages are thin wrappers. Client code is clean: **0 of 210 client components reach database/server-only code**. A compatibility layer for `next/link`, `next/navigation` etc. lets ~200 components move without edits. |
| **Rough effort** **[assumed]** | 3–4 weeks for one engineer including QA; the spike (Phase 0) is 2–3 days. |
| **Biggest risks** | Azure AD / next-auth redirect and cookie behaviour across two dev servers; streaming (SSE) through the dev proxy; the change in **what Next 16 already improved** (see §3). |
| **Recommendation** | Do the **Phase 0 spike first** and decide go/no-go on measured numbers (§9). Do not start the full port before that. |

---

## 2. What "React Router v7" is (and the three ways to use it)

React Router v7 is the successor to both React Router v6 and **Remix**. It is one library with three modes:

| Mode | How routes are defined | Needs a server? | Fit for Aloft |
|---|---|---|---|
| **Declarative** | `<Routes><Route …/></Routes>` in JSX. Routing only. | No | Works, but no per-route data loading or code-splitting help. |
| **Data** | `createBrowserRouter([...])` with `loader` / `action` / `lazy` per route. | No | Good. Lowest magic; easy to adopt route-by-route. |
| **Framework** | A Vite plugin (`@react-router/dev`); routes in `app/routes.ts`, one *route module* per page with `meta`, `clientLoader`, `ErrorBoundary`. Can run with **`ssr: false`** = pure SPA build. | Not in SPA mode | Closest to what you have today (folders ↔ route modules, nested layouts, `meta` ↔ `export const metadata`). |

**Recommendation [assumed]: Framework mode with `ssr: false` (SPA mode).** It keeps a Next-App-Router-like mental model
(`(agent)` route group → a layout route; `[sessionId]` → `:sessionId`), gives automatic per-route code splitting, and builds
to static files. **Fallback:** Data mode (`createBrowserRouter` + `lazy`) if the spike shows the framework plugin adds friction.
Confirm against the *current* React Router docs during the spike — this plan was written from memory of the v7 API.

---

## 3. Honest cost/benefit

**[measured] Where the dev loop already is** (login page, from the changelog, after the Next 16 upgrade):

| | Next 15 | Next 16 (now) |
|---|---|---|
| Server ready | 8.3 s | 4.4 s |
| First page after restart | 15–24 s | 4.1 s |
| Revisit | 0.36 s | 0.09 s |
| `next build` | — | 167 s |

Vite would improve **HMR** (edit → browser, typically well under a second) and **cold start**, and a Vite production build is usually
much faster than 167 s **[assumed — measure it]**. But Turbopack's HMR is also fast, so the realistic gain is *smaller than when this
idea was first raised*. Worth doing if you value: a UI that no longer depends on Next at all, a simpler mental model, and the
option to deploy the UI as static files. Not worth doing if the goal is only "faster compile" — the spike tells you which.

**What you give up:** server components, `export const metadata`, Next's image optimiser (1 file uses it), automatic route
prefetch, and the single-process dev experience (you now run two servers).

---

## 4. Current state **[measured]**

| Fact | Value |
|---|---|
| Pages (`page.tsx`) | **43** across `(agent)/…`, `login`, `/` |
| Layouts | 3 (`app/layout.tsx`, `(agent)/layout.tsx`, `agent-lab/estate/layout.tsx`) |
| Dynamic routes | 9: `jobs/[id]`, `object/[id]`, `runs/[sessionId]`, `teach/[sessionId]`, `workbench/[sessionId]`, `docs/agents/[slug]`, `docs/tools/[slug]`, `inspector/[sessionId]`, `inspector/dashboards/[dashboardId]` (+ `/builder`) |
| API routes | **149** (`export const dynamic = 'force-dynamic'` on 147; `maxDuration` up to 600 s on a few) |
| Streaming (SSE) routes | 5: `inspector/chat`, `agent-lab/workbench/chat`, `inspector/teach`, `inspector/export`, `agent-lab/context/jobs/[id]/logs` |
| Client components (`'use client'`) | 210 (201 by directive count) |
| Server-component pages | 24, but **only 4 have real logic** (§5) |
| Files importing `next/*` | **208** — `next/navigation` 45, `next/link` 30, `next/dynamic` 2, `next/image` 1, `next/headers` 1, `next/font` **0** |
| Files touching `next-auth` | 123 (mostly API routes calling `getServerSession`) |
| Auth | next-auth v4: Credentials + Azure AD, JWT cookie. `src/proxy.ts` (Next 16 middleware) checks the token for **all** non-public paths **including `/api/*`**. |
| Fonts | `@fontsource*` npm packages — **no `next/font`** (good for Vite) |
| Public env vars | 3 references to `NEXT_PUBLIC_*` |
| Deploy | Docker `output: "standalone"` image → Elastic Beanstalk / ECS, one container, port 3000 |
| Test runner | Vitest 4 (already brings Vite as a dev dependency) |
| Shared package | `@aloft/shared` workspace (built with tsup) |

**[measured] Client/server hygiene:** I traced every `'use client'` file's *value* imports through the whole `src/` graph.
**0 of 210 reach Prisma, AWS SDK, `pg`, `bcryptjs`, `next-auth` server code or Node built-ins.** (Five files were flagged only
because they import `dagre`, a browser-safe graph-layout library.) This is the single most important de-risking fact: there is
no hidden server code in the UI bundle to untangle.

---

## 5. The 4 pages that contain real server logic

Everything else is `metadata` + a client component, or a `redirect()`.

| File | What the server does today | Replacement |
|---|---|---|
| `app/(agent)/layout.tsx` | `getServerSession` → `redirect('/login')` | `<RequireAuth>` route wrapper using `useSession()` from `next-auth/react` (works in an SPA against `/api/auth/session`). |
| `app/(agent)/dashboard/page.tsx` | Reads Prisma directly + session | New `GET /api/dashboard/summary`; page fetches it. |
| `app/(agent)/agent-lab/estate/jobs/[id]/page.tsx` | Session check + `notFound()` | Fetch job via existing API; render a not-found route component. |
| `app/(agent)/agent-lab/memory/ops/page.tsx` | Role check + `notFound()` | `useSession()` role check (UI hint) **plus** the API already enforces access — verify, don't trust the client. |

Also: `app/layout.tsx` reads a `theme` cookie server-side for `initialIsDark`. In an SPA this becomes the existing blocking
boot script (already present) setting `<html class="dark|light">`; `ThemeIsDarkProvider` reads the class instead of a prop.

---

## 6. Target architecture

```
DEV                                         PROD (same container, same origin)
───                                         ──────────────────────────────────
Browser ──► Vite :5173  (UI, HMR)           Browser ──► Next standalone :3000
              │  /api/* proxied                          ├─ /api/*   → route handlers (unchanged)
              ▼                                          └─ everything else → built SPA
           Next :3000  (API only)                            (public/ assets + index.html fallback)
```

**Decisions and why**

1. **Single origin in both dev and prod.** The browser only ever talks to one host (Vite proxies `/api` in dev; Next serves the
   static SPA in prod). This keeps next-auth cookies `SameSite=Lax`, avoids CORS entirely, and leaves the Azure AD callback shape unchanged.
2. **next-auth stays in Next** at `/api/auth/*`. The SPA uses `SessionProvider` / `useSession` / `signIn` / `signOut` from
   `next-auth/react`, which are plain `fetch` clients and work without Next pages.
3. **Keep `proxy.ts` but narrow it to `/api/*`.** Today it is the only gate on API routes. Removing it would silently
   unprotect 149 endpoints. Page-level protection moves to the SPA guard; API-level protection stays server-side.
4. **No SSR.** Pages are behind login; `ssr: false`.
5. **SPA is built to static files and served by the existing Next container** (a catch-all that returns `index.html` for non-API,
   non-asset paths). One image, one deploy, no new infrastructure.
6. **Strangler order:** build the new app *beside* the old one (new `web/` workspace). Next pages stay untouched until cut-over,
   so there is always a working app and the migration can pause safely.

---

## 7. Compatibility layer (the big accelerator)

Create shims and map them with Vite `resolve.alias`, so ~200 existing components compile **unchanged**; replace the shims with
native React Router imports gradually (or leave them).

| Next API | Used in | Shim behaviour (backed by React Router) |
|---|---|---|
| `next/link` | 30 files | `<Link href>` → RR `<Link to>`; support `prefetch`, `replace`, `scroll` props as no-ops. |
| `next/navigation` | 45 files | `useRouter()` → `{ push, replace, back, forward, refresh }` via `useNavigate`; `usePathname`; `useSearchParams` (read-only `URLSearchParams`); `useParams`; `redirect()`/`notFound()` implemented as thrown route responses. |
| `next/dynamic` | 2 files | `React.lazy` + `Suspense`; honour `{ ssr: false }` (no-op). |
| `next/image` | 1 file | Plain `<img>`. |
| `next/headers` | 1 file (`app/layout.tsx`) | Removed (see §5). |
| `export const metadata` | 8 pages | `meta()` route export, or a `usePageTitle()` hook. |
| `app/icon.png` / `icon.svg` | file convention | Move to `public/`, add `<link rel="icon">` to `index.html`. |
| `useSearchParams` write | e.g. FOER filters use `router.replace(?…)` | Covered by `useRouter().replace`. **Test carefully** — Next's `scroll:false` option and RR's navigation semantics differ. |

Known behavioural differences to test: `useRouter().refresh()` (Next re-runs server components; in an SPA it must refetch —
map to React Query `invalidateQueries` or a router revalidate), and Next's automatic `<Suspense>` boundary requirement for
`useSearchParams` (not needed in RR).

---

## 8. Phased plan

Each phase ends with something runnable and a clear exit test. Effort figures are **[assumed]** single-engineer estimates.

### Phase 0 — Spike and decision (2–3 days)
- Add a `web/` npm workspace: Vite + React 19 + `@react-router/dev` (SPA mode), Tailwind 3 (reuse `tailwind.config.js`,
  `postcss.config.mjs`, `globals.css`), `@aloft/shared`.
- Port **3 representative pages**: `login`, `agent-lab/runs/[sessionId]` (dynamic, API-driven, the cockpit we just rebuilt),
  and `agent-lab/memory` (query params + filters).
- Vite `server.proxy` `/api` → Next `:3000`; confirm login (Credentials **and** Azure AD), session, one SSE chat stream.
- **Measure** (§9) and write the numbers into this doc.
- **Exit:** go / no-go decision, and a final choice between Framework-SPA and Data mode.

### Phase 1 — Shell (3–4 days)
- Providers: `ThemeProvider` (`next-themes` works outside Next), `AuthSessionProvider`, theme + appearance boot scripts in `index.html`.
- `RequireAuth` guard; `/` redirect; `/login` public; 404 route.
- Root + `(agent)` layouts and the sidebar shell.
- Fonts via existing `@fontsource*` imports; icons to `public/`.
- **Exit:** logged-in user sees the real sidebar shell with an empty content area; refresh keeps the session; logged-out → `/login`.

### Phase 2 — Compatibility layer (2–3 days)
- Implement the shims in §7 and the Vite aliases; add unit tests for `useRouter` / `useSearchParams` behaviour.
- **Exit:** a client component that uses `next/link` + `next/navigation` renders and navigates in the Vite app with no edits.

### Phase 3 — Port pages (7–10 days)
Order by risk, smallest first. Counts are **[measured]**.

| Wave | Pages | Notes |
|---|---|---|
| A. Thin wrappers (~20) | `memory`, `memory/contributions`, `teach`, `teach/digest`, `teach/[sessionId]`, `runs`, `runs/[sessionId]`, `agent-staging/*`, `docs/*`, `history`, `workbench`, `inspector`, … | Wrap an existing client component; add `meta`. Mostly route-table entries. |
| B. Logic pages (4) | `dashboard`, `estate/jobs/[id]`, `memory/ops`, `(agent)/layout` | §5. Needs one new API route (`/api/dashboard/summary`). |
| C. Heavy interactive | `inspector`, `inspector/[sessionId]`, `workbench/[sessionId]`, `inspector/dashboards/[dashboardId]` + `/builder`, `estate/*` | Already client-side. Watch SSE streaming, large bundles, `echarts`/`@xyflow`/`recharts`. |
- **Exit per page:** loads, deep-link works, back/forward works, params/search work, no console errors; `tsc` + Vitest green.

### Phase 4 — Auth hardening (2–3 days)
- Dev: set `NEXTAUTH_URL` to the **Vite origin**; add that origin as an Azure AD redirect URI (**an outward-facing change in the
  Azure app registration — needs an owner**). Prod: unchanged (same origin).
- Narrow `proxy.ts` matcher to `/api/*`; keep public-path allow-list (`/api/auth`, `/api/health`).
- Verify: expired session → SPA redirects to `/login` and returns to the intended page; role-based UI matches API enforcement.
- **Exit:** both login methods work in dev and in a production-mode run; an unauthenticated `curl` to a protected API route returns 401.

### Phase 5 — Build and deploy (2–3 days)
- `Dockerfile`: add a Vite build stage; copy `web/dist` into the Next runner image; add the SPA fallback (Next `rewrites`
  fallback or a catch-all route handler serving `index.html`).
- Cache headers: hashed assets immutable; `index.html` no-cache.
- Elastic Beanstalk: no topology change expected **[assumed]** — verify health check path and the nginx `proxy_buffering` /
  `X-Accel-Buffering` behaviour for SSE.
- **Exit:** image builds in CI, deploys to a non-prod environment, smoke test passes.

### Phase 6 — Cut-over and cleanup (2–3 days)
- Remove Next `page.tsx`/layout files and unused shims; keep `app/api/**`, `proxy.ts`, `next-auth`.
- Update `ARCHITECTURE.md`, `AGENTS.md` (the "this is not the Next.js you know" block is only relevant to API code now), `CLAUDE.md`, the changelog.
- Rollback plan: keep the previous image tag; the old Next UI is one `git revert` away until Phase 6 lands.

---

## 9. Go / no-go: what to measure in Phase 0

| Metric | Today (Next 16) | How to measure | Decision hint |
|---|---|---|---|
| Dev server ready | 4.4 s [measured] | stopwatch, `npm run dev` → first byte | Want clearly better, not marginal |
| First page after restart | 4.1 s [measured] | same | |
| HMR (edit → visible) | not measured | save a leaf component, time to repaint | The main prize. Want **< 300 ms** |
| HMR of a heavy page (`DashboardBuilder`, ~1k lines) | not measured | same | Where Next hurts most |
| Production build | 167 s [measured] | `time npm run build` | |
| Initial JS (login → shell) | not measured | build output / DevTools | Must not regress badly |
| Memory of dev servers | not measured | Task Manager | Two processes now |

**Go** if HMR and build gains are large *and* the 3 pages port with only shim-level changes. **No-go** if gains are marginal
(then fix specific Next pain instead) or auth across the proxy proves fragile.

---

## 10. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Azure AD / next-auth redirect URI and `NEXTAUTH_URL` mismatch in dev | High | Blocks login | Phase 0 tests it first; document the extra redirect URI; owner approval for Azure change |
| 2 | Unauthenticated API exposure if `proxy.ts` is removed/mis-scoped | Medium | **Security** | Keep it, narrow to `/api/*`, add an automated 401 test per protected route group |
| 3 | SSE streams buffered or cut by Vite proxy / EB nginx | Medium | Chat appears frozen | Test in Phase 0 and Phase 5; existing `X-Accel-Buffering: no` header; no `compression` on the stream |
| 4 | Router semantic differences (`router.replace` + `scroll:false`, `refresh()`, search-param updates) | High | Subtle UI bugs (FOER filters, tab state) | Shim tests; manual pass on every page that calls `useRouter`/`useSearchParams` (45 files) |
| 5 | Bundle size grows (no server-side splitting; `echarts`, `@xyflow/react`, `recharts`, `framer-motion`) | Medium | Slow first load | Route-level code splitting; `manualChunks`; budget check in CI |
| 6 | `NEXT_PUBLIC_*` / `process.env` used in client code | Low | Undefined at runtime | 3 references only → `import.meta.env.VITE_*` |
| 7 | Two dev servers confuse the team / CI | Medium | Friction | One `npm run dev` that starts both (concurrently); document ports |
| 8 | Loss of server-rendered `metadata` | Low | Tab titles regress | `meta` exports / `usePageTitle`; 8 pages |
| 9 | The migration stalls half-way | Medium | Two UIs to maintain | Strangler layout + phase exit tests; Next UI stays shippable until Phase 6 |
| 10 | Benefit smaller than expected | Medium | Wasted effort | Phase 0 go/no-go on measured numbers |

---

## 11. Decisions needed

1. **Framework mode (SPA) vs Data mode** — recommended Framework/SPA; confirm after the spike.
2. **Who owns the Azure AD app registration** (to add the dev redirect URI) — needed for Phase 0/4.
3. **Repo layout** — `web/` workspace beside the Next app (recommended) vs a separate repo.
4. **Deployment target for the SPA** — served by the existing Next container (recommended, zero infra change) vs S3/CloudFront later.
5. **Acceptance bar** — which pages must be pixel/behaviour-checked by a person before cut-over.
6. **Timing** — whether to freeze large UI changes on `feature/ui-redesign` while the shell is ported.

## 12. Out of scope

React 19 / `lucide-react` 1.x upgrade (separate change, see changelog §3.3); replacing Next as the API server (e.g. Hono/Express);
SSR/SEO; redesigning pages; changing the database layer.

## 13. Checklist

- [ ] Phase 0 spike: Vite + RR7 app, 3 pages, proxy, login, one SSE stream
- [ ] Phase 0 measurements recorded in §9; go / no-go written down
- [ ] Phase 1 shell + `RequireAuth`
- [ ] Phase 2 shims with tests
- [ ] Phase 3 waves A → B → C
- [ ] Phase 4 auth hardening incl. Azure redirect URI and 401 tests
- [ ] Phase 5 Docker + EB smoke test
- [ ] Phase 6 cut-over, cleanup, docs, changelog
