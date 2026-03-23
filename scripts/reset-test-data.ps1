<#
.SYNOPSIS
  Runs scripts/reset-test-data.sql against PostgreSQL (local or Docker).

.EXAMPLE
  .\scripts\reset-test-data.ps1
  .\scripts\reset-test-data.ps1 -DockerContainer klip-postgres-dev -Database klip_db
  .\scripts\reset-test-data.ps1 -DbHost localhost -Port 5433 -Database klip_db -User postgres -Password postgres123
#>

param(
  [string] $DockerContainer = "klip-postgres-dev",
  [string] $DbHost = "localhost",
  [int] $Port = 5433,
  [string] $Database = "klip_db",
  [string] $User = "postgres",
  [string] $Password = "postgres123",
  # Default: run SQL inside Docker postgres (set to $false to use local psql)
  [bool] $UseDocker = $true
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$sqlPath = Join-Path $root "scripts\reset-test-data.sql"

if (-not (Test-Path $sqlPath)) {
  throw "SQL file not found: $sqlPath"
}

Write-Host "KLIP reset-test-data" -ForegroundColor Cyan
Write-Host "SQL file: $sqlPath"

if ($UseDocker) {
  Write-Host "Using Docker container: $DockerContainer" -ForegroundColor Yellow
  $exists = docker ps --filter "name=$DockerContainer" --format "{{.Names}}"
  if (-not $exists) {
    throw "Container '$DockerContainer' is not running. Start it (e.g. docker compose -f docker-compose.dev.yml up -d postgres) or use -UseDocker:`$false with -DbHost/-Port."
  }
  Get-Content -Raw $sqlPath | docker exec -i $DockerContainer psql -U $User -d $Database -v ON_ERROR_STOP=1
} else {
  Write-Host "Using TCP: ${User}@${DbHost}:${Port}/${Database}" -ForegroundColor Yellow
  $env:PGPASSWORD = $Password
  try {
    psql -h $DbHost -p $Port -U $User -d $Database -v ON_ERROR_STOP=1 -f $sqlPath
  } finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

Write-Host "Done." -ForegroundColor Green
