# Context Harvester — AWS Deploy Notes

If AWS resources were deleted, start with **[aws-recreate-and-configuration.md](../docs/aws-recreate-and-configuration.md)** and **`infra/aws/env.template`**.

Run these commands yourself. No AWS commands are executed by this repo.

## Prerequisites

```
export AWS_REGION=ap-south-1
export ACCOUNT_ID=640012953890
export CLUSTER=aloft-agents-dev
```

## 1. Create log group

```
aws logs create-log-group --log-group-name /ecs/aloft-context-harvester --region $AWS_REGION
```

## 2. Create ECR repository

```
aws ecr create-repository --repository-name aloft-context-harvester --region $AWS_REGION
```

## 3. Register the task definition

```
aws ecs register-task-definition --cli-input-json file://infra/context/task-definition.json --region $AWS_REGION
```

Note the revision number from the output — use it in step 5.

## 4. Build and push the harvester image

```
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
docker build -t aloft-context-harvester -f Dockerfile.harvester .
docker tag aloft-context-harvester:latest $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/aloft-context-harvester:latest
docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/aloft-context-harvester:latest
```

## 5. Create EventBridge rules

Replace `TASK_DEF_ARN` with the ARN from step 3.

Daily change-detect (04:00 UTC):

```
aws events put-rule --name aloft-context-harvester-daily --schedule-expression "cron(0 4 * * ? *)" --state ENABLED --region $AWS_REGION
aws events put-targets --rule aloft-context-harvester-daily --region $AWS_REGION --targets file://infra/context/eventbridge-daily-target.json
```

Weekly full T1 profile (Sunday 03:00 UTC):

```
aws events put-rule --name aloft-context-harvester-weekly --schedule-expression "cron(0 3 ? * SUN *)" --state ENABLED --region $AWS_REGION
aws events put-targets --rule aloft-context-harvester-weekly --region $AWS_REGION --targets file://infra/context/eventbridge-weekly-target.json
```

Weekly estate re-inventory (Monday 06:00 UTC):

```
aws events put-rule --name aloft-estate-inventory-weekly --schedule-expression "cron(0 6 ? * MON *)" --state ENABLED --region $AWS_REGION
aws events put-targets --rule aloft-estate-inventory-weekly --region $AWS_REGION --targets file://infra/context/eventbridge-estate-inventory-target.json
```

The `eventbridge-rule.json` in this directory contains the full rule + target structure for reference. Split into per-rule target files before passing to `put-targets`.

## 6. Grant EventBridge permission to run ECS tasks

```
aws iam attach-role-policy --role-name ecsTaskExecutionRole --policy-arn arn:aws:iam::aws:policy/AmazonECS_FullAccess
```

## Secrets Manager layout expected by the task

All keys are read from the **`ALOFT`** secret (ARN suffix `ALOFT-scBxmq` in `task-definition.json`).

| Secret ARN suffix               | Key                    |
|---------------------------------|------------------------|
| `ALOFT` (JSON keys, e.g. `ALOFT-scBxmq` in ARN) | `DATABASE_URL`, `DIRECT_URL`, `DATABRICKS_*`, `XAI_*`, `FOUNDRY_*` (embed), optional `AZURE_OPENAI_*` (embed fallback) |
| `aloft/databricks`              | `DATABRICKS_CLIENT_ID` |
| `aloft/databricks`              | `DATABRICKS_CLIENT_SECRET` |

| JSON key in `ALOFT` secret | Used for |
|----------------------------|----------|
| `DATABASE_URL`, `DIRECT_URL` | Postgres / Prisma |
| `DATABRICKS_*` | Warehouse harvest |
| `XAI_API_KEY` | Estate harvest LLM (Grok 4.7) |
| `FOUNDRY_API_KEY` | Embedding **fallback** (Azure `text-embedding-3-large`) if Bedrock Titan fails |

Add `XAI_API_KEY` and `FOUNDRY_API_KEY` to the existing secret JSON if they are not there yet, then re-register the task definition (step 3).

### Estate harvest LLM / embeddings (task env)

| Source | Variables |
|--------|-----------|
| Plain env in `task-definition.json` | `HARVEST_XAI_MODEL`, `CONTEXT_HARVEST_MODEL`, `XAI_MODEL`, `BEDROCK_REGION`, `FOUNDRY_EMBEDDING_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`, `DEFAULT_ORG_*` — **do not** duplicate any name also listed under `secrets` |
| `aloftEcsTaskRole` (task role) | `bedrock:InvokeModel` on `amazon.titan-embed-text-v2:0` in **us-east-1** — no `AWS_ACCESS_KEY_ID` in the task |
| `ALOFT` secret (required JSON keys) | `DATABASE_URL`, `DIRECT_URL`, `DATABRICKS_*`, `XAI_API_KEY`, `FOUNDRY_API_KEY` (embed LLM fallback) |

Optional: add `FOUNDRY_ENDPOINT` / `FOUNDRY_EMBEDDING_ENDPOINT` to the secret **only if** you use Azure embed fallback and register them under `secrets` in the task def. Missing JSON keys in `secrets` block cause **ResourceInitializationError** before the container starts.

`XAI_MODEL` is **not** read from Secrets Manager — use plain env (`grok-4.7`) so the task does not require that JSON key.

**Primary embed:** Bedrock Titan via the Fargate task role. After changing IAM, secrets, or env, run **step 3** (register task definition) and push a new harvester image.

**Estate embed jobs:** catalog vectors use Bedrock Titan v2 (`amazon.titan-embed-text-v2:0`, `BEDROCK_EMBED_REGION` → `BEDROCK_REGION` → `us-east-1`) through the task role or a Bedrock API key. Rows are embedded in parallel; `EMBED_BULK_CONCURRENCY` sets the limit (1–16, default 8). There is no OpenAI fallback for catalog vectors because search only compares vectors from the same model.

## Required Env Vars — Org Resolution

These must be set in **every environment** (local `.env.local`, Vercel, CI).
Without them, all routes throw immediately — no silent fallback.

| Var | Example | Used by |
|-----|---------|---------|
| `DEFAULT_ORG_SLUG` | `smoke-test-org` | Async resolver (`src/lib/platform/agents.ts`) — all API routes |
| `DEFAULT_ORG_ID` | `cmq4rh3aj0000a96vgt6dlgqh` | Sync resolver (`src/lib/org.ts`) — Marcus DAL |

Both must reference the **same org**. The slug is looked up in `platform_orgs`;
the ID is used directly without a DB round-trip.

To find the correct values for a fresh environment:

```sql
SELECT id, slug FROM platform_orgs WHERE slug = 'smoke-test-org';
```
