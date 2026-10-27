# verify-harvest-aws.ps1 — Preflight AWS + local env for ECS Fargate context harvester.
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File scripts/infra/verify-harvest-aws.ps1
# Requires: AWS CLI v2, credentials with at least ecs:Describe*, ec2:Describe*, sts:GetCallerIdentity

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$envFile = Join-Path $repoRoot '.env.local'
if (-not (Test-Path $envFile)) { $envFile = Join-Path $repoRoot '.env' }

function Write-Check([string]$Label, [bool]$Ok, [string]$Detail = '') {
  $mark = if ($Ok) { '[OK]' } else { '[FAIL]' }
  $color = if ($Ok) { 'Green' } else { 'Red' }
  Write-Host "$mark $Label" -ForegroundColor $color
  if ($Detail) { Write-Host "     $Detail" -ForegroundColor DarkGray }
}

function Import-DotEnv([string]$Path) {
  $map = @{}
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }
    $key = $line.Substring(0, $idx).Trim()
    $val = $line.Substring($idx + 1).Trim().Trim('"')
    $map[$key] = $val
  }
  return $map
}

Write-Host "`n=== Aloft harvester preflight ===" -ForegroundColor Cyan
Write-Host "Env file: $envFile`n"

if (-not (Test-Path $envFile)) {
  Write-Check 'Env file exists' $false "Create .env.local from infra/aws/env.template"
  exit 1
}

$cfg = Import-DotEnv $envFile
$region = $cfg['AWS_REGION']
if (-not $region) { $region = 'ap-south-1' }

$harvestRuntime = if ($cfg['HARVEST_RUNTIME']) { $cfg['HARVEST_RUNTIME'] } else { 'ecs' }
$harvestRuntime = $harvestRuntime.ToLower()
Write-Check 'HARVEST_RUNTIME is ecs (Fargate)' ($harvestRuntime -eq 'ecs') "Current: $harvestRuntime (local = PC spawn, not Fargate)"

$required = @(
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'ECS_CLUSTER_NAME',
  'ECS_CONTEXT_TASK_DEFINITION',
  'ECS_CONTEXT_CONTAINER_NAME',
  'ECS_SUBNET_IDS',
  'ECS_SECURITY_GROUP_IDS'
)
foreach ($k in $required) {
  $present = [bool]$cfg[$k]
  Write-Check "Env: $k" $present $(if (-not $present) { 'Missing in .env.local' } else { 'Set' })
}

$cluster = $cfg['ECS_CLUSTER_NAME']
$taskDef = $cfg['ECS_CONTEXT_TASK_DEFINITION']
$container = $cfg['ECS_CONTEXT_CONTAINER_NAME']
$subnets = ($cfg['ECS_SUBNET_IDS'] -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
$sgs = ($cfg['ECS_SECURITY_GROUP_IDS'] -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
$assignPublic = $cfg['ECS_ASSIGN_PUBLIC_IP']
if (-not $assignPublic) { $assignPublic = 'ENABLED' }

# Use same creds as Next.js for CLI checks
if ($cfg['AWS_ACCESS_KEY_ID']) { $env:AWS_ACCESS_KEY_ID = $cfg['AWS_ACCESS_KEY_ID'] }
if ($cfg['AWS_SECRET_ACCESS_KEY']) { $env:AWS_SECRET_ACCESS_KEY = $cfg['AWS_SECRET_ACCESS_KEY'] }
$env:AWS_REGION = $region

$identityRaw = aws sts get-caller-identity --output json 2>&1
$awsOk = $LASTEXITCODE -eq 0
Write-Check 'AWS CLI credentials (sts get-caller-identity)' $awsOk $(if (-not $awsOk) { ($identityRaw | Out-String).Trim() } else { '' })

if (-not $awsOk) {
  Write-Host "`nFix AWS credentials (invalid/expired keys in .env.local or run aws sso login), then re-run.`n" -ForegroundColor Yellow
  exit 2
}

$identity = $identityRaw | ConvertFrom-Json
Write-Host "     Account: $($identity.Account)  Arn: $($identity.Arn)" -ForegroundColor DarkGray

# Cluster
$clusterJson = aws ecs describe-clusters --clusters $cluster --region $region --output json 2>$null | ConvertFrom-Json
$clusterObj = $clusterJson.clusters | Select-Object -First 1
$clusterActive = $clusterObj -and $clusterObj.status -eq 'ACTIVE'
Write-Check "ECS cluster '$cluster' ACTIVE" $clusterActive $(if ($clusterObj) { "status=$($clusterObj.status)" } else { 'Cluster not found' })

# Task definition
$tdJson = aws ecs describe-task-definition --task-definition $taskDef --region $region --output json 2>$null | ConvertFrom-Json
$td = $tdJson.taskDefinition
$tdOk = $null -ne $td
Write-Check "Task definition '$taskDef'" $tdOk $(if ($tdOk) { "revision $($td.revision)" } else { 'Register task def or fix ECS_CONTEXT_TASK_DEFINITION' })

$containerOk = $false
if ($tdOk) {
  $names = $td.containerDefinitions | ForEach-Object { $_.name }
  $containerOk = $names -contains $container
  Write-Check "Container name '$container' in task def" $containerOk $(if (-not $containerOk) { "Found: $($names -join ', ')" } else { '' })
}

# Subnets
foreach ($sn in $subnets) {
  $snJson = aws ec2 describe-subnets --subnet-ids $sn --region $region --output json 2>$null | ConvertFrom-Json
  $snOk = $snJson.Subnets.Count -eq 1
  $az = if ($snOk) { $snJson.Subnets[0].AvailabilityZone } else { '?' }
  Write-Check "Subnet $sn exists" $snOk "AZ=$az"
}

# Security groups
foreach ($sg in $sgs) {
  $sgJson = aws ec2 describe-security-groups --group-ids $sg --region $region --output json 2>$null | ConvertFrom-Json
  $sgOk = $sgJson.SecurityGroups.Count -eq 1
  Write-Check "Security group $sg exists" $sgOk
}

# Log group (from repo convention)
$logGroup = '/ecs/aloft-context-harvester'
$lgJson = aws logs describe-log-groups --log-group-name-prefix $logGroup --region $region --output json 2>$null | ConvertFrom-Json
$lgOk = ($lgJson.logGroups | Where-Object { $_.logGroupName -eq $logGroup }).Count -ge 1
Write-Check "CloudWatch log group $logGroup" $lgOk $(if (-not $lgOk) { 'Create log group or update task def awslogs-group' } else { '' })

# Secrets (names only — no values)
foreach ($secretName in @('aloft/aurora', 'aloft/databricks')) {
  $sec = aws secretsmanager describe-secret --secret-id $secretName --region $region --output json 2>$null | ConvertFrom-Json
  $secOk = $null -ne $sec.ARN
  Write-Check "Secrets Manager secret '$secretName'" $secOk
}

# Dry RunTask (validates IAM PassRole + network without starting a long job)
Write-Host "`n--- ECS RunTask dry-run (IAM + network) ---" -ForegroundColor Cyan
$dryRun = aws ecs run-task `
  --cluster $cluster `
  --task-definition $taskDef `
  --launch-type FARGATE `
  --count 1 `
  --dry-run `
  --network-configuration "awsvpcConfiguration={subnets=[$($subnets -join ',')],securityGroups=[$($sgs -join ',')],assignPublicIp=$assignPublic}" `
  --region $region `
  --output json 2>&1

$dryOk = $LASTEXITCODE -eq 0
Write-Check 'ecs run-task --dry-run' $dryOk $(if (-not $dryOk) { ($dryRun | Out-String).Trim().Substring(0, [Math]::Min(200, ($dryRun | Out-String).Length)) } else { 'IAM + subnets + SG accepted by ECS API' })

Write-Host "`n--- Local app reminders ---" -ForegroundColor Cyan
Write-Check 'Restart npm run dev after .env.local changes' $true 'Next.js only loads env at startup'
Write-Check 'Use Jobs -> Run Job (not Catalog Harvest alone)' $true 'Launch API starts Fargate; Catalog only enqueues'
Write-Host "`nFull checklist: docs/aws-cloud-handoff-checklist.md`n" -ForegroundColor DarkGray
