# KLIP — deploy branch SIT dari laptop Windows ke dua host.
# Backend dulu (172.28.92.57), lalu frontend (172.28.92.56).
# Di server yang dijalankan adalah docs/scripts/deploy-sit.sh (overlay remote DB + cek NEXT_PUBLIC).
#
# Prasyarat: git push origin SIT sudah selesai, PuTTY session tersimpan dengan nama IP host
# (proxy / Pageant / host key ikut session itu).
#
#   cd D:\Project\Klip
#   powershell -ExecutionPolicy Bypass -File docs\scripts\deploy-sit-from-windows.ps1
#   powershell -ExecutionPolicy Bypass -File docs\scripts\deploy-sit-from-windows.ps1 -Target backend
#   powershell -ExecutionPolicy Bypass -File docs\scripts\deploy-sit-from-windows.ps1 -Target frontend
#   powershell -ExecutionPolicy Bypass -File docs\scripts\deploy-sit-from-windows.ps1 -Yes
#
# Migrasi 195–197 ikut jalan saat backend boot: menghapus lalu mengisi ulang
# master_plants dan master_loading_ports di database SIT.

param(
  [ValidateSet("all", "backend", "frontend")]
  [string]$Target = "all",
  [switch]$Yes,
  [string]$Plink = "",
  [string]$User = "ubuntu",
  [string]$BackendHost = "172.28.92.57",
  [string]$FrontendHost = "172.28.92.56",
  [string]$Branch = "SIT",
  [string]$AppDir = "/opt/klip"
)

$ErrorActionPreference = "Stop"

function Find-Plink {
  param([string]$Explicit)
  if ($Explicit -and (Test-Path $Explicit)) { return (Resolve-Path $Explicit).Path }
  $cmd = Get-Command plink.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "C:\Program Files\PuTTY\plink.exe",
    "C:\Program Files (x86)\PuTTY\plink.exe"
  )
  foreach ($path in $candidates) {
    if (Test-Path $path) { return $path }
  }
  return $null
}

function Invoke-SitDeploy {
  param(
    [string]$PlinkPath,
    [string]$SessionHost,
    [string]$Role
  )
  $remote = "cd $AppDir && git fetch origin $Branch && git checkout $Branch && git pull --ff-only origin $Branch && bash docs/scripts/deploy-sit.sh $Role"
  Write-Host ""
  Write-Host "========================================" -ForegroundColor Cyan
  Write-Host "SIT $Role  $User@$SessionHost" -ForegroundColor Cyan
  Write-Host "========================================" -ForegroundColor Cyan
  Write-Host $remote
  & $PlinkPath -batch -load $SessionHost "${User}@${SessionHost}" $remote
  if ($LASTEXITCODE -ne 0) {
    throw "Deploy $Role di $SessionHost gagal (exit $LASTEXITCODE)."
  }
}

$plinkPath = Find-Plink -Explicit $Plink
if (-not $plinkPath) {
  Write-Host "ERROR: plink.exe tidak ditemukan. Install PuTTY, atau jalankan dengan -Plink `"C:\path\to\plink.exe`"." -ForegroundColor Red
  exit 1
}

$steps = @()
if ($Target -eq "all" -or $Target -eq "backend") {
  $steps += @{ Host = $BackendHost; Role = "backend" }
}
if ($Target -eq "all" -or $Target -eq "frontend") {
  $steps += @{ Host = $FrontendHost; Role = "frontend" }
}

Write-Host "KLIP deploy SIT" -ForegroundColor Cyan
Write-Host "  plink    : $plinkPath"
Write-Host "  branch   : $Branch"
Write-Host "  target   : $Target"
$order = ($steps | ForEach-Object { "$($_.Role) $($_.Host)" }) -join " lalu "
Write-Host "  urutan   : $order"
Write-Host ""
Write-Host "Backend boot akan menjalankan migrasi baru, termasuk 195-197:" -ForegroundColor Yellow
Write-Host "  master_plants dan master_loading_ports di database SIT dihapus lalu diisi ulang dari workbook CPO." -ForegroundColor Yellow
Write-Host "Aplikasi: http://8.215.6.189" -ForegroundColor Yellow

if (-not $Yes) {
  $answer = Read-Host "Lanjut deploy? ketik ya"
  if ($answer -ne "ya") {
    Write-Host "Dibatalkan."
    exit 0
  }
}

foreach ($step in $steps) {
  Invoke-SitDeploy -PlinkPath $plinkPath -SessionHost $step.Host -Role $step.Role
}

Write-Host ""
Write-Host "Selesai. Buka http://8.215.6.189 dan hard refresh (Ctrl+Shift+R)." -ForegroundColor Green
