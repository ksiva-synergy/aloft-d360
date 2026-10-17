# AWS recreate + app configuration (ALOFT D360)

> **Cloud dev architecture:** [cloud-team-architecture-handoff.md](./cloud-team-architecture-handoff.md) · **Handoff form:** [aws-cloud-handoff-checklist.md](./aws-cloud-handoff-checklist.md)  
> **Master map (all services):** [platform-services-and-recreation.md](./platform-services-and-recreation.md)  
> **New target account (full stack + DB migration):** [aws-new-account-migration-guide.md](./aws-new-account-migration-guide.md)

Use this when **AWS resources referenced in the repo were deleted** and Cloud must provision them again **in the same account where Aurora still runs**. The app reads most settings from **environment variables**; a few JSON/infra files still contain **subnet / security group / account** placeholders you must update after recreate.

**Account (historical):** `454073573537`  
**Primary region:** `ap-south-1`  
**Bedrock model region:** `us-east-1`

---

## 1. What to recreate vs keep

| Service | Recreate in AWS? | App configuration |
|--------|------------------|-------------------|
| **RDS Aurora** | **Keep existing** — only if DB was deleted | `DATABASE_URL`, `DIRECT_URL`; allow **new EB SG** on 5432 — see [cloud-team-architecture-handoff.md](./cloud-team-architecture-handoff.md) |
| **IAM user/role + access keys** | Yes (keys invalid / resources gone) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| **Bedrock model access** | Enable models in console + IAM | `BEDROCK_REGION`, optional `BEDROCK_SONNET_MODEL_ID` |
| **ECS cluster** | Yes — `aloft-agents-prod` | `ECS_CLUSTER_NAME` |
| **ECR repos** | Yes — `aloft-context-harvester`, `aloft-agent-runner` | Image URIs in task defs / `AGENT_BASE_IMAGE` |
| **ECS task definitions** | Yes — register JSON / scripts | `ECS_CONTEXT_TASK_DEFINITION` |
| **CloudWatch log groups** | Yes — `/ecs/aloft-context-harvester`, `/ecs/aloft-agent-runner` | (task definition only) |
| **Secrets Manager** | Yes — `aloft/aurora`, `aloft/databricks` | ECS task secrets + app `secrets.ts` |
| **S3** | Yes — bucket `pbc-vessel-data` (or new name) | `BACKFILL_S3_*` |
| **EventBridge rules** | Yes — schedules in `infra/context/eventbridge-rule.json` | Update subnets/SG/ARNs in JSON, run `scripts/infra/apply-eventbridge.ps1` |
| **VPC networking** | Subnets + SG for Fargate (public IP if no NAT) | `ECS_SUBNET_IDS`, `ECS_SECURITY_GROUP_IDS` |
| **Elastic Beanstalk (web)** | Yes — if moving off Vercel | [deploy-beanstalk.md](./deploy-beanstalk.md); ECR `aloft-d360-web`; ALB + ACM; Aurora SG from EB instances |

---

## 2. Cloud team — create resources (order)

### 2.1 IAM

1. IAM user or role for **local dev / Beanstalk instance profile** (legacy: Vercel) with programmatic access:
   - `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream` in **us-east-1** (SDK Converse APIs map to these IAM actions)
   - `ecs:Describe*`, `ecs:RunTask` on cluster `aloft-agents-prod`
   - `secretsmanager:GetSecretValue`, `CreateSecret`, `PutSecretValue` on `aloft/*`
   - `s3:ListBucket`, `GetObject`, `PutObject` on backfill bucket
   - `logs:DescribeLogGroups`, `FilterLogEvents` (harvester logs UI)
2. **ECS task execution role** (pull ECR, write logs, read Secrets Manager).
3. **ECS task role** (runtime — Databricks/Bedrock from tasks if needed).
4. **EventBridge role** allowed `ecs:RunTask` on the cluster (often same execution role — confirm with your standard).

Deliver new **access key** or SSO profile instructions to the app team (never in git).

### 2.2 Data plane (ap-south-1)

| Step | Action | Repo reference |
|------|--------|----------------|
| A | Create S3 bucket (e.g. `pbc-vessel-data`) | `BACKFILL_S3_*` in `infra/aws/env.template` |
| B | Create Secrets Manager secrets | `scripts/infra/create-secrets.ps1` |
| C | Create log groups | `infra/context/deploy-notes.md` §1 |
| D | Create ECR repositories | `deploy-notes.md` §2; `provision-aloft-agents.sh` |
| E | Create ECS cluster `aloft-agents-prod` | `provision-aloft-agents.sh` |
| F | Security group for Fargate (egress 443, 5432 to Aurora) | `provision-aloft-agents.sh` §A4–A5 |
| G | Register task definition `aloft-context-harvester` | `infra/context/task-definition.json` |
| H | Register task definition `aloft-agent-runner` | `provision-aloft-agents.sh` §A6 |
| I | Build & push Docker images | `Dockerfile.harvester`, `agent-runner` build scripts |
| J | EventBridge rules + ECS targets | `infra/context/eventbridge-rule.json`, `apply-eventbridge.ps1` |

### 2.3 Bedrock (us-east-1)

- Request model access for Anthropic / Amazon Nova / Titan Embed as used by the app.
- Confirm region matches `BEDROCK_REGION`.

### 2.4 RDS

If Aurora **still exists**, only ensure **security group** allows:
- App hosts (Vercel/office IP or VPN)
- Fargate task security group on port **5432**

If Aurora was **deleted**, create a new cluster and give the app team the new writer endpoint for `DATABASE_URL`.

---

## 3. App team — after Cloud sends IDs

1. Copy `infra/aws/env.template` → `.env.local` and fill values.
2. Set **new** `ECS_SUBNET_IDS` and `ECS_SECURITY_GROUP_IDS` (comma-separated).
3. Update **`infra/context/eventbridge-rule.json`**: replace subnet IDs, security group, cluster ARN, task definition ARN, `RoleArn` if account/roles changed.
4. Update **`infra/context/task-definition.json`**: execution/task role ARNs, Secrets Manager ARNs, ECR image URI.
5. Run (with AWS CLI configured):
   - `aws ecs register-task-definition --cli-input-json file://infra/context/task-definition.json`
   - `powershell -File scripts/infra/apply-eventbridge.ps1`
6. Verify: `npm run check:endpoints` (and ECR/EventBridge probes if added).

Runtime ECS launches use **`src/lib/aws/ecs-runtime-config.ts`** (`ECS_*` env vars). Legacy subnet/SG IDs are fallbacks only until env is set.

---

## 4. Secrets Manager shape

| Secret name | JSON keys |
|-------------|-----------|
| `aloft/aurora` | `DATABASE_URL`, `DIRECT_URL` |
| `aloft/databricks` | `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`, `DATABRICKS_HOST`, `DATABRICKS_HTTP_PATH` |
| `aloft/databricks/{connectionId}` | `client_id`, `client_secret` (per-connection, created by app) |

---

## 5. Provisioning scripts (idempotent)

| Script | Purpose |
|--------|---------|
| `scripts/infra/provision-aloft-agents.sh` | ECS cluster, ECR `aloft-agent-runner`, log group, SG, agent task def; writes env block to `scripts/infra/audit/` |
| `scripts/infra/create-secrets.ps1` | Create `aloft/aurora` and `aloft/databricks` |
| `scripts/infra/apply-eventbridge.ps1` | Apply all rules from `eventbridge-rule.json` |
| `infra/context/deploy-notes.md` | Harvester ECR, task def, schedules |

**Before running `provision-aloft-agents.sh`:** edit `VPC_ID`, `SUBNET_*`, `AURORA_SG_ID`, and role ARNs at the top of the script if the old VPC objects were deleted.

---

## 6. Required information to configure correctly

Use **`docs/aws-cloud-handoff-checklist.md`** as the form Cloud returns when provisioning is done. Minimum fields:

| Area | Must have |
|------|-----------|
| **IAM** | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (secure); Bedrock in `us-east-1`, other APIs in `ap-south-1` |
| **RDS** | Writer host, user, password, DB name; SG allows app + Fargate SG on 5432 |
| **ECS** | Cluster name, task family, **subnet IDs**, **security group IDs**, public IP yes/no, execution + task role ARNs |
| **ECR** | Full image URIs for harvester and agent-runner (`:latest` pushed) |
| **Secrets Manager** | Secrets `aloft/aurora` and `aloft/databricks` with keys listed in §4; full ARNs for task definition |
| **S3** | Bucket name + region for `BACKFILL_S3_*` |
| **Logs** | Log group names matching task definitions |
| **EventBridge** | Rules enabled; same subnets/SG as ECS; role can `RunTask` |
| **Bedrock** | Model access + `BEDROCK_REGION=us-east-1` |

Copy completed values into **`infra/aws/env.template`** → `.env.local` (and Vercel production env). Update **`eventbridge-rule.json`** and **`task-definition.json`** when ARNs or network IDs change.

---

## 7. Ticket text for Cloud (short)

> Please recreate ALOFT D360 AWS resources in **454073573537 / ap-south-1**: ECS cluster **aloft-agents-prod**, ECR **aloft-context-harvester** and **aloft-agent-runner**, task definitions, log groups **/ecs/aloft-context-harvester** and **/ecs/aloft-agent-runner**, Secrets Manager **aloft/aurora** and **aloft/databricks**, S3 **pbc-vessel-data**, EventBridge schedules per repo `infra/context/eventbridge-rule.json`, IAM for Bedrock (**us-east-1**) and ECS/Secrets/S3/Logs (**ap-south-1**). Return: new **subnet IDs**, **security group ID**, **IAM access keys** (secure channel), and confirm **RDS writer** endpoint if unchanged.

---

**Maintained with:** `docs/platform-services-and-recreation.md`, `infra/aws/env.template`, `docs/external-apis-and-providers.md`, `docs/endpoint-inventory-and-health.md`
