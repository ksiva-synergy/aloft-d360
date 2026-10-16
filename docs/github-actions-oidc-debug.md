# Pinpoint GitHub OIDC → AWS assume-role failures

When `configure-aws-credentials` fails with `Not authorized to perform sts:AssumeRoleWithWebIdentity`, use these checks in order.

## 1. Run the diagnose workflow (fastest)

1. Merge `.github/workflows/oidc-diagnose.yml` to `main` (included in `chore/remove-azure-workflow`).
2. GitHub → **Actions** → **Diagnose GitHub OIDC → AWS** → **Run workflow** → branch **`main`**.
3. Open the run summary and job results:

| Result | Meaning |
|--------|--------|
| **Print GitHub + OIDC claims** shows `sub` | Copy `sub` exactly into IAM trust (`StringEquals` or `StringLike`). |
| **Assume role (skip session tags)** ✅ | Trust + `AWS_ROLE_ARN` are OK when tags are skipped. |
| **Assume role (with session tags)** ❌ but skip-tags ✅ | Add `sts:TagSession` to role trust **or** use `role-skip-session-tagging: true` in CI. |
| **Both assume jobs** ❌ | Wrong `AWS_ROLE_ARN`, wrong account, `sub` mismatch, missing OIDC provider, or **SCP deny**. |

## 2. Compare `sub` to IAM (your screenshot)

Trust often has:

```text
repo:Synergy-Marine-Group/aloft-d360:ref:refs/heads/main
```

The diagnose workflow prints the **actual** `sub` GitHub sends. It must match the trust condition **character for character** (or use `StringLike` with `repo:Synergy-Marine-Group/aloft-d360:*`).

## 3. Verify the secret (no paste in chat)

**Settings → Secrets → `AWS_ROLE_ARN`** must match IAM → Roles **exactly** (case-sensitive), e.g.:

```text
arn:aws:iam::640012953890:role/aloftGithubActionsDeploy
```

Verify in CloudShell: `aws iam get-role --role-name <RoleName>` must not return `NoSuchEntity`. Trust policy must be on **that** role, not a similarly named role.

## 4. AWS CloudTrail (definitive AWS-side reason)

In account **640012953890**:

1. **CloudTrail** → **Event history** (or Lake).
2. Filter **Event name** = `AssumeRoleWithWebIdentity`.
3. Time = failed workflow run.
4. Open the event → **Error message** / **Response elements** (shows which condition or SCP blocked access).

## 5. Enable verbose GitHub Actions logs (optional)

Repo **Settings → Secrets and variables → Actions** → add variable or secret:

```text
ACTIONS_STEP_DEBUG = true
```

Re-run the failed job for more lines from `configure-aws-credentials` (still won’t show the role ARN).

---

## 6. Apply trust policy (Copilot template, account filled)

IAM → **Roles** → `aloftGitHubActionsDeployRole` → **Trust relationships** → **Edit trust policy** → paste JSON from:

`infra/aws/github-oidc-trust-policy.example.json`

(`640012953890`, `main`, `develop`, `workflow_dispatch` subjects as suggested by Copilot.)

Ensure GitHub secret `AWS_ROLE_ARN` = `arn:aws:iam::640012953890:role/aloftGitHubActionsDeployRole`.

CI uses `role-skip-session-tagging: true` so trust only needs `sts:AssumeRoleWithWebIdentity` (no `sts:TagSession` required).
