# Context Harvester — AWS Deploy Notes

Run these commands yourself. No AWS commands are executed by this repo.

## Prerequisites

```
export AWS_REGION=ap-south-1
export ACCOUNT_ID=454073573537
export CLUSTER=aloft-agents-prod
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

| Secret ARN suffix               | Key                    |
|---------------------------------|------------------------|
| `aloft/aurora`                  | `DATABASE_URL`         |
| `aloft/aurora`                  | `DIRECT_URL`           |
| `aloft/databricks`              | `DATABRICKS_CLIENT_ID` |
| `aloft/databricks`              | `DATABRICKS_CLIENT_SECRET` |

Create or update these secrets before running the task.

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
