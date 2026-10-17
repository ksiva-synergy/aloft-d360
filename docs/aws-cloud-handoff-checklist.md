# AWS handoff checklist (Cloud → ALOFT D360 app team)

Cloud completes the **Value** column and returns this document (or equivalent) via a **secure channel** for secrets.

**Dev architecture, diagrams, stack, functional/non-functional requirements:** [cloud-team-architecture-handoff.md](./cloud-team-architecture-handoff.md)  
**Step-by-step (new target account + DB migration):** [aws-new-account-migration-guide.md](./aws-new-account-migration-guide.md)  
**What / why / how-to each step (Cloud does DB migration):** [aws-build-steps-explained.md](./aws-build-steps-explained.md)  
**Done / pending (team working log):** [aws-migration-progress.md](./aws-migration-progress.md)  
**Step-by-step (same account, keep Aurora):** [aws-recreate-and-configuration.md](./aws-recreate-and-configuration.md)  
**Template env file:** `infra/aws/env.template`  
**Full service map:** [platform-services-and-recreation.md](./platform-services-and-recreation.md)

**Note:** **Aurora PostgreSQL already exists** — confirm endpoint; do **not** create a new cluster. **Elastic Beanstalk dev** is **new**. Other AWS items below were **used before** and may need **recreate** if deleted.

---

## A. Identity and regions

| # | Item | Maps to env / config | Value (Cloud fills in) |
|---|------|----------------------|-------------------------|
| A1 | AWS account ID | ARNs in task defs / EventBridge | |
| A2 | App IAM access key ID | `AWS_ACCESS_KEY_ID` | |
| A3 | App IAM secret access key | `AWS_SECRET_ACCESS_KEY` | *(secure channel only)* |
| A4 | Default AWS SDK region | `AWS_REGION` | `ap-south-1` |
| A5 | Bedrock region | `BEDROCK_REGION` | `us-east-1` |

---

## B. RDS Aurora PostgreSQL — **existing (keep)**

| # | Item | Maps to env / config | Value (Cloud fills in) |
|---|------|----------------------|-------------------------|
| B0 | Cluster status | — | **Existing — not recreated** |
| B1 | Writer hostname | `DATABASE_URL`, `DIRECT_URL` | |
| B2 | Port | (in URL) | `5432` |
| B3 | Database name | (in URL) | `aloftdb` |
| B4 | DB username / password | (in URL) | *(secure channel)* |
| B5 | Aurora security group ID | RDS console | |
| B6 | Dev **EB instance SG** allowed on Aurora (5432) | SG rule | Yes / No |
| B7 | **Fargate SG** allowed on Aurora (5432) | SG rule | Yes / No |
| B8 | SSL required | (in URL) | `sslmode=require` |

---

## L. Elastic Beanstalk — **dev (create new)**

| # | Item | Maps to env / config | Value (Cloud fills in) |
|---|------|----------------------|-------------------------|
| L1 | EB application name | — | `aloft-d360-web` |
| L2 | Environment name | — | `aloft-d360-dev` |
| L3 | HTTPS URL | `NEXTAUTH_URL` | `https://…` |
| L4 | **EB instance security group ID** | Aurora inbound rule | |
| L5 | EC2 instance profile ARN | IAM | |
| L6 | ECR web URI | `aloft-d360-web` | `…/aloft-d360-web:latest` |
| L7 | Web image pushed? | — | Yes / No |
| L8 | ACM certificate ARN (ap-south-1) | ALB HTTPS | |
| L9 | Dev DNS hostname | Entra redirect | |
| L10 | Instance type / count | — | `t3.medium` / `1` |

---

## C. ECS Fargate (context harvester — recreate if deleted)

| # | Item | Maps to env / config | Value (Cloud fills in) |
|---|------|----------------------|-------------------------|
| C1 | Cluster name | `ECS_CLUSTER_NAME` | `aloft-agents-prod` |
| C2 | Task definition family | `ECS_CONTEXT_TASK_DEFINITION` | `aloft-context-harvester` |
| C3 | Container name | `ECS_CONTEXT_CONTAINER_NAME` | `context-harvester` |
| C4 | Subnet IDs (comma-separated, 2+ for AZ) | `ECS_SUBNET_IDS` | |
| C5 | Security group ID(s) (comma-separated) | `ECS_SECURITY_GROUP_IDS` | |
| C6 | Assign public IP to tasks? | `ECS_ASSIGN_PUBLIC_IP` | `ENABLED` or `DISABLED` |
| C7 | ECS task execution role ARN | `ECS_EXECUTION_ROLE_ARN`, task def JSON | |
| C8 | ECS task role ARN | `ECS_TASK_ROLE_ARN`, task def JSON | |
| C9 | EventBridge → ECS role ARN | `infra/context/eventbridge-rule.json` → `RoleArn` | |
| C10 | Latest task definition revision ARN | EventBridge targets | |

**Network:** Fargate tasks need egress to **HTTPS (443)** (Bedrock, Databricks, Azure) and **PostgreSQL (5432)** to Aurora. Ingress is usually not required on the task SG.

---

## D. ECR and images

| # | Item | Maps to env / config | Value (Cloud fills in) |
|---|------|----------------------|-------------------------|
| D1 | **Web** repository URI | `aloft-d360-web` | `…/aloft-d360-web:latest` |
| D2 | Harvester repository URI | `infra/context/task-definition.json` → `image` | `…/aloft-context-harvester:latest` |
| D3 | Agent runner repository URI (optional) | `AGENT_BASE_IMAGE` | `…/aloft-agent-runner:latest` |
| D4 | Images pushed and tagged `latest`? | — | Yes / No |

---

## E. CloudWatch Logs

| # | Item | Maps to env / config | Value (Cloud fills in) |
|---|------|----------------------|-------------------------|
| E1 | Harvester log group | task def `awslogs-group` | `/ecs/aloft-context-harvester` |
| E2 | Agent runner log group | agent task def | `/ecs/aloft-agent-runner` |
| E3 | Log region | task def | `ap-south-1` |
| E4 | EB log streaming to CloudWatch | — | Yes / No |

---

## F. Secrets Manager (ap-south-1)

Secrets must exist **before** ECS tasks start. Full ARNs (with suffix) go in `infra/context/task-definition.json`.

### F1 — Secret `aloft/aurora` (JSON keys)

| Key | Purpose |
|-----|---------|
| `DATABASE_URL` | Prisma connection string for harvester tasks |
| `DIRECT_URL` | Same as DATABASE_URL for migrations/direct |

### F2 — Secret `aloft/databricks` (JSON keys)

| Key | Purpose |
|-----|---------|
| `DATABRICKS_CLIENT_ID` | M2M service principal |
| `DATABRICKS_CLIENT_SECRET` | *(secure)* |
| `DATABRICKS_HOST` | e.g. `adb-….azuredatabricks.net` |
| `DATABRICKS_HTTP_PATH` | e.g. `/sql/1.0/warehouses/…` |

### F3 — Per-connection secrets (created by app later)

| Pattern | JSON keys |
|---------|-----------|
| `aloft/databricks/{connectionId}` | `client_id`, `client_secret` |

| # | Item | Value (Cloud fills in) |
|---|------|-------------------------|
| F4 | `aloft/aurora` secret ARN | |
| F5 | `aloft/databricks` secret ARN | |

---

## G. S3 (backfill)

| # | Item | Maps to env / config | Value (Cloud fills in) |
|---|------|----------------------|-------------------------|
| G1 | Bucket name | `BACKFILL_S3_BUCKET` | |
| G2 | Bucket region | `BACKFILL_S3_REGION` | `ap-south-1` |
| G3 | Browse bucket (if different) | `BACKFILL_S3_BROWSE_BUCKET` | |
| G4 | Browse region | `BACKFILL_S3_BROWSE_REGION` | |

---

## H. Amazon Bedrock (us-east-1)

| # | Item | Maps to env / config | Value (Cloud fills in) |
|---|------|----------------------|-------------------------|
| H1 | Model access enabled (Anthropic Claude, Amazon Nova, etc.) | Console + IAM | Yes / No |
| H2 | Optional default Sonnet model ID | `BEDROCK_SONNET_MODEL_ID` | e.g. `us.anthropic.claude-sonnet-4-6` |
| H3 | Optional Bedrock Mantle API key | `BEDROCK_MANTLE_API_KEY` | |
| H4 | Mantle region | `BEDROCK_MANTLE_REGION` | `us-east-2` |

---

## I. EventBridge schedules

Confirm rules exist and target cluster `aloft-agents-prod` with correct subnet/SG (same as section C).

| Rule name | Schedule (UTC) |
|-----------|----------------|
| `aloft-context-harvester-daily` | `cron(0 4 * * ? *)` |
| `aloft-context-harvester-weekly` | `cron(0 3 ? * SUN *)` |
| `aloft-estate-inventory-weekly` | `cron(0 6 ? * MON *)` |
| `aloft-t4-semantic-bootstrap-weekly` | `cron(0 8 ? * SUN *)` |
| `aloft-t3-usage-weekly` | `cron(0 5 ? * 7 *)` |

| # | Item | Value (Cloud fills in) |
|---|------|-------------------------|
| I1 | All rules ENABLED | Yes / No |
| I2 | EventBridge can RunTask on cluster | Yes / No |

---

## J. App platform (not AWS — required for harvester tasks)

Set in **Elastic Beanstalk environment properties** / `.env.local` and in harvester task `environment` if org differs:

| # | Item | Env var | Value (App fills in) |
|---|------|---------|----------------------|
| J1 | Default org slug | `DEFAULT_ORG_SLUG` | |
| J2 | Default org ID | `DEFAULT_ORG_ID` | |

---

## K. Verification

After handoff, app team runs:

```bash
npm run check:integrations
```

Expected: RDS OK; AWS probes OK once keys and resources are valid.

---

**Repo references:** `docs/aws-new-account-migration-guide.md`, `docs/aws-recreate-and-configuration.md`, `infra/context/task-definition.json`, `infra/context/eventbridge-rule.json`
