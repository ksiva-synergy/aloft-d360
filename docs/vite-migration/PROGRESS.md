# Vite + React Router v7 migration — progress

> **Rule for this file:** a box is ticked only when the work is **built and tested**, with the evidence (command and result)
> next to it. "Written" is not "done". Anything not verified says so.
>
> Plan: [../vite-react-router-v7-migration-plan.md](../vite-react-router-v7-migration-plan.md) ·
> Analysis: [ANALYSIS.md](./ANALYSIS.md) · How to run: [../../web/README.md](../../web/README.md) · Changelog: [../CHANGELOG.md](../CHANGELOG.md)

**Overall status (2026-10-19): CUT OVER IN CODE, AUTOMATED CHECKS GREEN, NOT YET PROVEN WITH A REAL LOGIN OR DEPLOYED.**
Next.js no longer serves any page. It is the API and auth server only; the UI is the Vite + React Router v7 app. Everything below that
can be tested without credentials, a real database or a deployment has been tested and passes. The items under "Not verified" have not.

## Phase checklist

| # | Phase | Status | Evidence |
|---|---|---|---|
| 0 | Complete code analysis and decisions | ✅ | [ANALYSIS.md](./ANALYSIS.md) |
| 1 | Scaffold `web/` (Vite 7, React Router **7.18.4**, aliases, proxy, providers, auth guard) | ✅ | `web:typecheck` 0 errors; `web:build` ~43 s (vs 167 s for the old `next build`) |
| 2 | Compatibility layer (`next/link`, `next/navigation`, `next/dynamic`, `next/image`) | ✅ | web unit tests: 45 pass |
| 3 | All 43 pages routed | ✅ | `router.test.tsx`: explicit list of 43 URLs all resolve, no invented routes, every lazy page module loads; real-Chrome suite 54/54 on the production bundle |
| 4 | Auth and API gate | 🟡 | ✅ guard, redirects, login gate narrowed to `/api/**`, all 149 non-public API routes refuse a signed-out request. ⚠️ **real login (Credentials, Azure AD) not tested** |
| 5 | Production build and serving | ✅ (Docker image itself not built) | `npm run build` (UI then `next build`) succeeds with **0 page routes** in Next's route table; `next start` integration 22/22 |
| 6 | Cut-over: Next pages removed | ✅ done 2026-10-19 (you approved) | `src/app` has only `api/`, `favicon.ico`, `icon.*`, `globals.css`; guarded by a test that fails if any `page/layout/...` file returns |

## What changed in the cut-over

- **Pages moved** (`git mv`, history kept) from `src/app/**/page.tsx` to `src/views/**`: 31 pages. **12 pages deleted** because the browser
  app replaces them: `/`, `/dashboard`, `estate/jobs/:id`, `memory/ops`, `runs`, `runs/:sessionId`, `teach/:sessionId`,
  `workbench/:sessionId`, `inspector/:sessionId`, `inspector/dashboards/:dashboardId` (+ `/builder`), `agent-staging`.
  Also deleted: `app/layout.tsx`, `app/(agent)/layout.tsx`. The estate layout and nav moved to `src/views/agent-lab/estate/`.
- **`next.config.ts`:** rewrites every page URL to `public/spa/index.html` (always on; the `WEB_UI` flag is gone); `/spa/**` assets get immutable caching, `index.html` never caches.
- **`src/proxy.ts`:** now guards `/api/**` only (same `withAuth` behaviour as before for API calls). Pages are static public files; the SPA redirects signed-out users to `/login`.
- **Scripts:** `npm run dev` starts API (:3001) + UI (:3000); `npm run build` first builds the UI into `public/spa` (`prebuild`), then `next build`; `npm start` serves both.
- **Dockerfile:** no build argument any more; `npm run build` produces UI + API in one image.

## What was verified, and how (2026-10-19)

| Check | Command | Result |
|---|---|---|
| Type safety, web app + every page via the shims | `npm run web:typecheck` | 0 errors |
| Type safety, Next app (API) | `npx tsc --noEmit` | 0 errors |
| Existing test suite (regression) | `npx vitest run` | 63 files, **489 passed** |
| Web unit tests | `npm run web:test` | 7 files, **45 passed** |
| All 43 routes in real Chrome, **production bundle**, API stubbed | `WEB_E2E_MODE=preview npm run web:e2e` | **54 passed, 0 failed** |
| Production bundle has no server-only code | `npm run web:check-bundle` | clean |
| Full production build | `npm run build` | exit 0; **0 page routes** in Next's output |
| Real Next server serving the SPA | `npm run web:e2e:next` | **22 passed, 0 failed** |
| Login gate over the whole API | same suite | **all 149 non-public API routes** refuse a signed-out GET (307/401), none reached its handler; `/api/auth/*` and `/api/health` stay public |

The integration suite also confirms: page URLs and deep links return the SPA; JS assets are public and immutable-cached; `index.html` is never
cached; a missing asset is a real 404; the login page renders in the browser through Next with no errors; a signed-out visit to `/dashboard` ends on `/login`.

## Bugs found by testing and fixed

| Found by | Bug | Fix |
|---|---|---|
| Production-bundle e2e | **Infinite remount loop**: `UserMenu` calls next-auth `update()` on mount, which flips `status` to `loading`; `RequireAuth` unmounted the app on each flip, so `UserMenu` remounted and called `update()` again, forever. Hidden in dev by timing. | `RequireAuth` shows the loading screen for the first load only; regression test |
| Production-bundle e2e | `FoerOpsDashboard`/`ShelvesPanel` imported a constant from `lib/foer/topics.ts` (also imports the DB client), putting Prisma's browser stub in the bundle | constant moved to `lib/foer/constants.ts`; `web:check-bundle` scans for this |
| Production-bundle e2e | favicon links rewritten to a 404 path | HTML plugin restores `/favicon-*` |
| Dev e2e | stub fixtures used wrong shapes | fixtures follow the real types |
| Test infrastructure | e2e could hang silently (2 h 40 min once); a hung API failed UI checks | live progress, 25-minute watchdog, API health check with an 8 s limit |

## Post-cut-over fixes (2026-10-19)

| Symptom | Cause | Fix |
|---|---|---|
| Login page unstyled (no brand panel, one column) after the move | Tailwind only generates classes found in the files listed in `content`; `src/views` was not listed, so every class used only in the moved pages was dropped (tests checked behaviour, not looks) | `tailwind.config.js` now lists `src/views`; `web/src/tailwind-content.test.ts` fails if any folder containing JSX is not covered (verified to fail when `src/views` is removed). Confirmed by screenshot |
| Microsoft sign-in ends on `/login?error=OAuthCallback` | **Not** the secret and **not** the redirect URI: Microsoft accepts the configured client secret (token request succeeded) and accepts `http://localhost:3000/api/auth/callback/azure-ad`. The failure is later in the callback; the real reason is only in the server log | Dev-only mirror of next-auth error name and message (never tokens) to `.logs/next-auth.log`; login message no longer blames the secret. **Root cause still open: retry sign-in once, then read the log** |

## Not verified (honest list)

- **Real sign-in.** Credentials and Azure AD/Microsoft login were never run with real credentials. A Microsoft attempt on the *old* port layout failed
  with `error=OAuthCallback`; the cause has **not** been diagnosed and is not known to be related to this migration. With the UI now on :3000
  (= `NEXTAUTH_URL`) and the API on :3001, the callback should return through the UI with no Azure change; untested.
- **Real data.** Browser tests use stubbed API responses shaped from the real handlers. Every page still needs a human pass against real data.
- **SSE streaming** (Inspector/Workbench chat, job logs) through the Vite proxy and through Next-served static UI: not exercised.
- **The Docker image** was not built (the same steps were run directly); Elastic Beanstalk deployment and health checks were not tried.
  The image uses `node:20-alpine`; Vite 7 needs Node ≥ 20.19.
- **Visual parity**: compared by eye on the login page only.
- **Bundle size**: entry chunk 583 kB (181 kB gzip); no budget or comparison.
- A developer `next dev` server that was already running when the pages were deleted got stuck (it stopped answering). **Restart `npm run dev`.**

## Rollback

- File backup of every page, layout and config that was touched: `C:\ALOFT\backup-before-vite-cutover-20261019-0028\` (outside the repo).
- Git snapshot of the tracked working tree before the cut-over: `git stash show -p refs/backup/pre-vite-cutover` (ref `refs/backup/pre-vite-cutover`).
- Nothing was committed. The deleted/moved pages are also in the repo's `HEAD` (`git checkout HEAD -- src/app`) except local uncommitted edits, which the two backups above cover.

## Remaining work

1. Human pass on each page against real data and a real login (Credentials and Microsoft), including Inspector/Workbench chat streaming.
2. Diagnose the Microsoft `OAuthCallback` failure (API terminal prints the real reason); it may be an expired Azure secret.
3. Build the Docker image, deploy to a non-production environment, smoke-test.
4. Commit the work (nothing is committed yet) and review the diff.
5. Optional: React 19 + `lucide-react` upgrade, then React Router 8 (needs React ≥ 19.2.7 and Node ≥ 22.22); relocate `src/components` if desired.

## Log (newest first)

### 2026-10-19 — cut-over
- Backups taken, then pages relocated to `src/views`, replaced pages deleted, `next.config.ts`/`proxy.ts`/scripts/Dockerfile switched over, route test rewritten
  (explicit 43-URL contract + "no pages in `src/app`" guard), integration suite extended (22 checks incl. an all-API-routes sweep). All checks above green.
- Dev ports: UI :3000, API :3001.

### 2026-10-18 — built and tested
- `web/` app, shims, providers, `RequireAuth`, route table, adapters, 2 new API routes; 54-check browser suite, bundle scanner, unit tests; bugs above found and fixed.

### 2026-10-18 — Phase 0: analysis
- 46 route files, 208 `next/*` importers, 210 client components; decisions in [ANALYSIS.md](./ANALYSIS.md).
