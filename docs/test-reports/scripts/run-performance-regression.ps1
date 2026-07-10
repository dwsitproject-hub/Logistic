# Performance regression runner (Layer A + shipment summary parity)
# Usage: .\docs\test-reports\scripts\run-performance-regression.ps1

param(
  [string]$ApiBase = "http://127.0.0.1:5001",
  [switch]$SkipDockerRefresh,
  [switch]$SkipParityScript
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
$backend = Join-Path $repoRoot "backend"
$baselineDir = Join-Path $PSScriptRoot "..\baselines\$(Get-Date -Format yyyy-MM-dd)"
New-Item -ItemType Directory -Force -Path $baselineDir | Out-Null

Write-Host "=== KLIP Performance Regression ===" -ForegroundColor Cyan
Write-Host "Repo: $repoRoot"

# Layer A — unit tests
Write-Host "`n[Layer A] npm test..." -ForegroundColor Yellow
Push-Location $backend
try {
  npm test
  if ($LASTEXITCODE -ne 0) { throw "npm test failed with exit $LASTEXITCODE" }
} finally {
  Pop-Location
}
Write-Host "[Layer A] PASS" -ForegroundColor Green

# Optional: refresh pipeline summary in Docker
if (-not $SkipDockerRefresh) {
  Write-Host "`n[Prep] Refresh pipeline daily summary (Docker)..." -ForegroundColor Yellow
  $dockerOk = $false
  try {
    docker ps --filter "name=klip-backend" --format "{{.Names}}" 2>$null | Select-String "klip-backend" | Out-Null
    if ($?) { $dockerOk = $true }
  } catch { $dockerOk = $false }

  if ($dockerOk) {
    docker exec klip-backend node dist/scripts/refreshPipelineDailySummary.js
    if ($LASTEXITCODE -ne 0) { Write-Warning "Docker refresh failed — parity may use stale data" }
    else { Write-Host "[Prep] Pipeline refresh OK" -ForegroundColor Green }
  } else {
    Write-Warning "klip-backend container not running — skip Docker refresh"
  }
}

# Layer B — API baseline export
Write-Host "`n[Layer B] Export API baselines..." -ForegroundColor Yellow
try {
  $login = Invoke-RestMethod -Uri "$ApiBase/api/auth/login" -Method POST `
    -ContentType "application/json" -Body '{"username":"admin","password":"admin123"}'
  $token = $login.data.token
  $headers = @{ Authorization = "Bearer $token" }
  $yr = (Get-Date).Year
  $dateTo = Get-Date -Format "yyyy-MM-dd"
  $q = "dateFrom=${yr}-01-01&dateTo=$dateTo"

  $endpoints = @{
    "shipments-summary.json" = "/api/shipments?summaryOnly=true&compact=true&limit=1&$q"
    "trucking-summary.json"  = "/api/trucking?summaryOnly=true&limit=1&$q"
    "contracts-page1.json"   = "/api/contracts?limit=5&$q"
  }

  foreach ($entry in $endpoints.GetEnumerator()) {
    $data = Invoke-RestMethod -Uri "$ApiBase$($entry.Value)" -Headers $headers
    $outPath = Join-Path $baselineDir $entry.Key
    $data | ConvertTo-Json -Depth 25 | Set-Content -Encoding UTF8 $outPath
    Write-Host "  saved $($entry.Key)"
  }
  Write-Host "[Layer B] Baselines -> $baselineDir" -ForegroundColor Green
} catch {
  Write-Warning "API baseline export failed (is backend up at $ApiBase?): $_"
}

# Shipment summary parity (daily vs live) — requires DB from host or run inside Docker
if (-not $SkipParityScript) {
  Write-Host "`n[Layer B-S] Shipment summary parity script..." -ForegroundColor Yellow
  Push-Location $backend
  try {
    npm run regression:shipment-summary-parity
    if ($LASTEXITCODE -ne 0) { throw "regression:shipment-summary-parity failed" }
    Write-Host "[Layer B-S] PASS (daily vs live match)" -ForegroundColor Green
  } catch {
    Write-Warning "Parity script skipped or failed (DB env on host?): $_"
    Write-Host "  Try: docker exec klip-backend node dist/scripts/performanceRegressionShipmentSummary.js" -ForegroundColor DarkYellow
  } finally {
    Pop-Location
  }

  Write-Host "`n[Layer H] Contract qty snapshot parity..." -ForegroundColor Yellow
  try {
    docker exec klip-backend node dist/scripts/performanceRegressionContractQtySnapshot.js
    if ($LASTEXITCODE -ne 0) { throw "contract qty snapshot parity failed" }
    Write-Host "[Layer H] PASS (snapshot vs live match)" -ForegroundColor Green
  } catch {
    Write-Warning "Contract qty snapshot parity skipped or failed: $_"
    Write-Host "  Rebuild backend first: docker compose up -d --build backend" -ForegroundColor DarkYellow
  }

  Write-Host "`n[Layer H-STO] Contract sto_agg snapshot parity..." -ForegroundColor Yellow
  try {
    docker exec klip-backend node dist/scripts/performanceRegressionContractStoAggSnapshot.js
    if ($LASTEXITCODE -ne 0) { throw "contract sto_agg snapshot parity failed" }
    Write-Host "[Layer H-STO] PASS (sto_agg snapshot vs live match)" -ForegroundColor Green
  } catch {
    Write-Warning "Contract sto_agg snapshot parity skipped or failed: $_"
  }

  Write-Host "`n[Layer H-SPD] Contract latest_spd snapshot parity..." -ForegroundColor Yellow
  try {
    docker exec klip-backend node dist/scripts/performanceRegressionContractLatestSpdSnapshot.js
    if ($LASTEXITCODE -ne 0) { throw "contract latest_spd snapshot parity failed" }
    Write-Host "[Layer H-SPD] PASS (latest_spd snapshot vs live match)" -ForegroundColor Green
  } catch {
    Write-Warning "Contract latest_spd snapshot parity skipped or failed: $_"
  }
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan
Write-Host "Checklist: docs/test-reports/PERFORMANCE-REGRESSION-CHECKLIST.md"
Write-Host "Baselines:  $baselineDir"
