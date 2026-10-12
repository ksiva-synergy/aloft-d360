# Docker — local build and test

Quick guide for building the **web** and **context harvester** images on your machine and smoke-testing them before CI pushes to ECR.

Repo root: `aloft-d360/` (where `package.json` and the Dockerfiles live).

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running (Linux engine on Windows/Mac).
- A working `.env` or `.env.local` with at least `DATABASE_URL` (and the auth/provider vars you need for the web app).  
  **Images do not include `.env`** (see `.dockerignore`). Pass env at `docker run` time.
- Optional: copy fields from `infra/aws/env.template` for AWS/ECS-related variables.

---

## Images

| File | Image purpose | CI job |
|------|----------------|--------|
| `Dockerfile` | Next.js web (standalone) | `build-web` in `.github/workflows/ecr-push.yml` |
| `Dockerfile.harvester` | Context orchestrator on Fargate | `build-harvester` |

---

## Build

From the repo root:

**Web**

```bash
docker build -f Dockerfile -t aloft-d360-web:local .
```

**Harvester**

```bash
docker build -f Dockerfile.harvester -t aloft-context-harvester:local .
```

First builds download Node deps and can take several minutes. Rebuilds are faster when layers are cached.

---

## Run the web app

Map port 3000 and inject your env file (use `.env.local` if that is what you use day to day):

```bash
docker run --rm -p 3000:3000 --env-file .env.local aloft-d360-web:local
```

If you only have `.env`:

```bash
docker run --rm -p 3000:3000 --env-file .env aloft-d360-web:local
```

**Smoke test**

- Open `http://localhost:3000`
- Health: `http://localhost:3000/api/health` (should return JSON when the app is up)

Sign-in and data features still need valid `NEXTAUTH_*`, Azure AD, Databricks, etc., in the env file—the container only proves the image builds and the server starts.

**Launch harvest jobs from the UI inside Docker**

Set `HARVEST_RUNTIME=ecs` and valid `ECS_*` / AWS credentials in the env file if you want the app to call `RunTask`. For everyday local dev, run the Next app on the host with `HARVEST_RUNTIME=local` instead (see below).

---

## Run the harvester (one-shot worker)

The harvester image runs the same entrypoint as Fargate: `scripts/context/orchestrator.ts`. It needs DB (and usually Databricks/Bedrock) env vars.

```bash
docker run --rm --env-file .env.local aloft-context-harvester:local
```

Run a specific job kind (matches ECS `containerOverrides`):

```bash
docker run --rm --env-file .env.local aloft-context-harvester:local \
  npx tsx --require ./scripts/context/noserver.cjs scripts/context/orchestrator.ts --kind change_detect
```

On Windows PowerShell, use a single line or backtick continuation instead of `\`.

---

## Local dev without Docker (recommended for harvester)

For Agent Lab / context jobs on your laptop, you usually **do not** need the harvester container:

1. Run Next.js as usual (`npm run dev`).
2. In `.env.local`, set `HARVEST_RUNTIME=local` so launch/reharvest spawns the orchestrator on your machine (see `src/lib/context/launch-harvester.ts`).

Use Docker when you want parity with **production images** (EB web image or Fargate harvester image).

---

## Troubleshooting

| Issue | What to try |
|--------|-------------|
| `npm ci` fails inside build | Run `docker build` from repo root; ensure `packages/` and `package-lock.json` are present. |
| Web build fails on `standalone` | `next.config.ts` must set `output: "standalone"` (already set on `feature/aws-infra-ecr` / main after merge). |
| Prisma OpenSSL warning (Alpine) | Common on harvester build; if runtime fails on Prisma, ensure the image has `openssl` / `libc6-compat` (Dockerfiles already install these for web). |
| App starts but 401 / login broken | Check `NEXTAUTH_URL=http://localhost:3000` and Azure redirect URI for local dev. |
| Harvester exits immediately | Check logs; confirm `DATABASE_URL` and network reachability to Aurora from your machine or VPC. |

---

## Push to AWS (not local)

After local builds look good, use CI or manual ECR push. See [deploy-beanstalk.md](./deploy-beanstalk.md) (web) and `infra/context/task-definition.json` (harvester on ECS).
