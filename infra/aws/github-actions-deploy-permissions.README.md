# GitHub Actions deploy role (`aloftGithubActionsDeploy`)

Attach permissions to the role in GitHub secret **`AWS_ROLE_ARN`**.

## Recommended (fastest)

In IAM, attach AWS managed policy **`AdministratorAccess-AWSElasticBeanstalk`** to the deploy role (covers ECR is separate — keep ECR push policy or use a second managed policy for ECR).

## Custom (least privilege, may need tweaks)

Use [`github-actions-deploy-permissions.policy.json`](./github-actions-deploy-permissions.policy.json) as an inline or customer-managed policy.

`update-environment` does **not** only call Elastic Beanstalk APIs. It drives the environment’s **CloudFormation** stack (`awseb-e-*-stack`), S3 artifact bucket, and read-only calls to EC2 / Auto Scaling / ELB. Missing any of these shows as `InsufficientPrivilegesException` on the **next** service (e.g. `cloudformation:GetTemplate`, then `s3:CreateBucket`, etc.).

After changing IAM, re-run the failed GitHub Actions job (no code change required).
