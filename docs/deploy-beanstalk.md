# Deploy ALOFT D360 web app to Elastic Beanstalk (Docker + ECR)

Harvester stays on **ECS Fargate** (`HARVEST_RUNTIME=ecs`). This guide is **web only**.

Region assumed: **ap-south-1**. Replace `ACCOUNT_ID` and hostnames with yours.

---

## Prerequisites

- AWS CLI configured (`aws sts get-caller-identity`)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (build image)
- [EB CLI](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/eb-cli3-install.html) (optional but convenient)
- ECR repository `aloft-d360-web`
- Aurora + IAM role for EC2 (Bedrock, `ecs:RunTask`, Secrets Manager, S3, logs)
- Entra redirect URI: `https://<host>/api/auth/callback/azure-ad`

**Account defaults (Synergy target):** `640012953890`, app `aloft-d360-web`, env `Aloft-d360-web-env`, EB artifacts bucket `elasticbeanstalk-ap-south-1-640012953890`.

---

## Step-by-step: first deploy (read this first)

The **zip does not contain your app**. It only points Beanstalk at a **Docker image in ECR** plus nginx/ALB settings. Every release needs a **new image in ECR** and a **new Beanstalk deploy** (new application version).

### Phase A — Prerequisites (you + cloud)

| Step | Action | Who |
|------|--------|-----|
| A1 | ECR repo **`aloft-d360-web`** exists | Cloud / CI |
| A2 | GitHub Actions **ECR** job green on `main`, or image pushed manually (Phase B) | You |
| A3 | VPC, subnets, **EC2 instance profile** (ECR pull, Bedrock, ECS RunTask, Secrets, S3, logs) | Cloud |
| A4 | Aurora reachable; SG allows **5432** from **Beanstalk instance SG** | Cloud |
| A5 | AWS CLI works: `aws sts get-caller-identity` → `640012953890` | You |

### Phase B — Docker image in ECR

**Option B1 — CI (preferred):** merge to `main` → Actions → **build-web** succeeds → image tags `latest` and `<git-sha>` in ECR.

**Option B2 — Laptop:**

```powershell
cd c:\ALOFT\aloft-d360
$ACCOUNT = "640012953890"
$REGION = "ap-south-1"
$ECR = "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/aloft-d360-web"

aws ecr get-login-password --region $REGION |
  docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

docker build -f Dockerfile -t aloft-d360-web .
docker tag aloft-d360-web:latest "${ECR}:latest"
docker push "${ECR}:latest"
```

Verify:

```powershell
aws ecr describe-images --repository-name aloft-d360-web --region ap-south-1 --output table
```

### Phase C — Build the Beanstalk zip

1. Open `infra/beanstalk/Dockerrun.aws.json`. Image should match ECR, e.g.  
   `640012953890.dkr.ecr.ap-south-1.amazonaws.com/aloft-d360-web:latest`  
   (or pin `:git-sha` for a specific build).

2. Create zip with **files at the root** of the archive (not a parent `beanstalk` folder):

```powershell
cd c:\ALOFT\aloft-d360\infra\beanstalk
$zip = "c:\ALOFT\aloft-d360\eb-deploy.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path Dockerrun.aws.json, .ebextensions, .platform -DestinationPath $zip -Force
```

Contents must include: `Dockerrun.aws.json`, `.ebextensions/*.config`, `.platform/nginx/conf.d/timeouts.conf`.

### Phase D — Deploy (pick one path)

#### Path D1 — AWS Console (first environment)

1. Region **ap-south-1** → **Elastic Beanstalk** → **Create environment**.
2. **Standard** (not Cluster). Application **`aloft-d360-web`**. Environment name **`Aloft-d360-web-env`** (or your chosen name).
3. Platform: **Docker**, **Amazon Linux 2023**, recommended version.
4. **Application code:** **Upload a file** → choose `eb-deploy.zip`. **Do not** use Sample application.
5. Version label: e.g. `v1-2026-03-12`.
6. Complete **Service access** (instance profile), **Networking** (VPC/subnets from cloud), **Instance** `t3.medium`, capacity **1**.
7. **Create environment** → wait until **Health: Ok** (10–20 min).

**Alternative on same screen:** **Upload from S3** after Phase E upload; URI  
`s3://elasticbeanstalk-ap-south-1-640012953890/aloft-d360-web/v1.zip`.

#### Path D2 — CLI (cloud team or if IAM allows)

**E1 — Upload zip to the Elastic Beanstalk account bucket:**

```bash
REGION=ap-south-1
APP=aloft-d360-web
VERSION=v1
BUCKET=elasticbeanstalk-ap-south-1-640012953890
KEY="${APP}/${VERSION}.zip"

aws s3 cp eb-deploy.zip "s3://${BUCKET}/${KEY}" --region "$REGION"
```

**E2 — Create application (once only):**

```bash
aws elasticbeanstalk create-application \
  --application-name aloft-d360-web \
  --region ap-south-1 \
  --tags Key=map-migrated,Value=migM7E421L79Y
```

If the app already exists, ignore `Application ... already exists`.

**E3 — Register application version:**

```bash
aws elasticbeanstalk create-application-version \
  --application-name aloft-d360-web \
  --version-label v1 \
  --source-bundle S3Bucket=elasticbeanstalk-ap-south-1-640012953890,S3Key=aloft-d360-web/v1.zip \
  --region ap-south-1 \
  --tags Key=map-migrated,Value=migM7E421L79Y
```

Replace `S3Key` with the exact key from E1 (`aloft-d360-web/v1.zip`).

**E4 — Create environment (first time only):**

Either finish in the **console** (easier for VPC/subnets/ALB), or CLI with a solution stack from:

```bash
aws elasticbeanstalk list-available-solution-stacks --region ap-south-1 \
  --query "SolutionStacks[?contains(@, 'Amazon Linux 2023') && contains(@, 'Docker')]" \
  --output table
```

Then (example — stack name must match list output):

```bash
aws elasticbeanstalk create-environment \
  --application-name aloft-d360-web \
  --environment-name Aloft-d360-web-env \
  --version-label v1 \
  --solution-stack-name "64bit Amazon Linux 2023 v4.7.0 running Docker" \
  --region ap-south-1 \
  --tags Key=map-migrated,Value=migM7E421L79Y
```

Steps E2–E3 alone **do not start servers**; E4 (or console create) is required.

### Phase F — Configure the running environment

1. EB → **Configuration** → **Updates, monitoring, and logging** → **Environment properties** → **Edit**.
2. Set variables from `infra/aws/env.template` and your secure `.env` (never commit secrets). Minimum:
   - `DATABASE_URL`, `DIRECT_URL`
   - `NEXTAUTH_URL`, `NEXTAUTH_SECRET`
   - `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID`
   - `NODE_ENV=production`, `HARVEST_RUNTIME=ecs`
   - `AWS_REGION=ap-south-1`, `ECS_*`, `BEDROCK_REGION`, etc.
3. **Apply** (environment updates again).

### Phase G — Database migrations

From a machine that can reach Aurora:

```powershell
cd c:\ALOFT\aloft-d360
npx prisma migrate deploy --schema=./prisma/schema.prisma
```

### Phase H — Verify

1. EB environment **Health: Ok**.
2. Browser: `https://<environment-url>/api/health` → `{"ok":true}`.
3. **Entra:** redirect URI `https://<host>/api/auth/callback/azure-ad` matches `NEXTAUTH_URL`.
4. Smoke test: `/login` and a short Inspector chat (validates long timeouts).

### Phase I — Every later release (no new application)

1. New image in ECR (CI or `docker push`).
2. New zip (optional if only image tag changes in `Dockerrun.aws.json`).
3. Upload to S3 → `create-application-version` with new label (`v2`, …).
4. `update-environment`:

```bash
aws elasticbeanstalk update-environment \
  --environment-name Aloft-d360-web-env \
  --version-label v2 \
  --region ap-south-1
```

Or console: **Upload and deploy** with a new zip.

**You do not** need a new zip when only **environment properties** change (edit in console). **You do** need a new deploy when the **image** or **`.ebextensions` / `.platform`** change.

### Phase J — Automate from GitHub (optional)

After application + environment exist:

1. Repo **Variables (optional):** `EB_APPLICATION_NAME`, `EB_ENVIRONMENT_NAME`. Set `ENABLE_EB_DEPLOY=false` only if you need ECR-only runs on `main`.
2. Secret **`AWS_ROLE_ARN`** → role **`aloftGithubActionsDeploy`** (or your deploy role). Attach permissions from [`infra/aws/github-actions-deploy-permissions.policy.json`](../infra/aws/github-actions-deploy-permissions.policy.json). **Important:** `update-environment` can fail with `s3:CreateBucket` on `elasticbeanstalk-ap-south-1-<account>` even when that bucket already exists — the role still needs `s3:CreateBucket` on that bucket ARN (not only `PutObject`).
3. Push to **`main`** → workflow builds image, zips bundle, uploads S3, `create-application-version`, wait for version processed, `update-environment` on the **existing** environment (no new app/env).

See [§7 Deploy a new version](#7-deploy-a-new-version) below.

---

## 1. Build and push the Docker image

From `aloft-d360` root:

```powershell
cd c:\ALOFT\aloft-d360

$ACCOUNT_ID = aws sts get-caller-identity --query Account --output text
$REGION = "ap-south-1"
$ECR = "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/aloft-d360-web"

aws ecr create-repository --repository-name aloft-d360-web --region $REGION 2>$null

aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

docker build -t aloft-d360-web -f Dockerfile .
docker tag aloft-d360-web:latest "${ECR}:latest"
docker push "${ECR}:latest"
```

Test locally first: see **[docker-local-dev.md](./docker-local-dev.md)** (build both images, smoke-test, harvester one-shots).

```powershell
docker run --rm -p 3000:3000 --env-file .env.local aloft-d360-web
```

---

## 2. Prepare the Beanstalk bundle

Edit `infra/beanstalk/Dockerrun.aws.json` if the account or image tag differs (default ECR URL uses `640012953890`).

Deploy zip contents = everything under `infra/beanstalk/`:

- `Dockerrun.aws.json`
- `.platform/nginx/conf.d/timeouts.conf`
- `.ebextensions/*.config`

---

## 3. Create the environment (first time)

### Option A — EB CLI

```powershell
cd c:\ALOFT\aloft-d360\infra\beanstalk

eb init -p docker aloft-d360-web --region ap-south-1

# Cloud dev (HTTPS + SSO): load-balanced, 1 instance
eb create Aloft-d360-web-env `
  --elb-type application `
  --instance-types t3.medium `
  --scale 1 `
  --envvars NODE_ENV=production,HARVEST_RUNTIME=ecs

# Production: 2 instances
# eb create aloft-d360-prod --elb-type application --instance-types t3.medium --scale 2 ...
```

### Option B — AWS Console

1. Elastic Beanstalk → **Create environment** → **Web server environment**
2. Platform: **Docker running on 64bit Amazon Linux 2023**
3. Upload zip of `infra/beanstalk` (after fixing `Dockerrun.aws.json`)
4. Instance: **t3.medium**; load balanced for HTTPS

---

## 4. HTTPS and domain

1. **ACM** certificate for `d360-dev.yourcompany.com` (same region as ALB)
2. EB → **Configuration** → **Load balancer** → add **HTTPS:443** listener + cert
3. Route 53 (or DNS) **CNAME** to EB environment URL
4. Set environment properties:

```text
NEXTAUTH_URL=https://d360-dev.yourcompany.com
```

Add matching redirect URI in **Microsoft Entra**.

---

## 5. Environment variables

EB → **Configuration** → **Updates, monitoring, and logging** → **Environment properties**.

Copy from `infra/aws/env.template` and `.env.local` (never commit secrets):

| Required |
|----------|
| `DATABASE_URL`, `DIRECT_URL` |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` |
| `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID` |
| `AWS_REGION`, `HARVEST_RUNTIME=ecs` |
| `ECS_CLUSTER_NAME`, `ECS_*` (subnets, SG, task definition) |
| `BEDROCK_REGION`, Bedrock/Foundry keys as used |

Prefer **IAM instance profile** on EC2 instead of long-lived `AWS_ACCESS_KEY_ID` when possible.

Or via CLI:

```powershell
eb setenv NEXTAUTH_URL=https://d360-dev.example.com HARVEST_RUNTIME=ecs ...
```

---

## 6. Database migrations

Run once per release (CI or laptop with network to Aurora):

```powershell
cd c:\ALOFT\aloft-d360
npx prisma migrate deploy --schema=./prisma/schema.prisma
```

---

## 7. Deploy a new version

### CI (GitHub Actions)

On push to **`main`** or **`develop`**, [`.github/workflows/ecr-push.yml`](../.github/workflows/ecr-push.yml) **always** builds and pushes **harvester** and **web** images to ECR.

On **`main`**, the workflow **always deploys to Elastic Beanstalk** after a successful web image push (unless repo variable **`ENABLE_EB_DEPLOY`** = `false`). A follow-up job fails the workflow if that deploy step was skipped or failed, so `main` cannot silently ship ECR-only.

The deploy job zips `infra/beanstalk` (with `Dockerrun.aws.json` pointing at the commit SHA tag) and runs `update-environment`. Override names with `EB_APPLICATION_NAME`, `EB_ENVIRONMENT_NAME`.

Requires GitHub secret **`AWS_ROLE_ARN`** and IAM permissions for ECR + Elastic Beanstalk + the `elasticbeanstalk-ap-south-1-<account>` S3 bucket. **`develop`** only pushes ECR (no EB deploy).

Manual run: **Actions** → **Build, push ECR, deploy Beanstalk** → enable **Deploy web to Elastic Beanstalk**.

### Manual (EB CLI)

After pushing a new image to ECR:

```powershell
cd c:\ALOFT\aloft-d360\infra\beanstalk
eb deploy Aloft-d360-web-env
```

Or bump image tag in `Dockerrun.aws.json` and deploy.

---

## 8. Logs and health

- Health check: `GET /api/health` → `{"ok":true}`
- EB → **Logs** → enable **stream to CloudWatch**
- Inspector smoke test: chat > 3 minutes (validates nginx + ALB 600s timeouts)

---

## 9. Security groups

- EB instances → egress 443 (AWS APIs, Databricks, Bedrock)
- Aurora → inbound **5432** from EB instance security group
- Do **not** attach RDS to the Beanstalk environment lifecycle

---

## Related

- `docs/platform-services-and-recreation.md` — all services, env vars, recreation gaps
- `docs/aws-recreate-and-configuration.md` — ECS harvester, EventBridge
- `ARCHITECTURE.md` — full system diagram
