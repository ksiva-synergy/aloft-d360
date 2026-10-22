# ALOFT D360 — AWS build steps explained (with create/configure guide)

What **you** provision when **Cloud migrates the database**. Each step includes:

1. **What it is**
2. **Why the application needs it**
3. **AWS Management Console (portal)** — click-by-click in the AWS web UI
4. **AWS CLI** — same step from PowerShell (optional; good for repeatability)
5. **Verify**
6. **Repo / env references**

You can do the **entire build in the portal**, **entirely via CLI**, or **mix** (portal for IAM/EB, CLI for Docker push). Docker build/push always needs your laptop either way.

| | |
|---|---|
| **Order checklist** | [aws-new-account-migration-guide.md](./aws-new-account-migration-guide.md) §1.4 |
| **Done / pending log** | [aws-migration-progress.md](./aws-migration-progress.md) |
| **Record values** | [aws-cloud-handoff-checklist.md](./aws-cloud-handoff-checklist.md) |
| **Env template** | [infra/aws/env.template](../infra/aws/env.template) |
| **Regions** | App **`ap-south-1`** · Bedrock **`us-east-1`** |

**Before every session:**

```powershell
aws sts get-caller-identity
# Console region: ap-south-1
$REGION = "ap-south-1"
$ACCOUNT_ID = aws sts get-caller-identity --query Account --output text
```

### Portal vs CLI — how to use this doc

| Prefer | Do this |
|--------|---------|
| **AWS web UI** | Follow **AWS Management Console (portal)** under each step. Top search bar: type service name (e.g. “IAM”, “ECS”). |
| **Scripts / automation** | Use **AWS CLI** blocks; requires [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) and `aws configure` (or SSO). |
| **Both** | Create in portal, **verify** with CLI (or the reverse). Record IDs in [aws-cloud-handoff-checklist.md](./aws-cloud-handoff-checklist.md). |

**Region rule:** Stay in **`ap-south-1` (Mumbai)** for IAM (global but resources regional), RDS, ECS, EB, S3, Secrets, ACM, EventBridge — except **Bedrock model access** in **`us-east-1` (N. Virginia)**.

### Portal navigation map (where to click)

| Step topic | AWS Console path (region `ap-south-1` unless noted) |
|------------|-----------------------------------------------------|
| Confirm Aurora | **RDS** → **Databases** → cluster → **Connectivity & security** |
| IAM roles | **IAM** → **Roles** → **Create role** |
| Security groups | **EC2** → **Security groups** → **Create security group** |
| Secrets | **Secrets Manager** → **Secrets** → **Store a new secret** |
| S3 | **S3** → **Buckets** → **Create bucket** |
| Logs | **CloudWatch** → **Log groups** → **Create log group** |
| Bedrock | **Amazon Bedrock** → **Model access** (region **`us-east-1`**) |
| ECR | **Elastic Container Registry** → **Repositories** → **Create repository** |
| ECS cluster / tasks | **Elastic Container Service** → **Clusters** / **Task definitions** |
| Run task test | **ECS** → cluster `aloft-agents-prod` → **Tasks** → **Run new task** |
| EventBridge | **Amazon EventBridge** → **Buses** → **Rules** (default bus) |
| Beanstalk | **Elastic Beanstalk** → **Environments** → **Create environment** |
| TLS cert | **Certificate Manager** → **Request certificate** |
| EB env vars | **Elastic Beanstalk** → env → **Configuration** → **Updates, monitoring, and logging** → **Environment properties** |

**Sign in:** [https://console.aws.amazon.com/](https://console.aws.amazon.com/) → select the **dedicated ALOFT account** (check account ID top-right).

---

## Plain English — read this first (whole picture)

This section is the story behind the numbered steps. No AWS jargon required to start; you can come back here whenever a step feels random.

### What ALOFT D360 is on AWS

Think of **one product** with **two workers**:

1. **The website (web worker)** — What users open in the browser: chat (Inspector), dashboards, Agent Lab, admin. It is a **Next.js** app in a Docker container. On AWS it runs on **Elastic Beanstalk** (servers behind a load balancer with HTTPS).

2. **The background worker (harvester)** — Jobs that take **too long** for a normal web request: scanning the data estate, profiling tables, scheduled syncs. That code runs in a **separate container** on **ECS Fargate** (serverless containers). The website **starts** those jobs; it does not run the heavy work itself.

Both workers talk to the **same database** (Aurora PostgreSQL), to **Databricks** (warehouse SQL), and to **AI models** (mostly Amazon Bedrock).

### Old account vs new dedicated account

- **Before:** App and database lived in an older AWS account; some services were deleted.
- **Now:** Your company has a **dedicated AWS account** for ALOFT. You are rebuilding hosting there.
- **Database:** **Cloud team** copies/migrates Aurora into that account (you do not build the DB from scratch).
- **You:** Build everything that **runs the app** — permissions, secrets, containers, web servers, schedules — using the checklist in this doc.

Everything in the new account should live in the **same private network (VPC)** as the database so the app can reach Postgres on an internal port (**5432**), not over the public internet.

### What a VPC is (one paragraph)

A **VPC** is your private slice of AWS network. The database sits inside it. Your Beanstalk servers and Fargate tasks must sit in **that same VPC** (with firewall rules called **security groups**). You are usually **not** creating the VPC if Cloud already attached the migrated DB to one — you use **their VPC ID and subnets** and add **your** app pieces inside it.

### What IAM roles are (why the wizard confused you)

Humans log in with **users**. **Services** use **roles** — like a badge that only a robot can wear.

When you create **IAM → Role → ECS Task** you are saying:

> “When ECS starts the harvester container, it may temporarily use this badge to pull the Docker image, fetch passwords from Secrets Manager, and write logs.”

That badge is the **task execution role**. It is **not** your personal admin login.

You attach:

- **AmazonECSTaskExecutionRolePolicy** — standard “set up the container” permissions (image, logs).
- **Extra Secrets policy** — because our task definition says “inject `DATABASE_URL` from secret `aloft/aurora`”. ECS must be **explicitly allowed** to read those secrets.

A **second role** (**task role**) is what the **running program inside the container** uses if it calls AWS (S3, Bedrock, etc.) while the script runs. **Execution role** = startup wiring; **task role** = the app while it runs.

The **Beanstalk instance profile** is the same idea for the **web servers**: so the website can call Bedrock, start harvest jobs on ECS, read S3, without putting long-lived keys in code.

### What Secrets Manager is for

Passwords and connection strings must **not** live in Git or inside the Docker image. They live in **Secrets Manager** (`aloft/aurora`, `aloft/databricks`). When Fargate starts, ECS **copies** those values into the container as environment variables. The web app gets the same values via Beanstalk **environment properties**.

### The harvester pipeline in one sentence

**EventBridge** (cron) or a user action on the website calls **“run this task on ECS”** → Fargate starts **aloft-context-harvester** → **orchestrator.ts** reads Databricks + Aurora, calls Bedrock when needed, writes progress to Aurora and logs to **CloudWatch**.

### What you build, in human order

| Order | You are basically… |
|-------|-------------------|
| 1 | Creating **badges** (IAM) so web and harvester may use AWS safely |
| 2 | Creating a **firewall** for harvester tasks (security group) |
| 3 | Storing **passwords** (Secrets) once Cloud gives DB URL |
| 4–6 | Storage (S3), **log folder** (CloudWatch), turning on **AI** (Bedrock in Virginia) |
| 7–10 | **Docker registry** (ECR), **cluster**, **recipe** (task definition), **upload harvester image** |
| 11–12 | Allow DB to accept harvester; **test one job** manually |
| 13 | Turn on **timers** (EventBridge) only after the test works |
| 14–19 | Same for the **website image**, Beanstalk, HTTPS, env vars, deploy |
| 20–22 | Login (Entra), database schema updates (Prisma), smoke tests |
| 23 | Switch users from old environment to new |

### Common “why am I doing this?” answers

| Question | Short answer |
|----------|----------------|
| Why two containers (Beanstalk + Fargate)? | Web must stay fast; long jobs would time out on HTTP. |
| Why IAM roles instead of access keys on the server? | Keys in env rot poorly; roles are attached to the machine/task and scoped. |
| Why ECS **Task** as trusted entity? | Only **Fargate starting a task** should use the execution role—not random services. |
| Why Cloud migrates DB but I build ECS/EB? | Split of expertise; you still need app hosting aligned to **their** DB endpoint and VPC. |
| Why `Version: 2012-10-17` in JSON? | Fixed IAM policy format version—not today’s date. |
| Why Mumbai + Virginia? | Servers and DB in **ap-south-1**; many Bedrock models are enabled in **us-east-1**. |

### How to use the rest of this document

Each **Step N** below is one box in the table above, with **portal clicks** and **CLI** if you prefer scripts. If a step mentions an ARN or subnet ID, write it in [aws-cloud-handoff-checklist.md](./aws-cloud-handoff-checklist.md) so Beanstalk env and `task-definition.json` stay consistent.

---

## Application context (short)

| Runtime | AWS | App role |
|---------|-----|----------|
| **Web** | Elastic Beanstalk → Next.js :3000 | UI, `src/app/api/*`, Inspector SSE, `ecs:RunTask` for harvests |
| **Harvester** | ECS Fargate `aloft-context-harvester` | `scripts/context/orchestrator.ts` — data estate T0–T4 |

Cloud team: **Aurora migration**, VPC for DB, writer endpoint. You: **steps 1–23 below**.

---

## Cloud handoff (you do not create DB)

### What / why

Aurora holds all Prisma data; Beanstalk and Fargate must sit in the **same VPC** and reach Aurora on **5432**.

### AWS Management Console (portal)

1. Open **RDS** → **Databases**.
2. Click the Aurora cluster → wait until **Status** = **Available**.
3. Tab **Connectivity & security** (or **Networking**): copy **Endpoint** (writer), **VPC**, **VPC security groups**, **Subnet group**.
4. **EC2** → **Subnets** → filter by that VPC → note subnet IDs per AZ for later (or get from Cloud).

### AWS CLI

```powershell
aws rds describe-db-clusters --region $REGION `
  --query "DBClusters[*].[DBClusterIdentifier,Endpoint,DBSubnetGroup,VpcSecurityGroups]" --output table
```

Ask Cloud for **Fargate/Beanstalk subnet IDs** and `ECS_ASSIGN_PUBLIC_IP` if not obvious from subnet tags.

### Verify

- [ ] Writer endpoint responds (Cloud or you via bastion/VPN).
- [ ] Checklist section **B** filled.

---

## Step 1 — IAM roles and Beanstalk instance profile

### What it is

IAM **roles** with policies: ECS execution, ECS task, EventBridge → ECS, Beanstalk EC2 instance profile.

### Why the application needs it

Harvester tasks need secrets and ECR; EventBridge runs scheduled estate jobs; the web app calls Bedrock, `ecs:RunTask`, S3, and Secrets.

### How to create / configure

#### A. ECS task execution role

**AWS Management Console (portal)**

1. **IAM** → **Roles** → **Create role**.
2. Trusted entity: **AWS service** → **Elastic Container Service** → **Elastic Container Service Task**.
3. Attach policy: **AmazonECSTaskExecutionRolePolicy**.
4. Add inline policy (example name `AloftSecretsRead`) for Secrets Manager:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["secretsmanager:GetSecretValue"],
    "Resource": "arn:aws:secretsmanager:ap-south-1:ACCOUNT_ID:secret:aloft/*"
  }]
}
```

5. Role name example: `aloftEcsTaskExecutionRole` → copy **ARN**.

**AWS CLI**

```powershell
# Create role + trust policy via console is easier; then attach:
aws iam attach-role-policy --role-name aloftEcsTaskExecutionRole `
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

Use this ARN as `executionRoleArn` in `task-definition.json` and optionally `ECS_EXECUTION_ROLE_ARN` in env.

#### B. ECS task role

**What it is:** Credentials for **application code** in the harvester container (Bedrock, optional `ecs:RunTask` when the orchestrator chains jobs). **Not** for ECR/logs/secrets — those stay on the execution role.

**AWS Management Console (portal)**

1. **IAM** → **Roles** → **Create role** → trusted entity **ECS Task** → create role **`aloftEcsTaskRole`** (no managed policies on this screen).
2. **Add permissions** → **Create inline policy** → **JSON** → policy name **`AloftHarvesterBedrock`**:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "HarvesterBedrock",
    "Effect": "Allow",
    "Action": [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream"
    ],
    "Resource": "*"
  }]
}
```

The app calls the Bedrock **Converse** API in code (`ConverseCommand`), but IAM uses **`InvokeModel`** / **`InvokeModelWithResponseStream`** — do **not** use `bedrock:Converse` or `bedrock:ConverseStream` (the IAM editor reports them as invalid). See [Converse API permissions](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html).

3. Second inline policy **`AloftHarvesterRunTask`** (replace `ACCOUNT_ID`; role names must match yours):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RunHarvesterTasks",
      "Effect": "Allow",
      "Action": ["ecs:RunTask", "ecs:DescribeTasks"],
      "Resource": [
        "arn:aws:ecs:ap-south-1:ACCOUNT_ID:cluster/aloft-agents-prod",
        "arn:aws:ecs:ap-south-1:ACCOUNT_ID:task-definition/aloft-context-harvester:*"
      ]
    },
    {
      "Sid": "PassRolesToEcs",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::ACCOUNT_ID:role/aloftEcsTaskExecutionRole",
        "arn:aws:iam::ACCOUNT_ID:role/aloftEcsTaskRole"
      ]
    }
  ]
}
```

4. Copy role **ARN** → checklist **C8** → `taskRoleArn` in [task-definition.json](../infra/context/task-definition.json). **S3 backfill** is not required on this role for the current harvester code (optional on Beanstalk instance profile only).

**Progress:** Mark complete in [aws-migration-progress.md](./aws-migration-progress.md).

#### C. EventBridge role

**AWS Management Console (portal)**

1. **IAM** → **Roles** → **Create role** → **Custom trust policy**:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "events.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

2. Attach policy allowing `ecs:RunTask` and `iam:PassRole` on your cluster/task roles (scope to `aloft-agents-prod` and task definition ARN in production).
3. Name example: `aloftEventBridgeEcsRole` → use as `RoleArn` in `eventbridge-rule.json`.

#### D. Beanstalk EC2 instance profile

**AWS Management Console (portal)**

1. **IAM** → **Roles** → **Create role** → **AWS service** → **EC2**.
2. Attach policies (tune to org standards), for example:
   - Bedrock in `us-east-1` (`bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream` — covers Converse / ConverseStream in the SDK)
   - `ecs:RunTask`, `ecs:DescribeTasks` on cluster `aloft-agents-prod`
   - `secretsmanager:GetSecretValue` on `aloft/*`
   - S3 on backfill bucket
   - `logs:FilterLogEvents` on harvester log group (optional, for admin UI)
3. Role name e.g. `aloftEbEc2Role` → **Create instance profile** with same name (or attach role to profile).
4. In **Elastic Beanstalk** → environment → **Configuration** → **Security** → **EC2 instance profile** → select this profile.

### Verify

- [ ] Four ARNs/profiles saved in checklist **A** / your runbook.
- [ ] `task-definition.json` updated with execution + task role ARNs.

### In the repo

`infra/context/task-definition.json`, `infra/context/eventbridge-rule.json`, Beanstalk security configuration.

---

## Step 2 — Fargate security group

### What it is

Security group for ECS Fargate harvester ENIs in **Cloud’s VPC**.

### Why the application needs it

Egress to Aurora (5432) and HTTPS APIs (443). Aurora will allow inbound 5432 **from this SG** only.

### How to create / configure

**AWS Management Console (portal)**

1. **EC2** → **Security groups** → **Create security group**.
2. **VPC**: same as Aurora (from Cloud handoff).
3. **Inbound**: none (default).
4. **Outbound** → **Edit**:
   - Type **HTTPS**, Port **443**, Destination `0.0.0.0/0` (or org egress endpoint).
   - Type **PostgreSQL**, Port **5432**, Destination Aurora SG or DB subnet CIDR (or `0.0.0.0/0` egress if Aurora reached by SG reference on Aurora side only).
5. Name: `aloft-fargate-harvester-sg` → copy **Group ID**.

**AWS CLI**

```powershell
$VPC_ID = "vpc-xxxxxxxx"   # from Cloud
aws ec2 create-security-group --group-name aloft-fargate-harvester-sg `
  --description "ALOFT context harvester Fargate" --vpc-id $VPC_ID --region $REGION
aws ec2 authorize-security-group-egress --group-id sg-NEW --protocol tcp --port 443 --cidr 0.0.0.0/0 --region $REGION
aws ec2 authorize-security-group-egress --group-id sg-NEW --protocol tcp --port 5432 --cidr 0.0.0.0/0 --region $REGION
```

### Verify

- [ ] SG ID in `ECS_SECURITY_GROUP_IDS` and `eventbridge-rule.json`.

### In the repo

[env.template](../infra/aws/env.template) — `ECS_SECURITY_GROUP_IDS`

---

## Step 3 — Secrets Manager

### What it is

Secrets `aloft/aurora` and `aloft/databricks` (JSON keys used by ECS and app).

### Why the application needs it

Harvester container receives `DATABASE_URL` and Databricks M2M credentials without embedding them in the image.

### How to create / configure

**Option A — Script (recommended)**

1. Edit placeholders in [scripts/infra/create-secrets.ps1](../scripts/infra/create-secrets.ps1) locally (do not commit real values).
2. Run:

```powershell
cd c:\ALOFT\aloft-d360
powershell -File scripts/infra/create-secrets.ps1
```

**AWS Management Console (portal)**

1. **Secrets Manager** → **Store a new secret**.
2. **Other type of secret** → key/value or **Plaintext** tab → paste JSON below.
3. **Next** → secret name **`aloft/aurora`** → region must be **ap-south-1** → **Store**.
4. Repeat for **`aloft/databricks`**.

`aloft/aurora` JSON:

```json
{
  "DATABASE_URL": "postgresql://USER:PASS@WRITER.ap-south-1.rds.amazonaws.com:5432/aloftdb?schema=public&sslmode=require",
  "DIRECT_URL": "postgresql://USER:PASS@WRITER.ap-south-1.rds.amazonaws.com:5432/aloftdb?schema=public&sslmode=require"
}
```

`aloft/databricks` keys: `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`, `DATABRICKS_HOST`, `DATABRICKS_HTTP_PATH`.

**AWS CLI** — script: [create-secrets.ps1](../scripts/infra/create-secrets.ps1) (Option A above).

**Update task definition ARNs (portal or CLI)**

```powershell
aws secretsmanager describe-secret --secret-id aloft/aurora --region $REGION --query ARN --output text
```

Copy full ARNs into `infra/context/task-definition.json` `secrets[].valueFrom` (format `arn:...:secret:aloft/aurora:DATABASE_URL::` — match existing file pattern).

### Verify

- [ ] `aws secretsmanager get-secret-value --secret-id aloft/aurora --region $REGION` (sanity check).
- [ ] Checklist **F4–F5** ARNs recorded.

### In the repo

`infra/context/task-definition.json`, [create-secrets.ps1](../scripts/infra/create-secrets.ps1)

---

## Step 4 — S3 backfill bucket

### What it is

S3 bucket for `BACKFILL_S3_*` features.

### Why the application needs it

Backfill/browse flows in the app read/write configured datasets via S3.

### How to create / configure

**AWS Management Console (portal)**

1. **S3** → **Create bucket** → name e.g. `pbc-vessel-data` (globally unique).
2. Region: **ap-south-1**.
3. Block public access: **on** (default).
4. **IAM** → attach S3 policy on EB role + ECS task role for this bucket (`ListBucket`, `GetObject`, `PutObject`).

**AWS CLI**

```powershell
$BUCKET = "your-org-aloft-backfill-ap-south-1"
aws s3api create-bucket --bucket $BUCKET --region $REGION `
  --create-bucket-configuration LocationConstraint=$REGION
```

Set `BACKFILL_S3_BUCKET` and `BACKFILL_S3_REGION=ap-south-1` on Beanstalk.

### Verify

- [ ] `aws s3 ls s3://$BUCKET` works with your credentials/profile.

---

## Step 5 — CloudWatch log group

### What it is

Log group `/ecs/aloft-context-harvester`.

### Why the application needs it

ECS `awslogs` driver ships harvester stdout/stderr here for debugging.

### How to create / configure

**AWS Management Console (portal)**

1. **CloudWatch** → **Log groups** → **Create log group**.
2. Name: **`/ecs/aloft-context-harvester`** (exact match).
3. Retention: e.g. **30 days** → **Create**.

**AWS CLI** ([deploy-notes.md](../infra/context/deploy-notes.md)):

```powershell
aws logs create-log-group --log-group-name /ecs/aloft-context-harvester --region $REGION
aws logs put-retention-policy --log-group-name /ecs/aloft-context-harvester `
  --retention-in-days 30 --region $REGION
```

### Verify

- [ ] Name matches `logConfiguration` in `task-definition.json`.

---

## Step 6 — Amazon Bedrock (`us-east-1`)

### What it is

Model access + IAM for Claude, Nova, Titan, etc.

### Why the application needs it

Inspector, semantic layer, Agent Lab, harvester LLM steps, embeddings.

### How to create / configure

**AWS Management Console (portal)**

1. Switch region (top bar) to **US East (N. Virginia) `us-east-1`**.
2. **Amazon Bedrock** → **Model access** (or **Chat / Text** playground) → **Enable** models your app uses (e.g. Anthropic Claude, Amazon Nova, Titan Embeddings).
3. Ensure **Step 1** EB and ECS task roles include Bedrock actions in **`us-east-1`**.

**Beanstalk / env**

```text
BEDROCK_REGION=us-east-1
```

Optional: `BEDROCK_SONNET_MODEL_ID` per [env.template](../infra/aws/env.template).

**AWS CLI**

```powershell
aws bedrock list-foundation-models --region us-east-1 --query "modelSummaries[?modelLifecycle.status=='ACTIVE'].modelId" --output table
```

### Verify

- [ ] Bedrock **Chat/Text playground** works in `us-east-1`, or CLI lists models.

---

## Step 7 — ECR `aloft-context-harvester`

### What it is

Docker registry for harvester image.

### How to create / configure

**AWS Management Console (portal)**

1. **Amazon ECR** → **Repositories** → **Create repository**.
2. Name: **`aloft-context-harvester`** → **Scan on push** = on → **Create**.
3. Open repository → copy **URI** (e.g. `123456789.dkr.ecr.ap-south-1.amazonaws.com/aloft-context-harvester`).
4. Paste URI into `image` in `infra/context/task-definition.json` with tag `:latest`.

**AWS CLI**

```powershell
aws ecr create-repository --repository-name aloft-context-harvester --region $REGION `
  --image-scanning-configuration scanOnPush=true
$ECR_HARVESTER = "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/aloft-context-harvester"
```

### Verify

- [ ] `aws ecr describe-repositories --repository-names aloft-context-harvester --region $REGION`

---

## Step 8 — ECS cluster `aloft-agents-prod`

### What it is

Logical cluster for Fargate tasks.

### How to create / configure

**AWS Management Console (portal)**

1. **Amazon ECS** → **Clusters** → **Create cluster**.
2. Name: **`aloft-agents-prod`**.
3. **Infrastructure** → **AWS Fargate (serverless)** → **Create**.

**AWS CLI**

```powershell
aws ecs create-cluster --cluster-name aloft-agents-prod --region $REGION `
  --capacity-providers FARGATE FARGATE_SPOT `
  --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1
```

Set `ECS_CLUSTER_NAME=aloft-agents-prod` on Beanstalk.

### Verify

- [ ] `aws ecs describe-clusters --clusters aloft-agents-prod --region $REGION` → `ACTIVE`

---

## Step 9 — Register task definition

### What it is

Fargate task spec: CPU 512, memory 1024, command → `orchestrator.ts`, secrets, logs.

### Why the application needs it

`RunTask` and EventBridge require a registered **family:revision**.

### How to create / configure

1. Edit [infra/context/task-definition.json](../infra/context/task-definition.json) (account ID, roles, image, secrets, org env).

**AWS Management Console (portal)**

1. **ECS** → **Task definitions** → **Create new task definition** → **Create with JSON**.
2. Paste the edited JSON from the repo → **Create**.
3. Note **Revision** and full **ARN** (EventBridge needs `aloft-context-harvester:N`).

**AWS CLI**

```powershell
cd c:\ALOFT\aloft-d360
aws ecs register-task-definition --cli-input-json file://infra/context/task-definition.json --region $REGION
```

Save **taskDefinitionArn** for EventBridge.

Set `ECS_CONTEXT_TASK_DEFINITION=aloft-context-harvester` and `ECS_CONTEXT_CONTAINER_NAME=context-harvester` on Beanstalk.

### Verify

- [ ] `aws ecs describe-task-definition --task-definition aloft-context-harvester --region $REGION`

---

## Step 10 — Build and push harvester image

### How to create / configure

**AWS Management Console (portal)** — view only after push:

1. **ECR** → **aloft-context-harvester** → **Images** → confirm **`latest`** digest and push time.
2. (Optional) **View push commands** on the repository page shows the same Docker login/build/tag/push text AWS expects.

**AWS CLI + Docker** (required to upload the image):

```powershell
cd c:\ALOFT\aloft-d360
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
docker build -t aloft-context-harvester -f Dockerfile.harvester .
docker tag aloft-context-harvester:latest "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/aloft-context-harvester:latest"
docker push "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/aloft-context-harvester:latest"
```

### Verify

- [ ] **ECR** portal → **Images** shows `latest`.

---

## Step 11 — Aurora SG: allow Fargate on 5432

### How to create / configure

**AWS Management Console (portal)**

1. **EC2** → **Security groups** → select **Aurora SG** (from Cloud).
2. **Inbound rules** → **Edit** → **Add rule**:
   - Type **PostgreSQL**, Port **5432**
   - Source: **Custom** → select **Fargate SG** from Step 2 → **Save rules**.

**AWS CLI**

```powershell
$AURORA_SG = "sg-xxxxxxxx"
$FARGATE_SG = "sg-yyyyyyyy"
aws ec2 authorize-security-group-ingress --group-id $AURORA_SG --protocol tcp --port 5432 `
  --source-group $FARGATE_SG --region $REGION
```

### Verify

- [ ] Rule visible on Aurora SG.

---

## Step 12 — Manual RunTask test

### How to create / configure

**AWS Management Console (portal)**

1. **ECS** → **Clusters** → **aloft-agents-prod**.
2. **Tasks** tab → **Run new task**.
3. **Launch type:** Fargate.
4. **Task definition:** `aloft-context-harvester` (latest revision).
5. **Cluster:** `aloft-agents-prod`.
6. **VPC:** Cloud’s VPC → **Subnets:** at least 2 → **Security group:** Fargate SG → **Public IP:** On or Off per `ECS_ASSIGN_PUBLIC_IP`.
7. **Create** → open task → **Logs** tab (or CloudWatch log group) when **Stopped**.

**AWS CLI**

```powershell
$SUBNETS = "subnet-aaa,subnet-bbb"
$FARGATE_SG = "sg-yyyyyyyy"
$PUBLIC_IP = "ENABLED"   # or DISABLED if private + NAT

aws ecs run-task --cluster aloft-agents-prod --launch-type FARGATE --region $REGION `
  --task-definition aloft-context-harvester `
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$FARGATE_SG],assignPublicIp=$PUBLIC_IP}"
```

### Verify

- [ ] Task → **Stopped** with exit code **0** (or expected success in logs).
- [ ] CloudWatch log group shows orchestrator output.
- [ ] If DB timeout → recheck Step 11 and secrets.

**Do not enable EventBridge until this passes.**

---

## Step 13 — EventBridge rules

### How to create / configure

Edit [infra/context/eventbridge-rule.json](../infra/context/eventbridge-rule.json) first (cluster, task def ARN, role, subnets, SG).

**AWS Management Console (portal)** — one rule example; repeat per checklist §I:

1. **Amazon EventBridge** → **Rules** → **Create rule**.
2. **Name:** e.g. `aloft-context-harvester-daily` → **Schedule** → **Cron expression** `0 4 * * ? *` (UTC).
3. **Target:** **AWS service** → **ECS task** → Cluster `aloft-agents-prod`, Task definition `aloft-context-harvester:REV`, Launch type **Fargate**, subnets, SG, public IP.
4. **Execution role:** EventBridge role from Step 1C → **Create**.

**AWS CLI** (all rules from JSON):

```powershell
cd c:\ALOFT\aloft-d360
powershell -File scripts/infra/apply-eventbridge.ps1
```

Schedules: [aws-cloud-handoff-checklist.md](./aws-cloud-handoff-checklist.md) §I.

### Verify

- [ ] **EventBridge** → **Rules** → each **Enabled** → **Targets** show correct ECS task ARN.

---

## Step 14 — ECR `aloft-d360-web`

**AWS Management Console (portal):** **ECR** → **Create repository** → name **`aloft-d360-web`** → **Create**.

**AWS CLI**

```powershell
aws ecr create-repository --repository-name aloft-d360-web --region $REGION 2>$null
```

See [deploy-beanstalk.md](./deploy-beanstalk.md) §1 for build/push (Step 19).

---

## Step 15 — Elastic Beanstalk `aloft-d360-dev`

### How to create / configure

1. Edit [infra/beanstalk/Dockerrun.aws.json](../infra/beanstalk/Dockerrun.aws.json) — replace `REPLACE_ACCOUNT_ID`.
2. Zip contents of `infra/beanstalk/` (Dockerrun, `.ebextensions`, `.platform`).

**AWS Management Console (portal)**

1. **Elastic Beanstalk** → **Create application** (if needed) → **Create environment** → **Web server environment**.
2. **Environment name:** `aloft-d360-dev`.
3. **Platform:** **Docker** → **Docker running on 64bit Amazon Linux 2023**.
4. **Application code:** Upload zip of `infra/beanstalk/` (after fixing `Dockerrun.aws.json`).
5. **Presets:** High availability (load balanced) for HTTPS.
6. **Configure service access** → **EC2 instance profile:** role from Step 1D.
7. **Networking** → **VPC** = Aurora’s VPC → pick **instance subnets** and **load balancer subnets**.
8. **Instance types:** `t3.medium`, count **1** (dev).

**AWS CLI — EB CLI** ([deploy-beanstalk.md](./deploy-beanstalk.md)):

```powershell
cd c:\ALOFT\aloft-d360\infra\beanstalk
eb init -p docker aloft-d360-web --region ap-south-1
eb create aloft-d360-dev --elb-type application --instance-types t3.medium --scale 1
```

### Verify

- [ ] Environment health **Ok** (may need image deploy Step 19).

---

## Step 16 — ACM, HTTPS, DNS

### How to create / configure

**AWS Management Console (portal)**

1. **Certificate Manager** (region **ap-south-1**) → **Request certificate** → public cert → DNS names → **Request** → add CNAMEs in DNS per ACM wizard → wait **Issued**.
2. **Elastic Beanstalk** → `aloft-d360-dev` → **Configuration** → **Load balancer** → **Edit** → **Listeners** → add **HTTPS:443** → select ACM certificate → **Apply**.
3. **Route 53** (or corporate DNS): CNAME `d360-dev.example.com` → EB environment URL.
4. Set `NEXTAUTH_URL=https://d360-dev.example.com` (Step 18).

**AWS CLI** — ACM/EB listener is usually easier in portal; DNS may be outside AWS.

### Verify

- [ ] Browser opens `https://` without certificate errors.

---

## Step 17 — Aurora SG: allow Beanstalk on 5432

**AWS Management Console (portal)**

1. **Elastic Beanstalk** → `aloft-d360-dev` → **Environment overview** → **Instances** → click instance ID.
2. **EC2 instance** page → **Security** tab → copy **Security group ID** (instance SG).
3. **EC2** → **Security groups** → **Aurora SG** → **Inbound rules** → **Edit** → add **PostgreSQL 5432** → source = **EB instance SG** → **Save**.

**AWS CLI**

```powershell
aws ec2 authorize-security-group-ingress --group-id $AURORA_SG --protocol tcp --port 5432 `
  --source-group $EB_INSTANCE_SG --region $REGION
```

### Verify

- [ ] After web deploy, Prisma routes work (login, dashboard load).

---

## Step 18 — Beanstalk environment properties

**AWS Management Console (portal):** **Elastic Beanstalk** → env → **Configuration** → **Updates, monitoring, and logging** → **Edit** → **Environment properties** → add keys → **Apply**.

Copy from [infra/aws/env.template](../infra/aws/env.template). Minimum:

| Property | Example / note |
|----------|----------------|
| `NODE_ENV` | `production` |
| `HARVEST_RUNTIME` | `ecs` |
| `DATABASE_URL`, `DIRECT_URL` | From Cloud / secrets |
| `AWS_REGION` | `ap-south-1` |
| `BEDROCK_REGION` | `us-east-1` |
| `ECS_CLUSTER_NAME` | `aloft-agents-prod` |
| `ECS_CONTEXT_TASK_DEFINITION` | `aloft-context-harvester` |
| `ECS_CONTEXT_CONTAINER_NAME` | `context-harvester` |
| `ECS_SUBNET_IDS` | comma-separated |
| `ECS_SECURITY_GROUP_IDS` | Fargate SG |
| `ECS_ASSIGN_PUBLIC_IP` | `ENABLED` or `DISABLED` |
| `ECS_EXECUTION_ROLE_ARN`, `ECS_TASK_ROLE_ARN` | if used by app RunTask |
| `NEXTAUTH_SECRET`, `AZURE_AD_*` | Entra |
| `BACKFILL_S3_*` | Step 4 |

**AWS CLI (EB CLI):**

```powershell
eb setenv HARVEST_RUNTIME=ecs AWS_REGION=ap-south-1 BEDROCK_REGION=us-east-1 ...
```

### Verify

- [ ] EB → **Health** green after deploy; no missing env in logs.

---

## Step 19 — Build, push, deploy web

**AWS Management Console (portal)** — after deploy:

1. **ECR** → `aloft-d360-web` → confirm new image.
2. **Elastic Beanstalk** → **Upload and deploy** (new app version zip) **or** rely on `eb deploy` pulling updated `Dockerrun` image tag.
3. **Events** tab shows deployment progress → **Health** should turn green.

**AWS CLI + Docker + EB CLI**

```powershell
cd c:\ALOFT\aloft-d360
$ECR = "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/aloft-d360-web"
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
docker build -t aloft-d360-web -f Dockerfile .
docker tag aloft-d360-web:latest "${ECR}:latest"
docker push "${ECR}:latest"
cd infra\beanstalk
eb deploy aloft-d360-dev
```

### Verify

```powershell
curl https://YOUR_HOST/api/health
# Expect {"ok":true} or equivalent 200
```

---

## Step 20 — Microsoft Entra

### How to configure

1. **Entra** → **App registrations** → your app → **Authentication**.
2. Add redirect URI: `https://YOUR_HOST/api/auth/callback/azure-ad`.
3. Match `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID` on Beanstalk.
4. `NEXTAUTH_URL` must equal public site URL (scheme + host, no mismatch).

### Verify

- [ ] Sign in completes; session cookie set.

---

## Step 21 — Prisma migrations

```powershell
cd c:\ALOFT\aloft-d360
$env:DATABASE_URL = "postgresql://..."   # or use .env.local
npx prisma migrate deploy --schema=./prisma/schema.prisma
```

Requires network path to Aurora (VPN/bastion or SG allows your IP temporarily).

### Verify

- [ ] Command exits 0; no pending failed migrations.

---

## Step 22 — Integration checks

```powershell
cd c:\ALOFT\aloft-d360
npm run check:integrations
```

### Verify

- [ ] Postgres + endpoint probes pass (checklist §K).

---

## Step 23 — Cutover from legacy

### How to configure (process)

1. Announce maintenance window.
2. With Cloud: stop legacy app writes; final DB sync if required.
3. Switch DNS to new Beanstalk URL.
4. Update Entra redirects; remove old URL when safe.
5. Smoke test Inspector, dashboard save, one harvest job.
6. After soak, decommission legacy ECS/EB (Cloud may retain snapshots).

---

## Optional — Agent runner

```powershell
# Edit VPC/subnets at top of script, then:
bash scripts/infra/provision-aloft-agents.sh
```

Only if using `AGENT_BASE_IMAGE` / `aloft-agent-runner` ECS tasks.

---

## Master order (checklist)

| # | Step | Portal service |
|---|------|----------------|
| 0 | Cloud DB + network handoff | RDS |
| 1 | IAM | IAM |
| 2 | Fargate SG | EC2 → Security groups |
| 3 | Secrets | Secrets Manager |
| 4 | S3 | S3 |
| 5 | Log group | CloudWatch |
| 6 | Bedrock us-east-1 | Bedrock (`us-east-1`) |
| 7–10 | ECR harvester, cluster, task def, push image | ECR, ECS (+ Docker local) |
| 11–12 | Aurora rule + RunTask test | EC2 SG, ECS Run task |
| 13 | EventBridge | EventBridge |
| 14–19 | Web ECR, EB, HTTPS, Aurora rule EB, env, deploy | ECR, Beanstalk, ACM |
| 20–22 | Entra, migrate, check:integrations | Entra portal + local CLI |
| 23 | Cutover | DNS + EB |

---

## Related documents

| Document | Purpose |
|----------|---------|
| [aws-new-account-migration-guide.md](./aws-new-account-migration-guide.md) | Migration narrative |
| [deploy-beanstalk.md](./deploy-beanstalk.md) | Web-focused commands |
| [infra/context/deploy-notes.md](../infra/context/deploy-notes.md) | Harvester commands |
| [aws-recreate-and-configuration.md](./aws-recreate-and-configuration.md) | Same-account recreate |

---

*Aligned with `infra/aws/env.template` and `infra/context/task-definition.json`.*
