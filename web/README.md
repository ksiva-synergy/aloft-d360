# web/ — the Aloft UI (Vite + React Router v7)

The browser UI of Aloft is this single-page app. **Next.js is now the API and auth server only**: `src/app/` contains route
handlers (`/api/**`, next-auth, Prisma) and no pages. The pages live in [`../src/views`](../src/views) and the shared
components in `../src/components`; this folder wires them into routes (`src/router.tsx`) with Vite.

History and evidence: [../docs/vite-migration/PROGRESS.md](../docs/vite-migration/PROGRESS.md) ·
[ANALYSIS.md](../docs/vite-migration/ANALYSIS.md) · [plan](../docs/vite-react-router-v7-migration-plan.md)

## Run it

Always run scripts from the **repo root** (Tailwind resolves its config and `content` globs from the working directory).

```bash
npm run dev          # starts the API (Next.js, :3001) and the UI (Vite, :3000) together; open http://localhost:3000
```

or in two terminals: `npm run dev:api` (API on :3001) and `npm run web:dev` (UI on :3000, proxies `/api` to :3001).

**The API must be running.** The UI is only the front end; sign-in, session and all data come from the Next.js server. If it is down you
see `ECONNREFUSED` in the Vite log and a 503 `API_UNAVAILABLE` from `/api/*`.

The UI owns :3000 because `NEXTAUTH_URL` and the Azure AD redirect URI already point there, so Microsoft sign-in returns through the UI
and nothing has to change in Azure (not yet tested with a real Microsoft login). Override with `WEB_PORT` / `WEB_API_TARGET`.

| Script | What it does |
|---|---|
| `npm run dev` / `dev:all` | API on :3001 + UI on :3000 |
| `npm run dev:api` | Next.js API only, on :3001 |
| `npm run web:dev` | Vite UI only, on :3000 (needs the API on :3001) |
| `npm run build` | **Production build**: builds the UI into `public/spa` (`prebuild`), then `next build` |
| `npm start` | `next start`: serves the UI and the API from one process |
| `npm run web:build` | UI only, to `web/dist` (assets under `/spa/`) |
| `npm run web:typecheck` | `tsc` over `web/` and every page it imports, resolved through the shims |
| `npm run web:test` | Unit tests (shims, auth guard, data routes, route table) |
| `npm run web:check-bundle` | Fails if `web/dist` contains Prisma, AWS SDK, bcrypt or secrets |
| `npm run web:e2e` | Real-Chrome smoke test of all 43 routes against the dev server, API stubbed in the browser |
| `WEB_E2E_MODE=preview npm run web:e2e` | Same, against the **production bundle** (also scans the bundle for server-only code) |
| `npm run web:e2e:next` | Real `next start`: SPA served for page URLs, login gate on the API, asset caching (run `npm run build` first; use `NEXT_DIST_DIR=.next-vite-test` to keep your `.next`) |

## How it fits together

| Concern | Where |
|---|---|
| Pages | `src/views/**` (31 pages) + adapters in `web/src/routes/adapters.tsx` (pages that read a route param or load data) |
| Routes | `web/src/router.tsx`, one entry per page, lazy-loaded; `handle.title` replaces Next `metadata` |
| `next/link`, `next/navigation`, `next/dynamic`, `next/image` | `web/src/compat/*`, aliased in `vite.config.ts` (components still import the Next names) |
| Login guard | `RequireAuth` (UX only; every API route is protected on the server) |
| Data for dashboard, FOER ops, job detail | `/api/dashboard/summary`, `/api/agent-lab/memory/topic-map`, `/api/agent-lab/context/jobs/:id` |
| Serving in production | Next answers every page URL with `public/spa/index.html` (rewrite in `next.config.ts`), serves `/spa/**` assets (immutable cache), and keeps `/api/**` |
| Auth gate | `src/proxy.ts` guards `/api/**` only; pages are public static files, the SPA redirects signed-out users to `/login` |

## Deploying

`docker build -t aloft-d360-web -f Dockerfile .` — the image runs `npm run build` (UI, then API) and starts the Next standalone server,
which serves both. One container, one port, one origin; no extra infrastructure.

## Known differences from the old Next UI

- No server components: pages that read the database now call a JSON API.
- `router.refresh()` re-runs route loaders only (there are none); navigation after sign-in already reloads data.
- Unauthenticated API calls get Next's login redirect (307 to `/login`), exactly as before; the SPA treats a non-JSON response as an error.
- Dev mode serves hundreds of unbundled modules; on a memory-starved machine Chrome can report `ERR_INSUFFICIENT_RESOURCES`. Use the production-bundle checks for heavy testing.
