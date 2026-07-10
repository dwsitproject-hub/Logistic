# Export master_plants.group_plant from SIT/staging DB and apply to local Docker Postgres.
#
# Requires: VPN to 172.28.92.57, PuTTY plink, SSH key (or agent), local klip-postgres running.
#
# If PowerShell blocks .ps1 (execution policy), use the .cmd wrapper instead:
#   scripts\sync-master-plant-group-from-staging.cmd
#   scripts\sync-master-plant-group-from-staging.cmd -Apply
#
# Usage:
#   .\scripts\sync-master-plant-group-from-staging.ps1              # preview (export + dry-run apply)
#   .\scripts\sync-master-plant-group-from-staging.ps1 -Apply       # export + apply to local
#   .\scripts\sync-master-plant-group-from-staging.ps1 -ApplyOnly -CsvPath .\tmp\group.csv
#
param(
  [switch]$Apply,
  [switch]$ApplyOnly,
  [string]$CsvPath = '',
  [string]$StagingHost = '172.28.92.57',
  [string]$User = 'ubuntu',
  [string]$Plink = 'C:\Program Files\PuTTY\plink.exe',
  [string]$Key = "$env:USERPROFILE\.ssh\id_rsa.ppk"
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Backend = Join-Path $Root 'backend'
$TmpDir = Join-Path $Root 'tmp'

function Read-DotEnvValue {
  param([string]$File, [string]$Name)
  if (-not (Test-Path $File)) { return $null }
  foreach ($line in Get-Content $File) {
    if ($line -match "^\s*$Name\s*=\s*(.+)\s*$") {
      return $Matches[1].Trim().Trim('"').Trim("'")
    }
  }
  return $null
}

function Set-LocalDbEnv {
  $rootEnv = Join-Path $Root '.env'
  $backendEnv = Join-Path $Backend '.env'
  $dbUser = Read-DotEnvValue $rootEnv 'DB_USER'
  if (-not $dbUser) { $dbUser = Read-DotEnvValue $backendEnv 'DB_USER' }
  if (-not $dbUser) { $dbUser = 'klip_user' }
  $dbPassword = Read-DotEnvValue $rootEnv 'DB_PASSWORD'
  if (-not $dbPassword) { $dbPassword = Read-DotEnvValue $backendEnv 'DB_PASSWORD' }
  $dbName = Read-DotEnvValue $rootEnv 'DB_NAME'
  if (-not $dbName) { $dbName = 'klip_db' }
  $postgresPort = Read-DotEnvValue $rootEnv 'POSTGRES_PORT'
  if (-not $postgresPort) { $postgresPort = '5433' }

  $env:DB_HOST = '127.0.0.1'
  $env:DB_PORT = $postgresPort
  $env:DB_NAME = $dbName
  $env:DB_USER = $dbUser
  $env:DB_PASSWORD = $dbPassword
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error 'docker not found. Start local stack first (docker compose up -d postgres).'
}

$postgresRunning = docker ps --format '{{.Names}}' | Select-String -Pattern '^klip-postgres$' -Quiet
if (-not $postgresRunning) {
  Write-Error 'klip-postgres container is not running. Run: docker compose up -d postgres'
}

if (-not $ApplyOnly) {
  if (-not (Test-Path $Plink)) {
    Write-Error "plink.exe not found at $Plink. Install PuTTY or pass -Plink."
  }

  $keyArg = @()
  if (Test-Path $Key) {
    $keyArg = @('-i', $Key)
  } else {
    Write-Warning "SSH key not found at $Key - plink will use agent or prompt."
  }

  if (-not (Test-Path $TmpDir)) {
    New-Item -ItemType Directory -Path $TmpDir | Out-Null
  }

  if (-not $CsvPath) {
    $CsvPath = Join-Path $TmpDir ("master-plant-group-staging-{0}.csv" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  }

  $sql = 'SELECT company_name, plant_code, TRIM(group_plant) AS group_plant FROM master_plants WHERE group_plant IS NOT NULL AND LENGTH(TRIM(group_plant)) > 0 ORDER BY company_name, plant_code'
  $remoteCmd = "cd /opt/klip; docker compose -f docker-compose.backend.yml exec -T postgres psql -U postgres -d klip_db --csv -c `"$sql`""

  Write-Host "=== Export group_plant from staging ($StagingHost) ===" -ForegroundColor Cyan
  Write-Host "Writing: $CsvPath"

  $csvContent = & $Plink -batch @keyArg "${User}@${StagingHost}" $remoteCmd
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Staging export failed (exit $LASTEXITCODE). See docs/scripts/staging-deploy-putty.txt - connect to $StagingHost and run docs/scripts/export-master-plant-group-staging.sh manually, then use -ApplyOnly -CsvPath with your CSV file."
  }

  if (-not $csvContent -or $csvContent.Trim().Length -eq 0) {
    Write-Error 'Staging export returned empty CSV.'
  }

  Set-Content -Path $CsvPath -Value $csvContent -Encoding utf8
  $lineCount = ($csvContent -split "`n" | Where-Object { $_.Trim().Length -gt 0 }).Count
  Write-Host "Exported $lineCount lines (incl. header)." -ForegroundColor Green
}

if (-not $CsvPath -or -not (Test-Path $CsvPath)) {
  Write-Error 'CSV not found. Pass -CsvPath or run export without -ApplyOnly.'
}

Set-LocalDbEnv
Push-Location $Backend
try {
  $confirmFlag = if ($Apply) { '--confirm' } else { '' }
  Write-Host ""
  Write-Host "=== Apply to local DB ($(if ($Apply) { 'APPLY' } else { 'PREVIEW' })) ===" -ForegroundColor Cyan
  npm run sync:master-plant-group-from-file -- --file $CsvPath $confirmFlag
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Local apply failed (exit $LASTEXITCODE)."
  }
} finally {
  Pop-Location
}

if (-not $Apply) {
  Write-Host ""
  Write-Host "Preview done. CSV saved at: $CsvPath" -ForegroundColor Yellow
  Write-Host "To apply locally:"
  Write-Host "  .\scripts\sync-master-plant-group-from-staging.ps1 -ApplyOnly -CsvPath `"$CsvPath`" -Apply"
}
