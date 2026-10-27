# ALOFT D360 — New AWS account: full provisioning & migration

Step-by-step guide to stand up **the entire ALOFT D360 AWS stack in a target account**, including **moving Aurora PostgreSQL from a source account**. Use this when the old account still has (or had) DB + services and you are **not** doing an in-place recreate only.

| | |
|---|---|
| **When to use this doc** | Greenfield / **new target account** + data migration from **source account** |
| **When to use instead** | DB stays in same account, only ECS/Beanstalk deleted → [aws-recreate-and-configuration.md](./aws-recreate-and-configuration.md) |
| **Architecture overview** | [cloud-team-architecture-handoff.md](./cloud-team-architecture-handoff.md) |
| **Handoff form (fill when done)** | [aws-cloud-handoff-checklist.md](./aws-cloud-handoff-checklist.md) |
| **Web deploy only** | [deploy-beanstalk.md](./deploy-beanstalk.md) |
| **What / why / how-to per step (Cloud does DB)** | [aws-build-steps-explained.md](./aws-build-steps-explained.md) |
| **Regions** | App **`ap-south-1`** · Bedrock **`us-east-1`** |

**Historical account ID in repo JSON:** `454073573537` — replace with your **target account ID** everywhere (see [§8](#8-repo-files-to-update-after-account-change)).

### Dedicated project account (typical setup)

Many teams use:

| Account | Role |
|---------|------|
| **Source / legacy** | Old ALOFT stack + Aurora (being retired) |
| **Dedicated ALOFT account** | **Target** — only this product’s VPC, RDS, ECS, Beanstalk, secrets |

All **new** hosting and the **restored database** should live in the **dedicated account**. App developers often have **limited IAM** there (no VPC create); **Cloud admins** own that account’s network and hand off IDs via [aws-cloud-handoff-checklist.md](./aws-cloud-handoff-checklist.md).

Confirm you are logged into the **dedicated account** (`aws sts get-caller-identity`), not the legacy source account, when pushing images or editing EB/ECS.

---

## 0. How this differs from “recreate in same account”

| Same account recreate | New account (this guide) |
|----------------------|---------------------------|
| **Keep** existing Aurora; only open SG to new EB/Fargate | **Restore** Aurora in target VPC from **snapshot** (or DMS / logical dump) |
| Reuse existing VPC (find via RDS) | **New** VPC (or landing-zone VPC) in target account |
| Update ARNs if roles were recreated | **All** IAM, Secrets, ECR, ECS, EB are **new** |
| Optional cross-account work | **Required:** snapshot share (or equivalent) **source → target** |

**Do not** run Beanstalk + Fargate in the target account while leaving the database **only** in the source account on a private endpoint — that needs cross-account networking (peering/TGW/PrivateLink). Standard pattern: **DB + app + harvester in one target account, one VPC.**

---

## 1. Roles and deliverables

| Role | Responsibility |
|------|----------------|
| **Cloud / platform** | VPC, Aurora restore, IAM, KMS, SG rules, ECS, ECR, EventBridge, S3, Secrets, Beanstalk, ACM, DNS |
| **App team** | Update repo JSON ARNs, env vars, Docker builds, Entra, `prisma migrate deploy`, verification scripts |
| **Secure handoff** | Passwords, `DATABASE_URL`, API keys → secure channel only; use [aws-cloud-handoff-checklist.md](./aws-cloud-handoff-checklist.md) |

---

## 1.1 No permission to create a VPC (typical for app teams)

You **do not** need to create a VPC yourself. In most enterprises, **Cloud / network / landing-zone** owns VPC, subnets, NAT, and often security groups. Your job is to **request** the right inputs and continue with app work that does not need VPC APIs.

### What you cannot do without Cloud

| Blocked without VPC/network access | Owner |
|-----------------------------------|--------|
| Create VPC, subnets, route tables, NAT, IGW | Cloud |
| Create or change **Aurora** subnet group / restore DB into VPC | Cloud |
| Create **security groups** (if IAM denies `ec2:CreateSecurityGroup`) | Cloud |
| Create **Beanstalk** in a specific VPC (if console forces network pick you can’t see) | Cloud creates env or grants `elasticbeanstalk:*` + network |
| **RunTask** with subnet/SG IDs you don’t have | Cloud hands off IDs |

### What you **can** do now (parallel track)

| App team (no VPC API) | Notes |
|----------------------|--------|
| Prepare [aws-cloud-handoff-checklist.md](./aws-cloud-handoff-checklist.md) — fill **J** (org), list required env from [infra/aws/env.template](../infra/aws/env.template) | Send to Cloud as requirements |
| Update repo placeholders in §8 **after** Cloud sends account ID + ARNs (or use find-replace locally, don’t commit secrets) | `task-definition.json`, `Dockerrun.aws.json` |
| Build Docker images locally; push to ECR **if** you have `ecr:*` in target account | Often allowed when VPC is not |
| Entra: plan new redirect URI hostname with Cloud (DNS name) | No AWS VPC needed |
| Source account: work with Cloud on **Aurora snapshot share** (you may only need read on source RDS) | Cloud runs restore in target VPC |
| Run `npm run check:postgres` / `check:integrations` **after** handoff when you have `DATABASE_URL` (VPN/bastion or temp SG) | |

### Minimum request to Cloud (copy/paste)

```text
I do not have permission to create VPC/subnets/SGs in target account __________.

Please provision (or designate existing landing-zone) network in ap-south-1 for ALOFT D360:
- VPC ID
- Private DB subnet group (2+ AZs) for Aurora restore from source snapshot
- Subnet IDs for ECS Fargate (2 AZs) + whether ECS_ASSIGN_PUBLIC_IP is ENABLED or DISABLED
- Subnet IDs for Elastic Beanstalk (instances + ALB)
- Security groups: Aurora, Fargate tasks, Beanstalk instances
- Aurora: restore from shared snapshot (source account __________) OR provide writer endpoint if already restored
- Inbound rules: Aurora SG allows TCP 5432 from Fargate SG + EB instance SG only

Return completed aws-cloud-handoff-checklist.md sections A–L (secrets via secure channel).
```

**Your next step:** send the block above → wait for checklist → resume guide at **§6** (Secrets/platform) or **§7** depending on what Cloud completed first.

---

## 1.2 You are creating services in the dedicated account (self-service)

Use this **single ordered list** if **you** are the person standing up the new account (not a separate handoff team). Fill [aws-cloud-handoff-checklist.md](./aws-cloud-handoff-checklist.md) yourself as you go so app config (§8–§10) stays in sync.

**Start every session:**

```powershell
aws sts get-caller-identity
# Region: ap-south-1 (Console top-right)
```

Account ID must be the **dedicated ALOFT account**, not legacy.

### Step 0 — Network (must exist before RDS / EB / Fargate)

| # | Action | If you lack VPC API |
|---|--------|---------------------|
| 0.1 | Get **VPC ID** + subnet IDs (DB, Fargate, Beanstalk) | Ask network team; use §1.1 ticket — **stop** until you have IDs |
| 0.2 | Create **Aurora SG**, **Fargate SG** (egress 443, 5432) | Same — need `ec2:CreateSecurityGroup` or network team creates SGs |
| 0.3 | Record `ECS_ASSIGN_PUBLIC_IP` (ENABLED if public subnets / no NAT) | |

**Gate:** VPC ID + at least 2 Fargate subnet IDs + Fargate SG ID written down.

### Step 1 — IAM

| # | Create |
|---|--------|
| 1.1 | ECS task **execution** role + **task** role |
| 1.2 | EventBridge role → `ecs:RunTask` on `aloft-agents-prod` |
| 1.3 | Beanstalk **EC2 instance profile** (Bedrock `us-east-1`, ECS, Secrets, S3, logs) |

### Step 2 — Database (legacy → dedicated account)

| # | Action |
|---|--------|
| 2.1 | **Legacy account:** snapshot Aurora → share with dedicated account ID |
| 2.2 | **Dedicated account:** copy shared snapshot → **restore** cluster in DB subnet group + Aurora SG |
| 2.3 | Save **writer endpoint**; test connect (bastion/VPN) |

**Gate:** DB reachable in dedicated VPC before Secrets/ECS.

### Step 3 — Platform (no VPC needed beyond SG rules later)

| # | Create |
|---|--------|
| 3.1 | Secrets `aloft/aurora`, `aloft/databricks` |
| 3.2 | S3 backfill bucket |
| 3.3 | Log group `/ecs/aloft-context-harvester` |
| 3.4 | Bedrock model access in **`us-east-1`** + IAM |

### Step 4 — Harvester (ECS)

| # | Action |
|---|--------|
| 4.1 | ECR `aloft-context-harvester` → build/push `Dockerfile.harvester` |
| 4.2 | ECS cluster `aloft-agents-prod` |
| 4.3 | Edit + register [task-definition.json](../infra/context/task-definition.json) |
| 4.4 | Aurora SG: **5432** from **Fargate SG** |
| 4.5 | **Manual RunTask** (your subnets + SG) — must succeed |
| 4.6 | [eventbridge-rule.json](../infra/context/eventbridge-rule.json) + `apply-eventbridge.ps1` |

### Step 5 — Web (Beanstalk)

| # | Action |
|---|--------|
| 5.1 | ECR `aloft-d360-web` → [deploy-beanstalk.md](./deploy-beanstalk.md) |
| 5.2 | EB env `aloft-d360-dev` in **same VPC** |
| 5.3 | ACM + HTTPS + DNS |
| 5.4 | Aurora SG: **5432** from **EB instance SG** |
| 5.5 | EB env vars from [env.template](../infra/aws/env.template), `HARVEST_RUNTIME=ecs` |

### Step 6 — App finish

| # | Action |
|---|--------|
| 6.1 | Entra redirect + `NEXTAUTH_URL` |
| 6.2 | `npx prisma migrate deploy` |
| 6.3 | `npm run check:integrations` |

### Step 7 — Cutover legacy

Stop writes on legacy → final snapshot if needed → DNS/users to new URL → decommission legacy later.

**Where you are today:** if **Step 0** is blocked (no VPC), do **Step 1** only where IAM allows, **Step 3.4** Bedrock, and **local Docker builds** — then resume **Step 2** when network team delivers VPC/subnets/SGs.

---

## 1.3 Dedicated account with admin access (you create everything)

If you have **Administrator** (or equivalent) in the dedicated account, follow **[§1.2](#12-you-are-creating-services-in-the-dedicated-account-self-service)** end-to-end. You do **not** need a separate Cloud handoff team — still fill [aws-cloud-handoff-checklist.md](./aws-cloud-handoff-checklist.md) as your own runbook.

### VPC minimum for dev (ap-south-1)

Simple pattern that works for ALOFT D360:

| Piece | Recommendation |
|-------|----------------|
| **VPC CIDR** | e.g. `10.0.0.0/16` (non-overlapping with legacy VPC if you ever peer) |
| **AZs** | At least **2** (e.g. `ap-south-1a`, `ap-south-1b`) |
| **Private subnets** | Aurora **DB subnet group** (no public IP on RDS) |
| **Public or private app subnets** | **Public + IGW** → Fargate `ECS_ASSIGN_PUBLIC_IP=ENABLED` (quick dev). **Private + NAT** → `DISABLED` (better production shape) |
| **Beanstalk** | Same VPC; pick instance subnets + separate ALB subnets per EB wizard |

Console path (one option): **VPC** → **Create VPC** → **VPC and more** (creates public + private subnets + NAT in one flow). Then:

1. **RDS** → **Subnet groups** → create group from **private** subnets.
2. **EC2** → **Security groups** → Aurora SG + Fargate SG (egress 443, 5432).
3. Record subnet IDs for `ECS_SUBNET_IDS` and Beanstalk network config.

Update [scripts/infra/provision-aloft-agents.sh](../scripts/infra/provision-aloft-agents.sh) `VPC_ID`, `SUBNET_*`, `AURORA_SG_ID` with **your** values before running optional automation.

### Admin create order (one line)

**VPC + subnets + NAT/IGW → SGs → IAM → snapshot restore Aurora → Secrets/S3/logs → Bedrock (us-east-1) → ECR/ECS/harvester/test task → EventBridge → ECR/EB/web → Aurora SG rules for Fargate + EB → env/Entra/migrate/verify → legacy cutover.**

### Legacy account access

Snapshot **share** requires someone with RDS access in the **legacy** account (may still be a different login). You only need **read + share snapshot** there; **all new resources** are created in the **dedicated** admin account.

---

## 1.4 Cloud team owns DB migration — what you create (ordered)

**Cloud team:** snapshot share, Aurora restore/migration, writer endpoint, DB subnet group, Aurora security group (and usually VPC/subnets for RDS).  
**You:** everything below — **no** snapshot/copy/restore steps.

### Wait for Cloud handoff before steps 3–4 and Aurora SG rules

Ask Cloud to return (checklist sections **B**, and network **C** if they own VPC):

| From Cloud | Used for |
|------------|----------|
| Aurora **writer endpoint**, DB name, credentials | `aloft/aurora` secret, Beanstalk `DATABASE_URL` |
| **VPC ID** | Beanstalk + Fargate same VPC as Aurora |
| **Subnet IDs** (2+ AZs) for ECS Fargate | `ECS_SUBNET_IDS` |
| **Subnet IDs** for Beanstalk instances + ALB | EB create wizard |
| **Aurora security group ID** | Inbound **5432** from your Fargate + EB SGs |
| `ECS_ASSIGN_PUBLIC_IP` | `ENABLED` or `DISABLED` (NAT vs public subnets) |

You can start **§1.4 steps 1–2** and **6** (Bedrock) while Cloud migrates the DB; **step 3** needs credentials; **steps 9–10** need Aurora + SG rules.

### Your create list (strict order)

| Step | You create / configure | ✓ Gate |
|------|------------------------|--------|
| **1** | **IAM:** ECS task execution role, ECS task role, EventBridge → `RunTask` role, Beanstalk EC2 instance profile | ARNs saved — track in [aws-migration-progress.md](./aws-migration-progress.md) |
| **2** | **Security group:** Fargate tasks (egress 443, 5432) in Cloud’s VPC | SG ID saved |
| **3** | **Secrets Manager:** `aloft/aurora` (from Cloud URLs), `aloft/databricks` | ARNs for task def |
| **4** | **S3** backfill bucket | Bucket name in env |
| **5** | **CloudWatch** log group `/ecs/aloft-context-harvester` | Exists |
| **6** | **Bedrock** (`us-east-1`): model access + policies on roles from step 1 | Models enabled |
| **7** | **ECR** repository `aloft-context-harvester` | URI saved |
| **8** | **ECS cluster** `aloft-agents-prod` | ACTIVE |
| **9** | Update [task-definition.json](../infra/context/task-definition.json) → **register** task definition | Revision ARN |
| **10** | Build/push **harvester** image (`Dockerfile.harvester`) | `:latest` in ECR |
| **11** | **Aurora SG:** inbound **5432** from Fargate SG (you or Cloud) | Agreed who applies |
| **12** | **Manual ECS RunTask** (Cloud subnets + Fargate SG) | Task OK in logs |
| **13** | **EventBridge** rules — [eventbridge-rule.json](../infra/context/eventbridge-rule.json) + `apply-eventbridge.ps1` | After step 12 only |
| **14** | **ECR** `aloft-d360-web` | URI saved |
| **15** | **Elastic Beanstalk** `aloft-d360-dev` — same VPC, [deploy-beanstalk.md](./deploy-beanstalk.md), fix [Dockerrun.aws.json](../infra/beanstalk/Dockerrun.aws.json) | Env created |
| **16** | **ACM** + ALB HTTPS + DNS (or Cloud DNS) | `https://` URL |
| **17** | **Aurora SG:** inbound **5432** from **Beanstalk instance SG** | Rule exists |
| **18** | Beanstalk **environment properties** — [env.template](../infra/aws/env.template), `HARVEST_RUNTIME=ecs`, all `ECS_*` | No secrets in git |
| **19** | Build/push **web** image, deploy beanstalk bundle | `/api/health` 200 |
| **20** | **Entra:** `NEXTAUTH_URL`, redirect URI | Login works |
| **21** | `npx prisma migrate deploy` (against Cloud’s Aurora) | Success |
| **22** | `npm run check:integrations` | Pass |
| **23** | **Cutover:** with Cloud — stop legacy app, final DB sync if they require it, switch DNS/users | Go-live |

**Optional later:** ECR `aloft-agent-runner` + `provision-aloft-agents.sh` if you use agent runner.

**You do not create:** VPC (if Cloud owns it), DB subnet group, Aurora cluster, snapshot share/copy/restore — Cloud only.

For **description and application rationale** for each step above, see [aws-build-steps-explained.md](./aws-build-steps-explained.md).

---

## 2. Pre-flight checklist (both teams)

Complete before creating resources in the target account.

- [ ] **Source account ID** and **target account ID** documented
- [ ] **Region** `ap-south-1` confirmed for app, RDS, ECS, EB, Secrets, S3
- [ ] **Bedrock** will be enabled in **`us-east-1`** for target account IAM
- [ ] **Migration method** chosen: Aurora snapshot (recommended) · AWS DMS · `pg_dump`/`pg_restore`
- [ ] **Cutover window** scheduled (write quiesce on source)
- [ ] **DNS / Entra**: new hostname for Beanstalk planned (`NEXTAUTH_URL`, redirect URI)
- [ ] **Databricks / Azure** credentials available for `aloft/databricks` secret (unchanged vendor; new Secrets Manager location)

**Gate:** Target account login verified (`aws sts get-caller-identity` shows target account).

---

## 3. Phase 1 — Network in target account

**Self-service:** follow [§1.2 Step 0](#12-you-are-creating-services-in-the-dedicated-account-self-service).  
**No VPC permission:** skip creation — track via [§1.1](#11-no-permission-to-create-a-vpc-typical-for-app-teams).

Create or adopt networking **before** Aurora restore.

### 3.1 VPC and subnets

- [ ] VPC in `ap-south-1` (Cloud landing zone **or** new VPC per org standards)
- [ ] **DB subnet group**: private subnets, **≥2 AZs**
- [ ] **App subnets** for Beanstalk EC2 and ALB (per EB network design)
- [ ] **Fargate subnets**: same VPC, **≥2 AZs** (document IDs for `ECS_SUBNET_IDS`)
- [ ] Routing: **NAT gateway** (private egress) **or** public subnets + `ECS_ASSIGN_PUBLIC_IP=ENABLED`

Record:

| Item | Value |
|------|--------|
| VPC ID | |
| Fargate subnet IDs (comma-separated) | |
| Beanstalk instance subnet IDs | |
| ALB subnet IDs | |
| NAT yes/no | |
| `ECS_ASSIGN_PUBLIC_IP` | `ENABLED` / `DISABLED` |

**Mistake:** Copying `VPC_ID` / subnet IDs from `scripts/infra/provision-aloft-agents.sh` without verifying they exist in the **target** account.

### 3.2 Security groups (create empty rules first; DB rules after EB/Fargate SGs exist)

- [ ] **Aurora SG** — no inbound from `0.0.0.0/0`
- [ ] **Fargate task SG** — egress TCP **443**, **5432** (to Aurora)
- [ ] (Later) **Beanstalk instance SG** — egress **443**, **5432**

**Gate:** VPC + DB subnet group + Aurora SG + Fargate SG IDs saved.

---

## 4. Phase 2 — IAM in target account (Cloud)

- [ ] ECS **task execution** role (ECR, logs, `secretsmanager:GetSecretValue` on `aloft/*`)
- [ ] ECS **task** role (harvester runtime: S3, Bedrock, etc. per standard)
- [ ] **EventBridge** role — `ecs:RunTask` on cluster `aloft-agents-prod`
- [ ] **Beanstalk EC2 instance profile** — Bedrock (`us-east-1`), ECS RunTask, Secrets `aloft/*`, S3 backfill, CloudWatch logs (`ap-south-1`)
- [ ] **KMS** keys if encrypted snapshots or org policy requires customer-managed keys

**Gate:** All role/profile ARNs saved for **target account**.

---

## 5. Phase 3 — Database: source → target (Cloud)

### 5.1 Aurora snapshot path (recommended)

**In source account:**

- [ ] Confirm Aurora cluster identifier and engine version
- [ ] Create **manual snapshot** (or use latest automated snapshot after quiesce at cutover)
- [ ] **Share snapshot** with target account ID
- [ ] If encrypted with CMK: grant target account **copy** permission on KMS key

**In target account (`ap-south-1`):**

- [ ] RDS → Shared snapshots → **Copy snapshot** into target account
- [ ] **Restore** new Aurora PostgreSQL cluster:
  - DB subnet group from §3.1
  - Aurora SG from §3.2
  - Instance class / Multi-AZ per standard
- [ ] Note **writer endpoint**, database name, master user
- [ ] Verify extension if used: `SELECT extname FROM pg_extension WHERE extname = 'vector';`

**Gate:** `psql` or Prisma can connect to **target** writer from a bastion/VPN/temporary SG rule.

### 5.2 Cutover sync (production)

For go-live (not first rehearsal):

- [ ] Stop writes on **source** app (scale down EB, disable EventBridge rules)
- [ ] Take **final** snapshot → share → copy → restore **or** use **AWS DMS** for minimal downtime
- [ ] Point all consumers at **target** endpoint only after final sync

### 5.3 Alternatives

| Method | Use when |
|--------|----------|
| **DMS** | Large DB, tight RPO, rehearsed cutover |
| **`pg_dump` / `pg_restore`** | Smaller DB or snapshot sharing blocked |

---

## 6. Phase 4 — Platform services in target account (Cloud)

**Order:** Secrets depend on DB endpoint; ECS tasks depend on Secrets.

- [ ] **Secrets Manager** `aloft/aurora` — JSON keys: `DATABASE_URL`, `DIRECT_URL` (target writer, `sslmode=require`)
- [ ] **Secrets Manager** `aloft/databricks` — keys per [aws-cloud-handoff-checklist.md](./aws-cloud-handoff-checklist.md) §F2
- [ ] Save full secret **ARNs** (with suffix) for task definition
- [ ] **S3** backfill bucket (name → `BACKFILL_S3_*`)
- [ ] **CloudWatch** log group `/ecs/aloft-context-harvester`
- [ ] **Bedrock** (`us-east-1`): model access + IAM policies on EB profile and ECS roles

**Gate:** Secrets exist before registering ECS task definition.

---

## 7. Phase 5 — Context harvester / ECS (Cloud + App)

### 7.1 Cloud

- [ ] ECR repository `aloft-context-harvester`
- [ ] ECS cluster `aloft-agents-prod`
- [ ] App team updates [infra/context/task-definition.json](../infra/context/task-definition.json) (account, roles, image, secret ARNs)
- [ ] Register task definition:

```bash
aws ecs register-task-definition \
  --cli-input-json file://infra/context/task-definition.json \
  --region ap-south-1
```

- [ ] App team builds and pushes image ([infra/context/deploy-notes.md](../infra/context/deploy-notes.md)):

```bash
# From repo root aloft-d360
docker build -t aloft-context-harvester -f Dockerfile.harvester .
# tag and push to TARGET_ACCOUNT.dkr.ecr.ap-south-1.amazonaws.com/aloft-context-harvester:latest
```

- [ ] **Aurora SG:** inbound **5432** from **Fargate task SG**
- [ ] **Manual RunTask** test (subnets, SG, `assignPublicIp` per §3.1) — task completes; logs in `/ecs/aloft-context-harvester`

**Gate:** Manual Fargate task succeeds **before** EventBridge.

### 7.2 EventBridge

- [ ] Update [infra/context/eventbridge-rule.json](../infra/context/eventbridge-rule.json) — subnets, SG, cluster ARN, task definition ARN **with revision**, `RoleArn`
- [ ] Apply rules:

```powershell
powershell -File scripts/infra/apply-eventbridge.ps1
```

- [ ] Confirm rules in checklist §I (daily/weekly schedules)

Optional: leave rules **DISABLED** until web cutover.

---

## 8. Repo files to update after account change

Search repo for old account `454073573537` and replace with **target account ID**.

| File | What to update |
|------|----------------|
| [infra/context/task-definition.json](../infra/context/task-definition.json) | `executionRoleArn`, `taskRoleArn`, `image`, all `secrets` ARNs |
| [infra/context/eventbridge-rule.json](../infra/context/eventbridge-rule.json) | Cluster, task def, subnets, SG, `RoleArn` |
| [infra/beanstalk/Dockerrun.aws.json](../infra/beanstalk/Dockerrun.aws.json) | `REPLACE_ACCOUNT_ID` in ECR image URL |
| [scripts/infra/provision-aloft-agents.sh](../scripts/infra/provision-aloft-agents.sh) | `ACCOUNT_ID`, `VPC_ID`, subnets, `AURORA_SG_ID`, role ARNs |
| [infra/aws/env.template](../infra/aws/env.template) | Copy to `.env.local` / Beanstalk — all `ECS_*`, S3, regions |

Runtime ECS from app uses [src/lib/aws/ecs-runtime-config.ts](../src/lib/aws/ecs-runtime-config.ts) (`ECS_*` env vars).

---

## 9. Phase 6 — Web app / Elastic Beanstalk (Cloud + App)

Follow [deploy-beanstalk.md](./deploy-beanstalk.md) with **target account** ECR.

- [ ] ECR `aloft-d360-web`
- [ ] Fix [infra/beanstalk/Dockerrun.aws.json](../infra/beanstalk/Dockerrun.aws.json)
- [ ] Create environment **`aloft-d360-dev`** — Docker AL2023, load balanced, **same VPC** as Aurora
- [ ] Instance type `t3.medium` × 1 (dev); attach instance profile from §4
- [ ] ACM certificate + ALB HTTPS + DNS hostname
- [ ] **Aurora SG:** inbound **5432** from **Beanstalk instance SG**
- [ ] Build/push web image; deploy beanstalk bundle (`infra/beanstalk/`)

**Gate:** `GET https://<host>/api/health` returns **200**.

---

## 10. Phase 7 — App configuration (App team)

- [ ] Copy [infra/aws/env.template](../infra/aws/env.template) → `.env.local` (never commit secrets)
- [ ] Beanstalk environment properties: `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_*`, `AZURE_AD_*`, `AWS_REGION=ap-south-1`, `BEDROCK_REGION=us-east-1`, `HARVEST_RUNTIME=ecs`, all `ECS_*`, `BACKFILL_S3_*`
- [ ] Prefer **IAM instance profile** on EB over long-lived access keys on EC2
- [ ] `NEXTAUTH_URL` = exact HTTPS URL
- [ ] Entra: redirect `https://<host>/api/auth/callback/azure-ad`
- [ ] `npx prisma migrate deploy --schema=./prisma/schema.prisma` (against target DB; usually no-op if snapshot is current)
- [ ] Set `DEFAULT_ORG_SLUG` / `DEFAULT_ORG_ID` in task definition if org differs (checklist §J)

---

## 11. Phase 8 — Verification

Run from `aloft-d360` root with env pointing at **target**:

```bash
npm run check:integrations
```

| Check | Expected |
|-------|----------|
| Postgres | OK |
| AWS / external endpoints | OK when keys and resources valid |
| `/api/health` | 200 |
| Entra login | Session works |
| Dashboard save / Inspector | No 5xx |
| Harvester | Manual RunTask or scheduled rule; logs in CloudWatch |

---

## 12. Phase 9 — Cutover from source account

- [ ] Communicate maintenance window
- [ ] **Source:** stop writes (EB scale down, disable EventBridge, block users)
- [ ] **Final DB sync** (snapshot or DMS)
- [ ] **DNS** → new Beanstalk / ALB hostname (if applicable)
- [ ] **Entra** redirects updated; remove old URL when safe
- [ ] Smoke test on **target** only
- [ ] Soak period (e.g. 1–2 weeks)
- [ ] **Source:** delete or stop billable resources; retain snapshots per policy

---

## 13. Mistakes to avoid (quick reference)

| Mistake | Prevention |
|---------|------------|
| App in target, DB only in source (private) | Restore DB in target VPC (this guide §5) |
| New empty Aurora instead of restore | Use snapshot share + restore |
| ECS tasks before Secrets | §6 before §7 |
| EventBridge before manual RunTask | §7.1 gate |
| Aurora open to internet | SG: 5432 only from EB + Fargate SGs |
| Stale ARNs in JSON | §8 + handoff checklist |
| `HARVEST_RUNTIME=local` on Beanstalk | Use `ecs` in deployed env |
| Bedrock in Mumbai | `BEDROCK_REGION=us-east-1` |

---

## 14. Cloud ticket template (copy/paste)

```text
ALOFT D360 — provision full stack in TARGET account __________, region ap-south-1.

Network: VPC/subnets (or use landing-zone VPC ________), DB subnet group, Aurora SG, Fargate SG.
IAM: ECS execution + task roles, EventBridge RunTask role, Beanstalk instance profile, Bedrock us-east-1.
Data: Share Aurora snapshot from SOURCE __________ → copy/restore in target; return writer endpoint.
Platform: Secrets aloft/aurora + aloft/databricks, S3 backfill, CW /ecs/aloft-context-harvester.
Compute: ECS cluster aloft-agents-prod, ECR aloft-context-harvester, task def, EventBridge per repo.
Web: ECR aloft-d360-web, Beanstalk aloft-d360-dev, ACM, DNS, ALB 600s idle (infra/beanstalk/).
Security: Aurora 5432 from EB instance SG + Fargate SG only.

Return completed aws-cloud-handoff-checklist.md (secrets via secure channel).
App team will update task-definition.json, eventbridge-rule.json, Dockerrun.aws.json, env.template.
```

---

## 15. Related documents

| Document | Purpose |
|----------|---------|
| [aws-recreate-and-configuration.md](./aws-recreate-and-configuration.md) | Same account; keep Aurora; recreate ECS/EB |
| [cloud-team-architecture-handoff.md](./cloud-team-architecture-handoff.md) | Diagrams, two runtimes, NFR |
| [aws-cloud-handoff-checklist.md](./aws-cloud-handoff-checklist.md) | Values Cloud returns |
| [platform-services-and-recreation.md](./platform-services-and-recreation.md) | Service map |
| [deploy-beanstalk.md](./deploy-beanstalk.md) | Web image + EB steps |
| [infra/context/deploy-notes.md](../infra/context/deploy-notes.md) | Harvester ECR/task/schedules |

---

*Maintained with: `infra/aws/env.template`, `docs/aws-recreate-and-configuration.md`.*
