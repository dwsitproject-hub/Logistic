# Export master_vessels + master_vessel_code_aliases from local Docker Postgres.
# Usage (repo root):
#   .\docs\scripts\export-master-vessel-local.ps1
# Output: tmp/master_vessel_local_to_sit.sql (+ row counts)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$OutDir = Join-Path $RepoRoot "tmp"
$OutFile = Join-Path $OutDir "master_vessel_local_to_sit.sql"

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$container = "klip-postgres"
$running = docker ps --format "{{.Names}}" | Select-String -Pattern "^${container}$"
if (-not $running) {
  Write-Error "Container $container is not running. Start local Docker first."
}

$counts = docker exec $container psql -U klip_user -d klip_db -t -A -c @"
SELECT 'master_vessels=' || COUNT(*)::text FROM master_vessels
UNION ALL
SELECT 'master_vessel_code_aliases=' || COUNT(*)::text FROM master_vessel_code_aliases;
"@

Write-Host "Local counts: $($counts -join ', ')" -ForegroundColor Cyan

docker exec $container pg_dump -U klip_user -d klip_db `
  --data-only `
  --inserts `
  --table=public.master_vessels `
  --table=public.master_vessel_code_aliases `
  | Set-Content -Path $OutFile -Encoding utf8

Write-Host "Exported: $OutFile" -ForegroundColor Green
Write-Host "Copy to SIT backend (.57), then:"
Write-Host "  bash docs/scripts/sync-master-vessel-staging.sh --file /opt/klip/tmp/master_vessel_local_to_sit.sql --apply"
