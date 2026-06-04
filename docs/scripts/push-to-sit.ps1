# KLIP — Commit & push ke branch SIT (jalankan di mesin dev yang punya Git + remote)
# Usage (PowerShell):
#   cd D:\Project\Klip
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   .\docs\scripts\push-to-sit.ps1
#
# Optional:
#   .\docs\scripts\push-to-sit.ps1 -Message "custom commit message"
#   .\docs\scripts\push-to-sit.ps1 -SkipCommit   # hanya push (sudah commit)

param(
  [string]$Message = "feat(shipping-perf): summary cards, vessel history modal, table UI, status partition",
  [switch]$SkipCommit,
  [string]$Branch = "SIT"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Find-Git {
  $cmd = Get-Command git -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe",
    "C:\Program Files\Git\cmd\git.exe",
    "C:\Program Files\Git\bin\git.exe"
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

$git = Find-Git
if (-not $git) {
  Write-Host "ERROR: git tidak ditemukan. Install Git for Windows: https://git-scm.com/download/win" -ForegroundColor Red
  exit 1
}

Set-Location $RepoRoot
Write-Host "Repo: $RepoRoot" -ForegroundColor Cyan
Write-Host "Git:  $git" -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
  Write-Host "ERROR: Folder .git tidak ada di $RepoRoot" -ForegroundColor Red
  Write-Host "Clone repo KLIP ke path ini, atau jalankan script dari folder clone yang benar." -ForegroundColor Yellow
  exit 1
}

function Invoke-Git {
  param([string[]]$Args)
  & $git -C $RepoRoot @Args
  if ($LASTEXITCODE -ne 0) { throw "git $($Args -join ' ') failed (exit $LASTEXITCODE)" }
}

Invoke-Git @("fetch", "origin")
Invoke-Git @("checkout", $Branch)
Invoke-Git @("pull", "origin", $Branch)

$status = & $git -C $RepoRoot status --porcelain
if ($status) {
  Write-Host "`nPerubahan yang akan di-commit:" -ForegroundColor Yellow
  & $git -C $RepoRoot status --short
}

if (-not $SkipCommit) {
  if (-not $status) {
    Write-Host "`nTidak ada perubahan lokal — lanjut push saja." -ForegroundColor Green
  } else {
    # Stage contract-perf + deploy doc (aman: .env sudah di .gitignore)
    $paths = @(
      "backend/src/services/latePerformance.service.ts",
      "backend/src/services/latePerformance.deliveryEnd.test.ts",
      "backend/src/controllers/contract.controller.ts",
      "backend/src/controllers/contractsListOuterSql.ts",
      "frontend/src/lib/contractPerformanceFilters.ts",
      "frontend/src/lib/contractPerformanceFilters.test.ts",
      "frontend/src/hooks/useContractPerformanceFilters.ts",
      "frontend/src/app/contracts/page.tsx",
      "frontend/src/lib/fieldHelpText.ts",
      "docs/scripts/staging-deploy-putty.txt",
      "docs/scripts/push-to-sit.ps1"
    )
    foreach ($p in $paths) {
      $full = Join-Path $RepoRoot $p
      if (Test-Path $full) {
        Invoke-Git @("add", $p)
      }
    }
    # File lain yang ikut berubah (mis. merge tree helpers)
    Invoke-Git @("add", "-u", "backend/src", "frontend/src", "docs/scripts")
    $remaining = & $git -C $RepoRoot status --porcelain
    if ($remaining) {
      Write-Host "`nFile lain masih unstaged — tambahkan semua perubahan source? (y/n)" -ForegroundColor Yellow
      $ans = Read-Host
      if ($ans -eq "y" -or $ans -eq "Y") {
        Invoke-Git @("add", "backend/src", "frontend/src", "docs/scripts")
      }
    }
    Invoke-Git @("commit", "-m", $Message)
    Write-Host "`nCommit OK." -ForegroundColor Green
  }
}

Write-Host "`nPush origin/$Branch ..." -ForegroundColor Cyan
Invoke-Git @("push", "origin", $Branch)
Write-Host "`nSelesai. Deploy manual: docs/scripts/staging-deploy-putty.txt (STEP 2)" -ForegroundColor Green
