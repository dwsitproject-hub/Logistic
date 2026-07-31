<#
.SYNOPSIS
  Export PostgreSQL from SIT/testing backend server and restore into local Docker dev DB.

.DESCRIPTION
  Connects to the backend server (default 172.28.92.57), runs pg_dump inside klip-postgres,
  saves a .sql file locally, then restores into klip-postgres-dev (docker-compose.dev.yml).

  Requires SSH access to the backend server (VPN + PuTTY key or OpenSSH key).

.EXAMPLE
  .\scripts\import-sit-db-to-local.ps1 -SshKey "C:\Users\you\.ssh\sit-backend.ppk"

.EXAMPLE
  .\scripts\import-sit-db-to-local.ps1 -SshKey "C:\Users\you\.ssh\id_ed25519" -UsePlink:$false

.EXAMPLE
  # Re-import an existing dump without contacting the server
  .\scripts\import-sit-db-to-local.ps1 -DumpFileOnly ".\backups\sit_klip_db_20260630.sql"
#>

param(
  [string] $RemoteHost = "172.28.92.57",
  [string] $RemoteUser = "ubuntu",
  [string] $RemoteRepo = "/opt/klip",
  [string] $RemoteComposeFile = "docker-compose.backend.yml",
  [string] $RemoteDbName = "klip_db",
  [string] $RemoteDbUser = "postgres",
  [string] $LocalContainer = "klip-postgres",
  [string] $LocalComposeFile = "docker-compose.yml",
  [string] $LocalDbName = "klip_db",
  [string] $LocalDbUser = "postgres",
  [string] $SshKey = "",
  [bool] $UsePlink = $true,
  [string] $DumpFile = "",
  [string] $DumpFileOnly = "",
  [switch] $SkipLocalBackup,
  [switch] $KeepBackendRunning
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

$BackupDir = Join-Path $RepoRoot "backups"
if (-not (Test-Path $BackupDir)) {
  New-Item -ItemType Directory -Path $BackupDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
if (-not $DumpFile) {
  $DumpFile = Join-Path $BackupDir "sit_${RemoteDbName}_${timestamp}.sql"
}

function Assert-ContainerRunning {
  param([string] $Name)
  $running = docker ps --filter "name=^${Name}$" --format "{{.Names}}"
  if (-not $running) {
    throw "Container '$Name' is not running. Start local stack: docker compose -f docker-compose.dev.yml up -d"
  }
}

function Invoke-RemoteDump {
  $remoteCmd = "set -e && cd '$RemoteRepo' && docker compose -f '$RemoteComposeFile' exec -T postgres pg_dump -U '$RemoteDbUser' -d '$RemoteDbName' --no-owner --no-acl --clean --if-exists"

  Write-Host "Exporting from ${RemoteUser}@${RemoteHost} ..." -ForegroundColor Cyan

  if ($UsePlink) {
    $plink = "C:\Program Files\PuTTY\plink.exe"
    if (-not (Test-Path $plink)) {
      throw "PuTTY plink not found at $plink. Install PuTTY or use -UsePlink:`$false with an OpenSSH key."
    }
    if (-not $SshKey) {
      throw "Provide -SshKey path to your .ppk file for PuTTY."
    }
    if (-not (Test-Path $SshKey)) {
      throw "SSH key not found: $SshKey"
    }
    & $plink -batch -i $SshKey "${RemoteUser}@${RemoteHost}" $remoteCmd | Set-Content -Path $DumpFile -Encoding utf8
  } else {
    if ($SshKey) {
      if (-not (Test-Path $SshKey)) { throw "SSH key not found: $SshKey" }
      ssh -i $SshKey -o BatchMode=yes "${RemoteUser}@${RemoteHost}" $remoteCmd | Set-Content -Path $DumpFile -Encoding utf8
    } else {
      ssh -o BatchMode=yes "${RemoteUser}@${RemoteHost}" $remoteCmd | Set-Content -Path $DumpFile -Encoding utf8
    }
  }

  if (-not (Test-Path $DumpFile) -or (Get-Item $DumpFile).Length -lt 1024) {
    throw "Dump file is missing or too small. Check SSH/VPN access and DB credentials on the server."
  }

  Write-Host "Saved remote dump: $DumpFile ($('{0:N0}' -f (Get-Item $DumpFile).Length) bytes)" -ForegroundColor Green
}

function Backup-LocalDatabase {
  $localBackup = Join-Path $BackupDir "local_${LocalDbName}_before_sit_${timestamp}.sql"
  Write-Host "Backing up local DB to $localBackup ..." -ForegroundColor Yellow
  docker exec $LocalContainer pg_dump -U $LocalDbUser -d $LocalDbName --no-owner --no-acl | Set-Content -Path $localBackup -Encoding utf8
  Write-Host "Local backup saved." -ForegroundColor Green
}

function Restore-LocalDatabase {
  param([string] $SqlPath)

  Write-Host "Restoring into $LocalContainer / $LocalDbName ..." -ForegroundColor Cyan
  Write-Host "This replaces existing data in the local database." -ForegroundColor Yellow

  if (-not $KeepBackendRunning) {
    Write-Host "Stopping backend container to avoid active connections ..." -ForegroundColor Yellow
    docker compose -f $LocalComposeFile stop backend 2>$null | Out-Null
  }

  # psql via stdin; ON_ERROR_STOP=0 because --clean may emit harmless errors on empty objects
  Get-Content -Raw $SqlPath | docker exec -i $LocalContainer psql -U $LocalDbUser -d $LocalDbName -v ON_ERROR_STOP=0 -q

  # A restored dump carries NO planner statistics: pg_stat_user_tables.last_analyze is NULL
  # and every query plan is chosen blind. Measured 2026-07-27: the shipments list query took
  # 225s before ANALYZE and 34s after. Never skip this.
  Write-Host "Running ANALYZE (required - a restored dump has no statistics) ..." -ForegroundColor Yellow
  docker exec $LocalContainer psql -U $LocalDbUser -d $LocalDbName -q -c "ANALYZE;" | Out-Null

  if (-not $KeepBackendRunning) {
    Write-Host "Starting backend ..." -ForegroundColor Yellow
    docker compose -f $LocalComposeFile start backend | Out-Null
  }

  $contracts = docker exec $LocalContainer psql -U $LocalDbUser -d $LocalDbName -t -A -c "SELECT COUNT(*) FROM contracts;" 2>$null
  $shipments = docker exec $LocalContainer psql -U $LocalDbUser -d $LocalDbName -t -A -c "SELECT COUNT(*) FROM shipments;" 2>$null
  $analyzed = docker exec $LocalContainer psql -U $LocalDbUser -d $LocalDbName -t -A -c "SELECT COUNT(*) FROM pg_stat_user_tables WHERE last_analyze IS NOT NULL;" 2>$null
  Write-Host "Restore complete. contracts=$contracts shipments=$shipments analyzed_tables=$analyzed" -ForegroundColor Green
}

Write-Host "KLIP - import SIT/testing DB to local" -ForegroundColor Cyan
Assert-ContainerRunning -Name $LocalContainer

if ($DumpFileOnly) {
  if (-not (Test-Path $DumpFileOnly)) { throw "Dump file not found: $DumpFileOnly" }
  $DumpFile = (Resolve-Path $DumpFileOnly).Path
  Write-Host "Using existing dump: $DumpFile" -ForegroundColor Yellow
} else {
  Invoke-RemoteDump
}

if (-not $SkipLocalBackup) {
  Backup-LocalDatabase
}

Restore-LocalDatabase -SqlPath $DumpFile

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Dump file : $DumpFile"
Write-Host "  Frontend  : http://localhost:3001"
Write-Host "  Backend   : http://localhost:5001/health"
Write-Host "  Hard refresh browser (Ctrl+Shift+R) after login."
