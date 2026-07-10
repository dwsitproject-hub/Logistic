# KLIP — Rebuild local Docker stack (dev machine only, NOT SIT)
# Usage:
#   .\scripts\deploy-local.ps1              # both
#   .\scripts\deploy-local.ps1 -Target frontend
#   .\scripts\deploy-local.ps1 -Target backend

param(
  [ValidateSet('all', 'frontend', 'backend')]
  [string]$Target = 'all'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot

Write-Host "KLIP local deploy (target: $Target)" -ForegroundColor Cyan
Write-Host "Repo: $RepoRoot"

function Invoke-Compose {
  param([string[]]$Services)
  docker compose up -d --build @Services
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed" }
}

switch ($Target) {
  'backend' {
    Invoke-Compose @('backend')
    docker compose ps backend
    try {
      $r = Invoke-WebRequest -Uri 'http://localhost:5001/health' -UseBasicParsing -TimeoutSec 15
      Write-Host "Backend health: $($r.StatusCode)" -ForegroundColor Green
    } catch {
      Write-Host "Backend health check failed (container may still be starting)" -ForegroundColor Yellow
    }
  }
  'frontend' {
    Invoke-Compose @('frontend')
    docker compose ps frontend
    Write-Host "Frontend: http://localhost:3001" -ForegroundColor Green
  }
  default {
    Invoke-Compose @('backend', 'frontend')
    docker compose ps backend frontend
    Write-Host "Frontend: http://localhost:3001" -ForegroundColor Green
    Write-Host "Backend:  http://localhost:5001/api" -ForegroundColor Green
  }
}

Write-Host "Done. Hard refresh browser (Ctrl+Shift+R) after UI changes." -ForegroundColor Green
