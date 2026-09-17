# KLIP — Export master vessel locally + PuTTY deploy checklist (SIT).
# Does NOT SSH automatically unless -Upload is passed.
#
# Usage:
#   cd D:\Project\Klip
#   powershell -ExecutionPolicy Bypass -File docs/scripts/staging-deploy-sit.ps1
#   powershell -ExecutionPolicy Bypass -File docs/scripts/staging-deploy-sit.ps1 -Upload
#   powershell -ExecutionPolicy Bypass -File docs/scripts/staging-deploy-sit.ps1 -SkipExport -Upload

param(
  [switch]$SkipExport,
  [switch]$SkipPush,
  [switch]$Upload,
  [string]$StagingHost = "172.28.92.57",
  [string]$User = "ubuntu",
  [string]$Pscp = "C:\Program Files\PuTTY\pscp.exe",
  [string]$Key = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $RepoRoot

function Resolve-SitSshKey {
  param([string]$ExplicitKey)
  $candidates = @(
    $ExplicitKey,
    "$env:USERPROFILE\.ssh\id_rsa.ppk",
    "$env:USERPROFILE\.ssh\klip-sit.ppk"
  ) | Where-Object { $_ -and (Test-Path $_) }
  if ($candidates.Count -gt 0) { return $candidates[0] }
  return $null
}

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

$keyPath = Resolve-SitSshKey -ExplicitKey $Key
$pscpCmd = if ($keyPath) {
  "& `"$Pscp`" -batch -i `"$keyPath`" tmp/master_vessel_local_to_sit.sql ${User}@${StagingHost}:/opt/klip/tmp/"
} else {
  "# PuTTY key not found - use WinSCP or set -Key C:\path\to\your.ppk"
}

if ($Upload) {
  if (-not (Test-Path $exportFile)) {
    throw "Export file missing: $exportFile"
  }
  if (-not (Test-Path $Pscp)) {
    throw "pscp not found: $Pscp (install PuTTY)"
  }
  Write-Host ""
  Write-Host "==> Upload master vessel SQL via pscp (PuTTY session -load)" -ForegroundColor Cyan
  $pscpArgs = @("-load", "172.28.92.57", $exportFile, "${User}@${StagingHost}:/opt/klip/tmp/")
  if ($keyPath) {
    Write-Host "    key: $keyPath"
    $pscpArgs = @("-batch", "-i", $keyPath, $exportFile, "${User}@${StagingHost}:/opt/klip/tmp/")
  } else {
    Write-Host "    session: 172.28.92.57 (proxy/Pageant/GSSAPI from saved PuTTY config)"
  }
  & $Pscp @pscpArgs
  if ($LASTEXITCODE -ne 0) {
    throw "pscp failed (exit $LASTEXITCODE). Try WinSCP (import PuTTY session) or run pscp without -batch."
  }
  Write-Host "Upload OK." -ForegroundColor Green
}

$checklist = @(
  ""
  "========================================"
  "STEP 1 - Upload master vessel SQL to backend (.57)"
  "========================================"
  "  OpenSSH scp/password will FAIL. Use saved PuTTY session (proxy + Pageant/GSSAPI):"
  "  & `"C:\Program Files\PuTTY\pscp.exe`" -load `"172.28.92.57`" tmp/master_vessel_local_to_sit.sql ubuntu@172.28.92.57:/opt/klip/tmp/"
  ""
  "  (Remove -batch if Pageant needs interactive auth. Ensure Pageant is running if you use agent keys.)"
  ""
  "  Easiest: WinSCP -> New Session -> Tools -> Import PuTTY session `"172.28.92.57`" -> upload to /opt/klip/tmp/"
  ""
  "  Or auto-upload (uses -load session):"
  "  powershell -ExecutionPolicy Bypass -File docs/scripts/staging-deploy-sit.ps1 -SkipExport -Upload"
  ""
  "========================================"
  "STEP 2 - PuTTY backend $StagingHost"
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
