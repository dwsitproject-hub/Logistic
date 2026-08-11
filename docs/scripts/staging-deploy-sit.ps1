# KLIP — Export master vessel locally + PuTTY deploy checklist (SIT).
# Does NOT SSH automatically — run the printed PuTTY blocks on .57 and .56.
#
# Usage:
#   cd D:\Project\Klip
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   .\docs\scripts\staging-deploy-sit.ps1
#   .\docs\scripts\staging-deploy-sit.ps1 -SkipExport

param(
  [switch]$SkipExport,
  [switch]$SkipPush
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $RepoRoot

Write-Host "KLIP SIT deploy helper" -ForegroundColor Cyan
Write-Host "Repo: $RepoRoot"

if (-not $SkipPush) {
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($git) {
    $ahead = git rev-list --count origin/SIT..SIT 2>$null
    if ($ahead -and [int]$ahead -gt 0) {
      Write-Host "WARN: Branch SIT is $ahead commit(s) ahead of origin/SIT. Push first:" -ForegroundColor Yellow
      Write-Host "  git push origin SIT"
    } else {
      Write-Host "Git: SIT branch is pushed (or in sync with origin/SIT)." -ForegroundColor Green
    }
  }
}

if (-not $SkipExport) {
  Write-Host ""
  Write-Host "==> Export master vessel from local Docker" -ForegroundColor Cyan
  & (Join-Path $RepoRoot "docs/scripts/export-master-vessel-local.ps1")
}

$exportFile = Join-Path $RepoRoot "tmp/master_vessel_local_to_sit.sql"
if (Test-Path $exportFile) {
  $sizeKb = [math]::Round((Get-Item $exportFile).Length / 1KB, 1)
  Write-Host "Export ready: $exportFile ($sizeKb KB)" -ForegroundColor Green
} else {
  Write-Host "WARN: Export file missing - run export step before SIT master vessel sync." -ForegroundColor Yellow
}

$checklist = @(
  ""
  "========================================"
  "STEP 1 - Upload master vessel SQL to backend (.57)"
  "========================================"
  "  scp tmp/master_vessel_local_to_sit.sql ubuntu@172.28.92.57:/opt/klip/tmp/"
  ""
  "========================================"
  "STEP 2 - PuTTY backend 172.28.92.57"
  "========================================"
  "  cd /opt/klip"
  "  git fetch origin; git checkout SIT; git pull origin SIT"
  "  bash docs/scripts/staging-deploy-backend-full.sh"
  ""
  "  # Preview dedupe only (no DB changes):"
  "  # bash docs/scripts/staging-deploy-backend-full.sh --dedupe-dry-run --skip-master-vessel"
  ""
  "========================================"
  "STEP 3 - PuTTY frontend 172.28.92.56"
  "========================================"
  "  cd /opt/klip"
  "  git fetch origin; git checkout SIT; git pull origin SIT"
  "  bash docs/scripts/staging-deploy-frontend.sh"
  ""
  "========================================"
  "STEP 4 - Browser verify (Ctrl+Shift+R)"
  "========================================"
  "  http://8.215.6.189/api/health"
  "  http://8.215.6.189/trucking       - re-upload WB PENERIMAAN"
  "  http://8.215.6.189/master-vessel  - vessels from local export"
  ""
)

foreach ($line in $checklist) {
  Write-Host $line -ForegroundColor White
}
