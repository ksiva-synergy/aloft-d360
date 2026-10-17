# API & endpoint inventory + health (smoke test)

**Last run:** 2026-09-27  
**App:** `aloft-d360`

### Commands

| Script | What it checks |
|--------|----------------|
| `npm run check:integrations` | API route list + Postgres + all external probes |
| `npm run check:endpoints` | External + sample app routes |
| `npm run check:postgres` | RDS login + `SELECT 1` |
| `npm run check:api-routes` | Regenerates [api-routes.generated.md](./api-routes.generated.md) |

Loads `.env` then `.env.local` (local overrides).

---

## 1. External smoke test summary (latest)

Re-run: `npm run check:endpoints` — **24 probes** (PostHog excluded).

| | Count (typical with bad `AWS_*` keys) |
|--|------:|
| **OK** | ~15 (Azure, xAI, Foundry, Databricks, Postgres, app routes) |
| **Skip** | **1** (PBC promotion URL empty) |
| **Fail (blocking)** | **7** (ECS, Secrets Manager, S3×2, CloudWatch, Bedrock — same invalid IAM token) |
| **Expected fail** | **1** (legacy `azopenai-crewai` DNS) |

**Note:** ECS checks use **DescribeCluster** / **DescribeTaskDefinition** only — they do **not** start Fargate tasks.

### 1.1 Working

| Service | Probe |
|---------|--------|
| **Azure AD** | OIDC metadata HTTP 200 |
| **xAI Grok** | `/v1/models` HTTP 200 — Inspector, **Studio insights** (`XAI_MODEL` / Grok 4.7) |
| **Azure AI Foundry** | DNS + `/openai/v1/models` HTTP 200 (`FOUNDRY_ENDPOINT` / synde) |
| **Azure embeddings** | `text-embedding-3-large` POST HTTP 200 (`embed-client.ts`) |
| **Databricks** | OAuth token + **SQL warehouse `SELECT 1`** (`DATABRICKS_HTTP_PATH`) |
| **PostgreSQL RDS** | Prisma `SELECT 1` on `aloft-prod-writer…:5432` / `aloftdb` |
| **Local app** (when `npm run dev`) | `/api/auth/providers`, studio insights, inspector chat, databricks connections |

### 1.2 Failing or legacy

| Service | Status | Action |
|---------|--------|--------|
| **AWS Bedrock / shared IAM keys** | Invalid security token | Rotate `AWS_*` keys; blocks Bedrock, Titan fallback, ECS/S3/Secrets Manager |
| **Azure OpenAI crewai** | DNS `ENOTFOUND` | Remove or repoint `AZURE_OPENAI_ENDPOINT`; Studio insights uses xAI/Foundry |
| **Bedrock Mantle** | HTTP 404 on `/models` | Optional path; verify `BEDROCK_MANTLE_*` if you use GPT via Mantle |

---

## 2. Full external dependency matrix (nothing omitted)

Cross-check against [external-apis-and-providers.md](./external-apis-and-providers.md).

| # | Dependency | Env / config | In smoke script? | Used in code (examples) |
|---|------------|--------------|------------------|-------------------------|
| 1 | Azure Entra ID | `AZURE_AD_*`, `NEXTAUTH_*` | ✅ OIDC | `src/lib/auth.ts` |
| 2 | xAI Grok | `XAI_API_KEY`, `XAI_MODEL` | ✅ | `insights.ts`, `foundry-chat.ts`, inspector chat |
| 3 | Azure AI Foundry | `FOUNDRY_*` | ✅ | `foundry-chat.ts`, Foundry models |
| 4 | Azure embeddings | `FOUNDRY_EMBEDDING_*`, `AZURE_OPENAI_EMBEDDING_*` | ✅ | `src/lib/azure/embed-client.ts` |
| 5 | Azure OpenAI classic | `AZURE_OPENAI_*` (crewai) | ✅ DNS (expected fail) | `foundry-chat` resource1 (`gpt-5-4`) |
| 6 | Amazon Bedrock | `AWS_*`, `BEDROCK_REGION` | ✅ Titan embed | `agent-loop.ts`, memory, marcus, enrich |
| 7 | Bedrock Mantle | `BEDROCK_MANTLE_*` | ✅ (non-blocking) | `foundry-chat.ts` |
| 8 | Databricks SQL | `DATABRICKS_*` | ✅ token + `SELECT 1` | `src/lib/databricks/execute.ts` |
| 9 | PostgreSQL | `DATABASE_URL`, `DIRECT_URL` | ✅ | Prisma / all app data |
| 10 | AWS Secrets Manager | same `AWS_*` | ✅ ListSecrets (`aloft` filter) | `src/lib/databricks/secrets.ts` |
| 11 | Amazon ECS | `ECS_CLUSTER_NAME`, task def | ✅ DescribeCluster + DescribeTaskDefinition (no RunTask) | `context/jobs/launch`, `context/queue.ts` |
| 12 | CloudWatch Logs | AWS SDK | ✅ DescribeLogGroups | `context/jobs/[id]/logs` |
| 13 | S3 backfill buckets | `BACKFILL_S3_*` | ✅ HeadBucket (upload + browse) | Env for backfill; smoke test only |
| 14 | PostHog | `NEXT_PUBLIC_POSTHOG_*` | ⏭️ skipped by design | Not configured |
| 15 | PBC Promotion API | `PBC_PROMOTION_API_URL` | ✅ HTTP probe if set; **skip** if empty | Not wired in `src` yet |
| 16 | Cron / service auth | `CRON_SECRET`, `INSPECTOR_SERVICE_TOKEN` | ❌ | Internal auth headers |
| 17 | Vercel | `vercel_token` | ❌ | Deploy only |

**Recently changed (must retest after deploy):** Studio insights (`/api/agent-lab/studio/insights`), Grok 4.7 defaults, shared Azure embed client.

---

## 3. Internal Next.js API routes

**138 handlers** — full list: **[api-routes.generated.md](./api-routes.generated.md)** (regenerate with `npm run check:api-routes`).

| Prefix | Routes | Notes |
|--------|-------:|-------|
| `/api/agent-lab/*` | 65 | Studio insights, marcus, memory, context/estate, workbench |
| `/api/inspector/*` | 50+ | Chat, semantic, dashboards, boost, teach |
| `/api/access/*` | 3 | Roles / permissions (easy to miss in older docs) |
| `/api/databricks/*` | 5 | Connections, test, execute |
| `/api/catalog/*` | 8 | Agents & tools catalog |
| `/api/auth/*` | 1 | NextAuth |
| `/api/sessions`, `/api/users`, `/api/policies`, `/api/studio/*`, `/api/backfill/*`, `/api/audit-log` | remainder | Platform + backfill |

Most routes require a **NextAuth session** (`401` without cookie).

### High-value manual checks

| Method | Path | Depends on |
|--------|------|------------|
| GET/POST | `/api/agent-lab/studio/insights` | Grok / Foundry |
| POST | `/api/inspector/chat` | LLM provider |
| POST | `/api/databricks/connections/[id]/test` | Databricks |
| POST | `/api/databricks/connections/[id]/execute` | Databricks SQL |
| POST | `/api/agent-lab/context/jobs/launch` | Postgres + **ECS** + AWS keys |

---

## 4. Mapping to external-apis doc

| Section | Provider | 2026-09-27 |
|---------|----------|------------|
| §1.1 | Bedrock | ❌ IAM |
| §1.2 | Foundry (synde) | ✅ |
| §1.3 | Azure OpenAI crewai | ❌ DNS (legacy) |
| §1.4 | Bedrock Mantle | ⚠️ 404 on probe |
| §1.5 | xAI | ✅ |
| §2.1 | Azure AD | ✅ |
| §3.1 | PostgreSQL | ✅ query |
| §4.1 | Databricks | ✅ OAuth + SQL |
| §5 | ECS / S3 / Secrets / CloudWatch | ✅ probed (needs valid `AWS_*`) |
| §6 | PostHog | Skipped (not configured) |
| §7 | PBC promotion | Skip if URL empty; else HTTP probe |

---

## 5. Follow-ups

1. Fix **AWS access keys** — unblocks Bedrock, Titan embedding fallback, ECS jobs, Secrets Manager.
2. Update or drop **`AZURE_OPENAI_ENDPOINT`** crewai host; use Foundry/synde for anything still on resource1.
3. Add `XAI_*` to **`.env.local`** if you only run from local overrides (Foundry is already in `.env.local`).
4. Record status changes in [ops-failure-log.md](./ops-failure-log.md).
