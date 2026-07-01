# Clean duplicate + cancelled trucking_operations on SIT/staging DB (172.28.92.57).
# Same sequence as docs/scripts/run-cleanup-trucking-staging.sh
#
# Usage:
#   .\scripts\run-cleanup-trucking-staging.ps1              # preview via SSH
#   .\scripts\run-cleanup-trucking-staging.ps1 -Apply         # execute cleanup
#
param(
  [switch]$Apply,
  [string]$Host = '172.28.92.57',
  [string]$User = 'ubuntu',
  [string]$Plink = 'C:\Program Files\PuTTY\plink.exe',
  [string]$Key = "$env:USERPROFILE\.ssh\id_rsa.ppk"
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not (Test-Path $Plink)) {
  Write-Error "plink.exe not found at $Plink. Install PuTTY or pass -Plink."
}

$keyArg = @()
if (Test-Path $Key) {
  $keyArg = @('-i', $Key)
} else {
  Write-Warning "SSH key not found at $Key — plink will use agent or prompt."
}

$remoteFlag = if ($Apply) { '--apply' } else { '' }
$remoteCmd = "cd /opt/klip && git fetch origin && git checkout SIT && git pull origin SIT && bash docs/scripts/run-cleanup-trucking-staging.sh $remoteFlag"

Write-Host "=== Staging trucking cleanup ($Host) ===" -ForegroundColor Cyan
Write-Host "Remote: $remoteCmd"

& $Plink -batch @keyArg "${User}@${Host}" $remoteCmd
if ($LASTEXITCODE -ne 0) {
  Write-Error "Remote cleanup failed (exit $LASTEXITCODE). Run manually on backend server — see docs/scripts/staging-deploy-putty.txt section 8."
}

if (-not $Apply) {
  Write-Host ""
  Write-Host "Preview done. To apply:" -ForegroundColor Yellow
  Write-Host "  .\scripts\run-cleanup-trucking-staging.ps1 -Apply"
}
