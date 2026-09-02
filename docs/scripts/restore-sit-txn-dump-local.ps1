# Restore SIT transactional dump into local Docker Postgres (klip-postgres).
# Handles pg_dump custom format newer than local PG 14 by converting via postgres:16.
#
# Prerequisites:
#   Copy dump to docs\, e.g. klip_sit_txn_YYYYMMDD_HHMMSS.dump
#
# Usage (repo root):
#   powershell -NoProfile -File docs\scripts\restore-sit-txn-dump-local.ps1
#   powershell -NoProfile -File docs\scripts\restore-sit-txn-dump-local.ps1 -DumpPath "D:\Project\Klip\docs\klip_sit_txn_20260723_112902.dump"
#
param(
  [string]$DumpPath = "",
  [string]$Container = "klip-postgres",
  [string]$DbName = "klip_db",
  [string]$DbUser = "klip_user",
  [string]$SuperUser = "postgres",
  [string]$PgClientImage = "postgres:16-alpine"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $RepoRoot

if (-not $DumpPath) {
  $candidate = Get-ChildItem (Join-Path $RepoRoot "docs") -Filter "klip_sit_txn_*.dump" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $candidate) {
    throw "No klip_sit_txn_*.dump in docs\. Copy from SIT first."
  }
  $DumpPath = $candidate.FullName
}

if (-not (Test-Path $DumpPath)) {
  throw "Dump not found: $DumpPath"
}

$running = docker ps --format "{{.Names}}" | Where-Object { $_ -eq $Container }
if (-not $running) {
  throw "Container $Container is not running. Start local postgres first."
}

$detectedSuper = docker exec $Container printenv POSTGRES_USER 2>$null
if ($detectedSuper) {
  $SuperUser = $detectedSuper.Trim()
}

$truncUser = $SuperUser

$dumpName = Split-Path $DumpPath -Leaf
$sqlName = "_klip_sit_txn_restore.sql"
$sqlHost = Join-Path $RepoRoot "docs\$sqlName"
$docsMount = (Join-Path $RepoRoot "docs") -replace "\\", "/"

Write-Host "=== List tables in dump (via $PgClientImage) ==="
$toc = docker run --rm -v "${docsMount}:/dump" $PgClientImage pg_restore -l "/dump/$dumpName"
$tables = @()
foreach ($line in $toc) {
  if ($line -match 'TABLE DATA public (\S+)') {
    $tables += $Matches[1]
  }
}
$tables = $tables | Sort-Object -Unique
if ($tables.Count -eq 0) {
  throw "No TABLE DATA entries found in dump TOC."
}
Write-Host "Tables to replace ($($tables.Count)):"
$tables | ForEach-Object { Write-Host "  $_" }

$truncSql = "TRUNCATE TABLE " + (($tables | ForEach-Object { "public.$_" }) -join ", ") + " RESTART IDENTITY CASCADE;"
Write-Host "=== Truncate local transactional tables ==="
docker exec -i $Container psql -U $truncUser -d $DbName -v ON_ERROR_STOP=1 -c $truncSql

Write-Host "=== Convert custom dump -> plain SQL (PG16 client; strips format mismatch) ==="
if (Test-Path $sqlHost) { Remove-Item $sqlHost -Force }
docker run --rm -v "${docsMount}:/dump" $PgClientImage `
  pg_restore --data-only --no-owner --no-acl -f "/dump/$sqlName" "/dump/$dumpName"

# PG16 emits \restrict / \unrestrict that older psql may reject — strip them.
$sqlText = Get-Content -Path $sqlHost -Raw
$sqlText = [regex]::Replace($sqlText, '(?m)^\\restrict .+\r?\n', '')
$sqlText = [regex]::Replace($sqlText, '(?m)^\\unrestrict .+\r?\n', '')

# SIT rows reference users(id) that do not exist locally — bypass FK checks during import.
$wrappedSql = @"
BEGIN;
SET session_replication_role = replica;
$sqlText
SET session_replication_role = DEFAULT;
COMMIT;
"@
Set-Content -Path $sqlHost -Value $wrappedSql -NoNewline -Encoding utf8

Write-Host "=== Copy SQL into $Container and restore (superuser=$SuperUser, FK checks off) ==="
docker cp $sqlHost "${Container}:/tmp/$sqlName"
docker exec $Container psql -U $SuperUser -d $DbName -v ON_ERROR_STOP=1 -f "/tmp/$sqlName"

Write-Host "=== Spot-check row counts ==="
$countSql = ($tables | ForEach-Object {
  "SELECT '$_' AS tbl, COUNT(*)::bigint AS n FROM public.$_"
}) -join "`nUNION ALL`n"
docker exec -i $Container psql -U $DbUser -d $DbName -c "$countSql ORDER BY tbl;"

docker exec $Container rm -f "/tmp/$sqlName" | Out-Null
Remove-Item $sqlHost -Force -ErrorAction SilentlyContinue
Write-Host "Done. Restart backend if needed: docker compose restart backend"
Write-Host "UI: http://localhost:3001  API: http://localhost:5001/health"
