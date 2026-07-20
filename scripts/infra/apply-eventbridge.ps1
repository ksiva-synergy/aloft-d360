# apply-eventbridge.ps1
# Idempotent: put-rule + put-targets for all three harvester schedules.
# Run this whenever infra/context/eventbridge-rule.json changes.

$REGION = "ap-south-1"
$RULES   = Get-Content -Raw infra/context/eventbridge-rule.json | ConvertFrom-Json

# Iterate whatever rules are defined in eventbridge-rule.json (skipping the
# `_comment` metadata key). This repo ships change_detect_daily and
# estate_inventory_weekly; the T4 semantic schedule is intentionally absent
# because the T4/inspector tier was not ported here.
$ruleKeys = $RULES.PSObject.Properties.Name | Where-Object { $_ -ne "_comment" }

foreach ($key in $ruleKeys) {
  $rule   = $RULES.$key
  $target = $rule.Target
  $ecs    = $target.EcsParameters
  $net    = $ecs.NetworkConfiguration.awsvpcConfiguration

  Write-Host "`n==> Applying rule: $($rule.Name)"

  # 1. Create/update the schedule rule
  aws events put-rule `
    --name $rule.Name `
    --schedule-expression $rule.ScheduleExpression `
    --description $rule.Description `
    --state $rule.State `
    --region $REGION

  # 2. Build the target JSON as a file to avoid PowerShell quoting hell
  $targetJson = @{
    Id     = $target.Id
    Arn    = $target.Arn
    RoleArn = $target.RoleArn
    Input  = $target.Input
    EcsParameters = @{
      TaskDefinitionArn = $ecs.TaskDefinitionArn
      TaskCount         = $ecs.TaskCount
      LaunchType        = $ecs.LaunchType
      NetworkConfiguration = @{
        awsvpcConfiguration = @{
          Subnets        = $net.Subnets
          SecurityGroups = $net.SecurityGroups
          AssignPublicIp = $net.AssignPublicIp
        }
      }
    }
  } | ConvertTo-Json -Depth 10 -Compress

  $tmpFile = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($tmpFile, "[${targetJson}]", [System.Text.UTF8Encoding]::new($false))

  aws events put-targets `
    --rule $rule.Name `
    --targets file://$tmpFile `
    --region $REGION

  Remove-Item $tmpFile
}

Write-Host "`nDone. All EventBridge rules applied."
