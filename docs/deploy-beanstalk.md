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

Test locally (optional):

```powershell
docker run --rm -p 3000:3000 --env-file .env.local aloft-d360-web
```

---

## 2. Prepare the Beanstalk bundle

Edit `infra/beanstalk/Dockerrun.aws.json` — replace `REPLACE_ACCOUNT_ID` with your account id.

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
eb create aloft-d360-dev `
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

On push to **`main`**, workflow [`.github/workflows/ecr-push.yml`](../.github/workflows/ecr-push.yml) builds the web image, pushes to ECR, zips `infra/beanstalk` (with `Dockerrun.aws.json` pointing at the commit SHA tag), and runs `update-environment` on **`aloft-d360-dev`** (override via repo variables `EB_APPLICATION_NAME`, `EB_ENVIRONMENT_NAME`).

Requires GitHub secret **`AWS_ROLE_ARN`** and IAM permissions for ECR + Elastic Beanstalk + the `elasticbeanstalk-ap-south-1-<account>` S3 bucket. **`develop`** only pushes ECR (no EB deploy).

Manual run: **Actions** → **Build, push ECR, deploy Beanstalk** → enable **Deploy web to Elastic Beanstalk**.

### Manual (EB CLI)

After pushing a new image to ECR:

```powershell
cd c:\ALOFT\aloft-d360\infra\beanstalk
eb deploy aloft-d360-dev
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
