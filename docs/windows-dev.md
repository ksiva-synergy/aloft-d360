# Windows local development (RDS / P1001)

You do **not** need a different production stack. Production and Docker already run **one Next.js process** on port 3000 (UI + API). The pain on Windows comes from **how** local dev was started, not from Vite or React as technologies.

## What P1001 means

Prisma **`P1001`** = the API process cannot open TCP to Aurora (`DATABASE_URL`). It is **not** caused by the Vite `/api` proxy.

### Measured on this repo (Windows — office VPN **and** home Wi‑Fi)

Run: `npm run db:diag`

| Test | Result |
|------|--------|
| **New raw TCP** to `:5432` each time | ~**40% fail** at **~21s** (`ETIMEDOUT 13.205.48.193`) |
| **One Prisma client, reuse connection** | **5/5 ok** (32–40ms after warm-up) |
| **New Prisma client + `$disconnect` each time** | Fails like your ping script — forces cold TCP |

So RDS is up, but **new TCP sessions from your Windows laptop to Mumbai often time out** — on corporate VPN **or home Wi‑Fi. That is internet path + Windows opening many connects, not “office network only.”

Mac on the same Wi‑Fi often feels fine because it opens fewer parallel DB connections and its TCP stack behaves differently. The app stack in this repo is the same.

**Do not** test with a script that calls `$disconnect()` after every query; that mimics failure on purpose.

### Home Wi‑Fi — what actually helps

| Approach | Verdict |
|----------|---------|
| Change React / Vite / Next stack | **No** — `db:diag` phase A fails before Prisma runs |
| Unified dev + `connection_limit=1` on Windows (`src/lib/db.ts`) | **Yes** — one warm tunnel; APIs queue on it |
| Stable dev in AWS **same VPC as RDS** (SSM port-forward, small EC2, Cloud9) | **Best** — no long-haul TCP from laptop |
| **RDS Proxy** endpoint for dev laptops | **Infra** — multiplex on one tunnel |
| Local Docker Postgres (`staging/docker-compose.staging.yml`) | **Offline only** — not shared dev data |

Quick check on home Wi‑Fi: same laptop, `npm run db:diag`. If phase **B** is 5/5 and **A** is flaky, the app config is doing what it can; intermittent UI errors mean something is still forcing **new** pools (second `next dev`, scripts that `$disconnect`, or `DEV_SPLIT=1` with two processes).

## Recommended paths (pick one)

### 1. Default on Windows — unified dev (no stack change)

Since Nov 2026, **`npm run dev` on Windows** runs **unified mode** automatically:

| | Split (old) | Unified (Windows default) |
|---|-------------|---------------------------|
| Processes | Vite :3000 + Next :3001 | **One Next :3000** |
| UI updates | Vite HMR | `npm run web:build`, refresh |
| RDS pools | Easier to get 2+ pools | **One pool** |
| Same as prod? | No | **Yes** |

```powershell
npm run dev:clean   # if a previous session left :3000/:3001 open
npm run dev
```

Open **http://127.0.0.1:3000**.

When you change React/UI files:

```powershell
npm run web:build
```

Then hard-refresh the browser.

Force split mode (Mac-style HMR on Windows — only if you accept RDS risk):

```powershell
$env:DEV_SPLIT="1"; npm run dev
```

### 2. Best long-term for Windows — WSL2 (Ubuntu)

Run the repo **inside Linux on WSL2**. Networking and file locking behave like macOS; you can use normal split `npm run dev` with HMR.

1. Install [WSL2 + Ubuntu](https://learn.microsoft.com/en-us/windows/wsl/install).
2. Clone the repo in the Linux filesystem (`~/aloft-ui-redesign`, not `/mnt/c/...`).
3. Install Node 20+, `npm ci`, copy `.env`.
4. `npm run dev` (split mode) or `DEV_UNIFIED=1 npm run dev`.

Use VPN on Windows host; WSL2 usually shares host network — if RDS fails only from WSL, use unified mode or VPN split-tunnel docs from IT.

### 3. Closest to deployed runtime — Docker

```powershell
docker build -f Dockerfile -t aloft-d360-web:local .
docker run --rm -p 3000:3000 --env-file .env.local aloft-d360-web:local
```

Linux container, single port, no Windows Defender on `node_modules`. Slow rebuild cycle; best for “does it run in prod?” checks.

### 4. Optional — local Postgres (no VPN to RDS)

For UI-only or offline work, use the staging Postgres compose (empty DB, not a copy of dev data):

```powershell
docker compose -f staging/docker-compose.staging.yml up -d
```

Point `.env.local` at `postgresql://aloft:aloft@127.0.0.1:5434/aloftdb` and run migrations. You lose shared dev catalog data unless you restore a dump.

## What not to do

| Idea | Verdict |
|------|---------|
| Switch from Vite + Next in **production** | **No** — EB/Docker already unified |
| Move frontend to Create React App / pure Vite prod | **No** — large rewrite, same RDS issue if API still on Windows |
| “Fix” with infinite Prisma retries | **No** — hides VPN/pool problems |
| Only use `localhost` in one tab and `127.0.0.1` in another | **Avoid** — breaks cookies/session |

## Scripts reference

| Command | Purpose |
|---------|---------|
| `npm run dev` | Windows → unified; Mac/Linux → split |
| `npm run dev:unified` | Force unified anywhere |
| `npm run dev:split` | Force Vite + API :3001 |
| `npm run dev:clean` | Kill stale :3000 / :3001 listeners |
| `npm run dev:api` | API only (split workflow) |

## Still failing?

1. Confirm VPN and one listener: `netstat -ano | findstr ":3000"`.
2. Test DB: `cmd /c "echo SELECT 1;" | node scripts/db/prisma-rds-retry.mjs db execute --stdin`.
3. If (2) is slow (>5s) or fails, fix **network/VPN** first — no application stack will be reliable.
4. Ask IT to exclude repo `node_modules` and `.next` from real-time antivirus scan.