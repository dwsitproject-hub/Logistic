# Dump KLIP SIT database to plain .sql on the staging backend, then copy to docs\.
#
# Prerequisites:
#   - VPN to AliCloud VPC (172.28.92.x)
#   - PuTTY plink/pscp (or OpenSSH scp)
#   - SSH key accepted for ubuntu@172.28.92.57
#
# Usage (repo root):
#   powershell -NoProfile -File docs\scripts\dump-sit-to-sql.ps1
#   powershell -NoProfile -File docs\scripts\dump-sit-to-sql.ps1 -Mode transactional
#   powershell -NoProfile -File docs\scripts\dump-sit-to-sql.ps1 -Mode full -Key "C:\path\to\key.ppk"
#
param(
  [ValidateSet('full', 'transactional')]
  [string]$Mode = 'full',
  [string]$StagingHost = '172.28.92.57',
  [string]$User = 'ubuntu',
  [string]$Plink = 'C:\Program Files\PuTTY\plink.exe',
  [string]$Pscp = 'C:\Program Files\PuTTY\pscp.exe',
  [string]$Key = '',
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $OutDir) { $OutDir = Join-Path $RepoRoot 'docs' }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

if (-not (Test-Path $Plink)) { throw "plink not found: $Plink" }
if (-not (Test-Path $Pscp)) { throw "pscp not found: $Pscp" }

$keyCandidates = @(
  $Key,
  "$env:USERPROFILE\.ssh\id_rsa.ppk",
  "$env:USERPROFILE\.ssh\klip-sit.ppk"
) | Where-Object { $_ -and (Test-Path $_) }
$keyArg = @()
if ($keyCandidates.Count -gt 0) {
  $keyArg = @('-i', $keyCandidates[0])
  Write-Host "Using SSH key: $($keyCandidates[0])"
} else {
  Write-Warning 'No .ppk key found. plink/pscp will use Pageant or prompt (batch mode may fail).'
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$remoteDir = '/opt/klip/backups'
$remoteFile = if ($Mode -eq 'full') {
  "$remoteDir/klip_sit_db_${stamp}.sql"
} else {
  "$remoteDir/klip_sit_txn_${stamp}.sql"
}

if ($Mode -eq 'full') {
  $remoteCmd = @"
set -euo pipefail
mkdir -p '$remoteDir'
cd /opt/klip
export PGPASSWORD="`$(docker exec klip-backend printenv DB_PASSWORD)"
DB_HOST="`$(docker exec klip-backend printenv DB_HOST)"
DB_PORT="`$(docker exec klip-backend printenv DB_PORT)"
DB_NAME="`$(docker exec klip-backend printenv DB_NAME)"
DB_USER="`$(docker exec klip-backend printenv DB_USER)"
echo "=== pg_dump full -> $remoteFile ==="
pg_dump -h "`$DB_HOST" -p "`$DB_PORT" -U "`$DB_USER" -d "`$DB_NAME" \
  -Fp --no-owner --no-acl -f '$remoteFile'
ls -lh '$remoteFile'
"@
} else {
  $remoteCmd = @"
set -euo pipefail
cd /opt/klip
bash docs/scripts/dump-sit-transactional-data.sh
ls -lt /opt/klip/backups/klip_sit_txn_*.dump | head -1
"@
}

Write-Host "=== Dump SIT ($Mode) via ${User}@${StagingHost} ===" -ForegroundColor Cyan
& $Plink -batch @keyArg "${User}@${StagingHost}" $remoteCmd
if ($LASTEXITCODE -ne 0) {
  throw "Remote dump failed (exit $LASTEXITCODE). Connect VPN, confirm SSH key, and ensure postgresql-client is installed on $StagingHost."
}

$localName = if ($Mode -eq 'full') {
  Split-Path $remoteFile -Leaf
} else {
  # transactional: dump-sit-transactional-data.sh writes klip_sit_txn_*.dump (custom format)
  $listCmd = "ls -t /opt/klip/backups/klip_sit_txn_*.dump 2>/dev/null | head -1"
  $latest = & $Plink -batch @keyArg "${User}@${StagingHost}" $listCmd
  if (-not $latest -or $LASTEXITCODE -ne 0) {
    throw "Could not find klip_sit_txn_*.dump on remote after transactional dump."
  }
  $latest.Trim()
}
$remoteFile = if ($Mode -eq 'full') { $remoteFile } else { $localName }
if ($Mode -ne 'full') {
  $localName = Split-Path $remoteFile -Leaf
  $remoteFile = "/opt/klip/backups/$localName"
}
$localPath = Join-Path $OutDir $localName
Write-Host "=== Download -> $localPath ===" -ForegroundColor Cyan
& $Pscp -batch @keyArg "${User}@${StagingHost}:$remoteFile" $localPath
if ($LASTEXITCODE -ne 0) {
  throw "pscp failed (exit $LASTEXITCODE)."
}

$sizeMb = [math]::Round((Get-Item $localPath).Length / 1MB, 2)
Write-Host "Done: $localPath ($sizeMb MB)" -ForegroundColor Green
