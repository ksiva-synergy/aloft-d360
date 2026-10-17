# External APIs, Providers & Endpoints

**Last Updated:** 2026-09-25  
**App:** ALOFT D360 (`aloft-d360`)  
**Purpose:** Central reference for all external services, APIs, models, endpoints, credentials, and current operational status.

> **Living broken/fixed status:** maintain [ops-failure-log.md](./ops-failure-log.md) (agents: always-apply rule `.cursor/rules/ops-failure-log.mdc`). This file keeps endpoint/credential detail; the ops log is the source of truth for ❌/✅ over time.

> **Note:** Never commit real secrets. Values shown below are either placeholders or non-sensitive identifiers.

---

## 1. Large Language Model (LLM) & AI Providers

This is the most critical external dependency category.

### 1.1 Amazon Bedrock (Primary / Default)

| Item                  | Value |
|-----------------------|-------|
| **Provider**          | Amazon Bedrock (Anthropic + others via Converse API) |
| **Primary Model**     | `us.anthropic.claude-sonnet-4-6` (Sonnet 4.6) |
| **Default Model Key** | `sonnet-4-6` |
| **Region**            | `us-east-1` |
| **API Type**          | AWS SDK `BedrockRuntimeClient` → `ConverseCommand` / `ConverseStreamCommand` |
| **Credentials**       | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` |
| **Auth Method**       | Long-term IAM access keys (explicitly passed in code) |

**Supported Models (via Bedrock):**
- `us.anthropic.claude-sonnet-4-6` (default, production)
- `us.anthropic.claude-opus-4-6-v1`
- `us.anthropic.claude-haiku-4-5-20251001-v1:0`
- `us.amazon.nova-pro-v1:0`, `nova-lite`, `nova-micro`
- `us.meta.llama4-maverick-17b-instruct-v1:0`, etc.
- `mistral.mistral-large-3-675b-instruct`, Qwen, DeepSeek R1

**Key Code Locations:**
- `src/app/api/inspector/chat/route.ts` (model map + default)
- `src/lib/inspector/agent-loop.ts`
- `src/lib/inspector/chart-pipeline.ts`
- `src/lib/memory/synthesis/reflect.ts`
- `src/lib/marcus/reflect.ts`
- `src/lib/context/enrich.ts`, `mapping.ts`, `embed.ts`
- ~~`src/lib/boost/scorers/*`~~ — **moved to Foundry/Azure OpenAI** (2026-09-29); see §1.2

**Current Status (as of 2026-09-21):**
- ❌ **BROKEN** (Bedrock Converse / Inspector default / memory paths)
- Error: `UnrecognizedClientException` – "The security token included in the request is invalid" (HTTP 403)
- **Cause:** AWS access keys in `.env` are invalid or expired.
- **Mitigation:** Boost semantic + groundedness scorers no longer use Bedrock; embeddings are OpenAI/Foundry only.

---

### 1.2 Azure AI Foundry (OpenAI-compatible)

| Item                    | Value |
|-------------------------|-------|
| **Provider**            | Azure AI Foundry (OpenAI compatible) |
| **Endpoint**            | `https://pb-az-openai.cognitiveservices.azure.com` |
| **Base URL used**       | `{FOUNDRY_ENDPOINT}/openai/v1` |
| **Auth Header**         | `api-key` |
| **Primary Model**       | `gpt-5.4-PBC` |
| **Other Models**        | `grok-4.3-PBC`, `kimi-k2-6-PBC`, `DeepSeek-V4-Pro`, `o3-mini` |
| **Embedding Model**     | `text-embedding-3-large` via Foundry / Azure OpenAI only (Titan disabled) |
| **Boost scorers**       | Foundry chat (`gpt-6-luna` default; `BOOST_SCORER_MODEL`) via `src/lib/boost/scorers/llm-client.ts` |
| **Credentials**         | `FOUNDRY_API_KEY` |

**Key Code:**
- `src/lib/inspector/providers/foundry-chat.ts` (main agent loop for tool calling)
- `src/lib/inspector/providers/factory.ts`

**Current Status (as of 2026-09-21):**
- ❌ **BROKEN** — DNS resolution failure (`ENOTFOUND pb-az-openai.cognitiveservices.azure.com`)
- Likely requires specific network/VPN access or the endpoint has changed.

---

### 1.3 Azure OpenAI (Classic / Legacy)

| Item                    | Value |
|-------------------------|-------|
| **Provider**            | Azure OpenAI Service |
| **Endpoint**            | `https://azopenai-crewai.cognitiveservices.azure.com` |
| **Deployment**          | `gpt-5.4-PBC` |
| **API Version**         | `2024-12-01-preview` |
| **Reasoning Model**     | `o3-pro-PBC` (`AZURE_O3_REASONING_MODEL`) |
| **Credentials**         | `AZURE_OPENAI_API_KEY` |

**Usage:**
- Agent lab / backfill worker
- Fallback paths in `foundry-chat.ts`

**Current Status:**
- ❌ **BROKEN** — Connection error (same network resolution issue as Foundry).

---

### 1.4 Bedrock Mantle (OpenAI Gateway on AWS Bedrock)

| Item                    | Value |
|-------------------------|-------|
| **Provider**            | Amazon Bedrock (via OpenAI-compatible Mantle proxy) |
| **Endpoint Pattern**    | `https://bedrock-mantle.{region}.api.aws/openai/v1` |
| **Region**              | `us-east-2` (`BEDROCK_MANTLE_REGION`) |
| **Intended Model**      | `gpt-5.4-PBC` (GPT-5.4 via AWS) |
| **Credentials**         | `BEDROCK_MANTLE_API_KEY` (special Bedrock API key) |

**Current Status:**
- ❌ **BROKEN** — 401 "The security token included in the request is invalid."

---

### 1.5 xAI (Direct Grok)

| Item                    | Value |
|-------------------------|-------|
| **Provider**            | xAI (Grok models) |
| **Endpoint**            | `https://api.x.ai/v1` (or `XAI_BASE_URL`) |
| **API**                 | OpenAI-compatible |
| **Auth**                | `XAI_API_KEY` (Bearer token) |
| **Model**               | Controlled by `XAI_MODEL` (e.g. `grok-beta`, `grok-3`, `grok-4`) |
| **Model Key in UI**     | `grok-xai` (shows as "Grok 4.6 (xAI direct)" when XAI_MODEL=grok-4.6) |
| **Credentials**         | `XAI_API_KEY`, `XAI_MODEL` |

**Integration:**
- Added as additional option through the same `foundry-chat` OpenAI client path.
- Selectable in Inspector chat and Agent Lab when `XAI_API_KEY` is set.
- Falls back as default model if no AWS Bedrock credentials are present.

**Current Status (as of 2026-09-21):**
- Configurable as new fallback / additional provider.
- Not yet tested with live key.

**Usage in code:**
- `src/lib/inspector/providers/foundry-chat.ts` (resource 'xai')
- `src/lib/boost/models.ts` (BOOST_MODELS)
- `src/app/api/inspector/chat/route.ts` (MODELS_MAP + fallback logic)

---

## 2. Authentication

### 2.1 Azure Entra ID (Microsoft Identity)

| Item                    | Value |
|-------------------------|-------|
| **Provider**            | Microsoft Entra ID (Azure AD) |
| **Tenant ID**           | `5847cf3f-db1f-4d01-abcf-cbff4bdffc2d` |
| **Client ID**           | `2776d89e-0651-4ce3-a8b8-953358fec68d` |
| **Well-known**          | `https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration` |
| **Keys Endpoint**       | `https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys` |
| **Library**             | `next-auth` with Azure AD provider |

**Key Files:**
- `src/lib/auth.ts`
- `src/middleware/auth.ts`
- `src/app/api/auth/[...nextauth]/route.ts`

**Current Status:** Configured and appears valid (no recent test performed).

---

## 3. Database

### 3.1 PostgreSQL (Primary Database)

| Item                    | Value |
|-------------------------|-------|
| **Provider**            | AWS RDS (Aurora PostgreSQL compatible) |
| **Host**                | `aloft-prod-writer.c5nsyns7onlz.ap-south-1.rds.amazonaws.com` |
| **Port**                | 5432 |
| **Database**            | `aloftdb` |
| **Region**              | `ap-south-1` |
| **SSL**                 | `sslmode=require` |
| **ORM**                 | Prisma |
| **Connection Strings**  | `DATABASE_URL`, `DIRECT_URL` (same value currently) |

**Current Status:** Credentials present in `.env`. Not tested in recent health check.

---

## 4. Data Platform

### 4.1 Databricks (SQL Execution & Semantic Layer)

| Item                          | Value |
|-------------------------------|-------|
| **Provider**                  | Azure Databricks |
| **Workspace Host**            | `adb-4626041107022307.7.azuredatabricks.net` |
| **Workspace ID**              | `4626041107022307` |
| **HTTP Path (Warehouse)**     | `/sql/1.0/warehouses/21b0e034f0ff1de4` |
| **Auth**                      | OAuth M2M (Client Credentials) |
| **Token Endpoint**            | `https://{host}/oidc/v1/token` |
| **Execution API**             | Databricks Statement Execution API (`/api/2.0/sql/statements`) |
| **Credentials**               | `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET` |

**Key Files:**
- `src/lib/databricks/execute.ts` (guarded SQL execution)
- `src/lib/databricks/token-client.ts`
- `src/lib/inspector/tools.ts` (Inspector SQL tools)
- `src/lib/semantic/execute.ts`

**Full usage map (service principal, every call site, onboarding):** [databricks-auth-and-usage.md](./databricks-auth-and-usage.md)

**Current Status:** Credentials present. Connectivity not tested in last run.

---

## 5. AWS Infrastructure Services

### 5.1 Amazon ECS + ECR (Agent Runner)

| Service     | Details |
|-------------|---------|
| **Cluster** | `aloft-agents-prod` |
| **Region**  | `ap-south-1` |
| **Account** | `454073573537` |
| **Task Role** | `Anchorpoint-ECS-Tasks-Execution-Role` |
| **Execution Role** | `ecsTaskExecutionRole` |
| **Agent Image** | `454073573537.dkr.ecr.ap-south-1.amazonaws.com/aloft-agent-runner:latest` |
| **Subnets / SG** | Defined in `.env` |

**Used for:** Running long-running agent workloads outside the main Next.js process.

### 5.2 Amazon S3 (Backfill Data)

| Item                    | Value |
|-------------------------|-------|
| **Buckets**             | `pbc-vessel-data` (both upload and browse) |
| **Region**              | `ap-south-1` |
| **Purpose**             | Backfill data upload / browsing |

### 5.3 AWS Credentials (General)

Shared across:
- Bedrock (LLM)
- Databricks secrets access
- S3 operations
- ECS task operations

**Current Status of AWS keys:** Invalid (see Bedrock section above).

---

## 6. Analytics & Observability

| Service     | Env Vars (currently empty) | Status |
|-------------|----------------------------|--------|
| **PostHog** | `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_PERSONAL_API_KEY`, etc. | Not configured |
| **Alerts**  | `NOTIFICATION_FAILURE_ALERT_EMAIL` | Not configured |

---

## 7. Internal / Cross-System APIs

| API                        | Env Var                    | Current Value | Notes |
|----------------------------|----------------------------|---------------|-------|
| PBC Promotion API          | `PBC_PROMOTION_API_URL`    | (empty)       | Cross-system write |
| ALOFT Promotion Secret     | `ALOFT_PROMOTION_SECRET`   | (empty)       | — |
| Cron Authentication        | `CRON_SECRET`              | (empty)       | — |
| Inspector Service Token    | `INSPECTOR_SERVICE_TOKEN`  | (empty)       | For service-to-service auth |
| Vercel Token               | `vercel_token`             | (present)     | Deployment / CI |

---

## 8. Feature Flags (Related to External Services)

Many runtime behaviors are controlled by env flags:

- `MEMORY_INJECT_ENABLED`, `MEMORY_MMR_ENABLED`, etc.
- `MARCUS_REFLECT_ENABLED`
- `BACKFILL_BEDROCK_ENABLED`
- `INSPECTOR_AUTH_ENFORCE`

See `.env` and `ARCHITECTURE.md` §14 for full list.

---

## 9. Recent Health Check Summary (2026-09-21)

> Prefer the current matrix in [ops-failure-log.md](./ops-failure-log.md). Snapshot below kept for history.

| Provider                  | Model / Endpoint                     | Status | Error |
|---------------------------|--------------------------------------|--------|-------|
| Amazon Bedrock            | `us.anthropic.claude-sonnet-4-6`     | ❌     | Invalid security token (403) |
| Bedrock Mantle            | GPT-5.4 via Mantle (us-east-2)       | ❌     | Invalid token (401) |
| Azure AI Foundry          | `gpt-5.4-PBC`                        | ❌     | DNS not found |
| Azure OpenAI (classic)    | `gpt-5.4-PBC`                        | ❌     | Connection error |
| Databricks                | Workspace + SQL Warehouse            | ?      | Not tested |
| PostgreSQL (RDS)          | Aurora writer                        | ?      | Not tested |
| Azure Entra ID            | Login                                | ?      | Not recently tested |

---

## 10. Recommendations / Next Steps

1. **Immediate:** Rotate AWS `AKIA*` access keys and update `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
2. Ensure the IAM user has `bedrock:*` permissions in `us-east-1`.
3. Investigate network access for `pb-az-openai.cognitiveservices.azure.com`.
4. Consider moving secrets to AWS Secrets Manager or a proper secret store for production.
5. Add automated health checks for LLM providers on startup or via a `/health/llm` endpoint.

---

**Maintained by:** ALOFT Platform Team  
**Source of truth:** `.env` (local), ECS task definition + Secrets Manager (prod)
