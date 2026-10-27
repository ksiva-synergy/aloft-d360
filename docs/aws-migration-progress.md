# ALOFT D360 — AWS migration progress (working log)

Track what is **done**, **in progress**, and **pending** during the new-account build. Update this file as you complete each gate.

| | |
|---|---|
| **Build guide** | [aws-build-steps-explained.md](./aws-build-steps-explained.md) |
| **Strict step order** | [aws-new-account-migration-guide.md](./aws-new-account-migration-guide.md) §1.4 |
| **Fill in ARNs/IDs** | [aws-cloud-handoff-checklist.md](./aws-cloud-handoff-checklist.md) |
| **Task definition** | [infra/context/task-definition.json](../infra/context/task-definition.json) |

**Last updated:** 2026-10-10  
**AWS account ID:** _(paste from console top-right → checklist A1)_  
**CLI:** Not installed on dev machine yet — IAM work done via **console** only.

---

## Summary

| Area | Status |
|------|--------|
| Step 1A — ECS task **execution** role | **Done** (`aloftEcsTaskExecutionRole`) |
| Step 1B — ECS **task** role | **Done** (two inline policies on `aloftEcsTaskRole`) |
| Step 1C — EventBridge → ECS role | **Pending** |
| Step 1D — Beanstalk EC2 instance profile | **Pending** |
| Task definition wired to new role ARNs | **Pending** |
| Steps 2–23 (network, secrets, ECR, cluster, deploy, cutover) | **Pending** |

---

## Completed

### Step 1A — `aloftEcsTaskExecutionRole`

- [x] IAM role created; trusted entity **ECS Task**
- [x] Attached **`AmazonECSTaskExecutionRolePolicy`** (ECR pull, CloudWatch logs for `awslogs`)
- [x] Inline policy for Secrets Manager read on `aloft/*` (e.g. `AloftSecretsRead`) — required for `secrets` in task definition
- [ ] **ARN recorded** in checklist **C7** and `executionRoleArn` in `task-definition.json` _(confirm)_

**Purpose:** Used by **Fargate/ECS** at task startup (not by app code): pull image, write logs, inject `DATABASE_URL` / Databricks secrets.

### Step 1B — `aloftEcsTaskRole`

- [x] IAM role created; trusted entity **ECS Task**
- [x] Inline policy **`AloftHarvesterBedrock`**:
  - `bedrock:InvokeModel` — covers SDK **Converse** API
  - `bedrock:InvokeModelWithResponseStream` — covers **ConverseStream**
  - **Do not use** `bedrock:Converse` / `bedrock:ConverseStream` in IAM JSON — IAM console rejects them; see [Bedrock Converse prerequisites](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html)
- [x] Inline policy **`AloftHarvesterRunTask`**:
  - `ecs:RunTask`, `ecs:DescribeTasks` on cluster `aloft-agents-prod` and task family `aloft-context-harvester`
  - `iam:PassRole` on **both** `aloftEcsTaskExecutionRole` and `aloftEcsTaskRole`
- [x] **Not** attached on task role: `AmazonECSTaskExecutionRolePolicy`, S3 backfill _(harvester code does not use S3 today)_
- [ ] **ARN recorded** in checklist **C8** and `taskRoleArn` in `task-definition.json` _(confirm)_

**Purpose:** Used by **harvester code** inside the container: Bedrock (T2/T3 enrichment), and optional chained `RunTask` from `orchestrator.ts`.

### Notes from implementation

- Separate **execution** vs **task** roles: least privilege + correct `PassRole` when starting tasks.
- S3 **backfill** bucket is **optional for harvester**; only smoke-tested in `scripts/check-external-endpoints.mjs` — see [platform-services-and-recreation.md](./platform-services-and-recreation.md) §S3.

---

## In progress / next actions (do these soon)

1. **Copy ARNs** from IAM → Roles → each role → paste into [aws-cloud-handoff-checklist.md](./aws-cloud-handoff-checklist.md) **C7**, **C8**.
2. **Update** [infra/context/task-definition.json](../infra/context/task-definition.json):
   - `executionRoleArn` → `aloftEcsTaskExecutionRole` ARN
   - `taskRoleArn` → `aloftEcsTaskRole` ARN (must **differ** from execution role)
   - Replace stale account `454073573537` / `ecsTaskExecutionRole` if building in a **new** account
   - Update `image`, `secrets` ARNs, `DEFAULT_ORG_*` when Cloud hands off values
3. **Bedrock model access** (console): region **`us-east-1`** → Amazon Bedrock → enable models (e.g. Claude).
4. **Register** task definition (ECS console → JSON revision, or AWS CLI after install).
5. **Optional:** Install [AWS CLI v2](https://awscli.amazonaws.com/AWSCLIV2.msi) for `register-task-definition` and `check:integrations`.

---

## Pending — Step 1 (IAM remainder)

| Item | Role name (example) | Checklist |
|------|---------------------|-----------|
| EventBridge → `RunTask` | `aloftEventBridgeEcsRole` | C9 |
| Beanstalk EC2 instance profile | `aloftEbEc2Role` | L5 |

---

## Pending — Steps 2–23 (high level)

Use [aws-new-account-migration-guide.md](./aws-new-account-migration-guide.md) §1.4 for the full ordered list.

| Step | Item | Status |
|------|------|--------|
| 2 | Fargate security group (VPC egress 443, 5432) | Pending |
| 3 | Secrets Manager `aloft/aurora`, `aloft/databricks` | Pending |
| 4 | S3 backfill bucket (optional for harvester; EB / smoke tests) | Pending |
| 5 | CloudWatch log group `/ecs/aloft-context-harvester` | Pending |
| 6 | Bedrock policies on **Beanstalk** role + confirm model access | Partial _(task role done)_ |
| 7 | ECR `aloft-context-harvester` | Pending |
| 8 | ECS cluster `aloft-agents-prod` | Pending |
| 9 | Register task definition (after JSON + secrets ARNs) | Pending |
| 10 | Build/push harvester image | Pending |
| 11 | Aurora SG: 5432 from Fargate SG | Pending |
| 12 | Manual ECS RunTask test | Pending |
| 13 | EventBridge rules (after step 12) | Pending |
| 14–19 | Web ECR, Beanstalk, ACM, env vars, web deploy | Pending |
| 20–23 | Entra, Prisma migrate, integrations check, cutover | Pending |

---

## Cloud handoff still needed

Record when Cloud provides (checklist **B**, **C4–C6**, **L**):

- Aurora writer endpoint and credentials → secret `aloft/aurora`
- VPC subnet IDs for Fargate and Beanstalk
- Whether `ECS_ASSIGN_PUBLIC_IP` is `ENABLED` or `DISABLED`
- Aurora security group inbound from Fargate + EB security groups

---

## Verification gates

- [ ] `taskRoleArn` ≠ `executionRoleArn` in registered task definition
- [ ] Both roles visible on IAM role **Permissions** tab with policies listed above
- [ ] First Fargate task reaches CloudWatch log group without `AccessDenied` on secrets or ECR
- [ ] Harvester job can call Bedrock (no `AccessDenied` on `bedrock:InvokeModel`)
