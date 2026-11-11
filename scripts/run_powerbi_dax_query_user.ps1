<#
.SYNOPSIS
Run a read-only DAX query against a semantic model as the signed-in user.

.DESCRIPTION
Uses the MicrosoftPowerBIMgmt.Profile module (Connect-PowerBIServiceAccount opens a browser
sign-in) and POST groups/{ws}/datasets/{id}/executeQueries. Workspace admins, members and
contributors are not filtered by RLS, so this works on RLS models the service principal
cannot query. Tokens are never printed.

Install once: Install-Module MicrosoftPowerBIMgmt.Profile -Scope CurrentUser

.EXAMPLE
.\scripts\run_powerbi_dax_query_user.ps1 -WorkspaceId <ws> -ModelId <model> -QueryFile query.dax -Output rows.json
#>
param(
    [Parameter(Mandatory = $true)][string]$WorkspaceId,
    [Parameter(Mandatory = $true)][string]$ModelId,
    [string]$Query,
    [string]$QueryFile,
    [int]$MaxRows = 20,
    [string]$Output
)

$ErrorActionPreference = 'Stop'
Import-Module MicrosoftPowerBIMgmt.Profile

if ($QueryFile) { $Query = Get-Content -Raw -Path $QueryFile }
if (-not $Query) { throw 'Pass -Query or -QueryFile.' }
if ($Query.TrimStart() -notmatch '^(?i)(EVALUATE|DEFINE)') { throw 'Only DAX EVALUATE/DEFINE queries are allowed.' }

$account = Connect-PowerBIServiceAccount
Write-Host "Signed in as $($account.UserName)"

$body = @{ queries = @(@{ query = $Query }); serializerSettings = @{ includeNulls = $true } } | ConvertTo-Json -Depth 5
try {
    $raw = Invoke-PowerBIRestMethod -Method Post -Url "groups/$WorkspaceId/datasets/$ModelId/executeQueries" -Body $body
} catch {
    $detail = Resolve-PowerBIError -Last | Out-String
    throw "executeQueries failed: $($_.Exception.Message) $detail"
}

$rows = ($raw | ConvertFrom-Json).results[0].tables[0].rows
Write-Host "$(@($rows).Count) row(s)"
@($rows) | Select-Object -First $MaxRows | ForEach-Object { $_ | ConvertTo-Json -Compress }
if ($Output) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Output) | Out-Null
    ConvertTo-Json -InputObject @($rows) -Depth 5 | Set-Content -Path $Output -Encoding UTF8
    Write-Host "Wrote $(@($rows).Count) row(s) to $Output"
}
