# Elastic Beanstalk IAM (GitHub CI + environment rollout)

Two different IAM roles are involved. Fix the role that matches the error message.

| When it fails | Principal in the error | What to fix |
|---------------|------------------------|-------------|
| GitHub Actions job (`update-environment`, CloudFormation) | `assumed-role/aloftGithubActionsDeploy/GitHubActions` | **GitHub deploy role** — secret `AWS_ROLE_ARN` |
| EB console event *“Failed to deploy application”* / S3 `GetObjectAcl` | Often **no** GitHub user in the message — EB **service role** | **Environment service role** (see below) |

---

## 1. GitHub deploy role (`aloftGithubActionsDeploy`)

Used only by GitHub Actions OIDC (`AWS_ROLE_ARN`).

### Recommended

Attach managed policy **`AdministratorAccess-AWSElasticBeanstalk`** plus ECR push permissions (or **`PowerUserAccess`** + ECR — but EB deploy is simplest with the EB admin policy).

### Custom

[`github-actions-deploy-permissions.policy.json`](./github-actions-deploy-permissions.policy.json) — includes CloudFormation on `awseb-*` / `eb-*`, S3 on `elasticbeanstalk-ap-south-1-640012953890`, and EB APIs.

Typical GitHub-side errors if this role is too narrow:

- `cloudformation:GetTemplate` on `awseb-e-*-stack`
- `s3:CreateBucket` on `elasticbeanstalk-ap-south-1-<account>`

Re-run the workflow after IAM changes.

---

## 2. Elastic Beanstalk **service role** (environment rollout)

When CI succeeds but EB events show **“Failed to deploy application”** and **S3 `GetObjectAcl`**, the **environment’s service role** (not GitHub) must read the version zip from:

`s3://elasticbeanstalk-ap-south-1-640012953890/aloft-d360-web/...`

### Find the role

Elastic Beanstalk → **Aloft-d360-web-env** → **Configuration** → **Security** → **Service role** (often `aws-elasticbeanstalk-service-role` or a custom name).

### Fix

Attach AWS managed **`AWSElasticBeanstalkService`** (required for EC2/Auto Scaling/launch templates during deploy). Also add [`elasticbeanstalk-service-role-s3.policy.json`](./elasticbeanstalk-service-role-s3.policy.json) if S3 `GetObjectAcl` fails.

Typical EB event if the service role is too narrow:

- `You are not authorized to use launch template: lt-...` (Auto Scaling **403**) → service role cannot create/replace instances during update.

Then in EB → **Actions** → **Restart app server(s)** or redeploy the same application version.

---

## 3. EC2 instance profile (runtime, not deploy zip)

Separate from the above: instances need **ECR pull** (Docker image in `Dockerrun.aws.json`), Bedrock, Secrets Manager, etc. Deploy zip failures are **service role + S3**; container pull failures show in **/var/log/eb-docker** / Docker logs.
