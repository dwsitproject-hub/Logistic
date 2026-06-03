# =============================================================================
# KLIP - Local Setup Script (Windows PowerShell)
# Jalankan: .\setup-local.ps1
# Jika blocked: Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
# =============================================================================

$ErrorActionPreference = "Stop"

function Info  { param($msg) Write-Host "[INFO] $msg" -ForegroundColor Green }
function Warn  { param($msg) Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Err   { param($msg) Write-Host "[ERROR] $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "   KLIP - Local Setup (Windows)"             -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# -----------------------------------------------------------------------------
# 1. Check Node.js
# -----------------------------------------------------------------------------
Info "Mengecek Node.js..."
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Err "Node.js tidak ditemukan. Install dari https://nodejs.org (v18+) lalu jalankan ulang script ini."
}
$nodeVer = node --version
Info "Node.js: $nodeVer"

# -----------------------------------------------------------------------------
# 2. Check PostgreSQL
# -----------------------------------------------------------------------------
Info "Mengecek PostgreSQL..."
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    Warn "psql tidak ditemukan di PATH."
    Write-Host ""
    Write-Host "  Install PostgreSQL dari: https://www.postgresql.org/download/windows/" -ForegroundColor Yellow
    Write-Host "  Centang 'Add to PATH' saat instalasi, lalu restart PowerShell ini." -ForegroundColor Yellow
    Write-Host ""
    $cont = Read-Host "Sudah install PostgreSQL dan ingin lanjut? (y/N)"
    if ($cont -notmatch "^[Yy]$") { Err "Setup dibatalkan." }
}

# -----------------------------------------------------------------------------
# 3. Setup .env backend
# -----------------------------------------------------------------------------
Info "Setup file backend\.env ..."
if (-not (Test-Path "backend\.env")) {
    Copy-Item "backend\.env.example" "backend\.env"
    Info "File backend\.env dibuat dari .env.example"
    Write-Host ""
    Warn "Pastikan kredensial database di backend\.env sudah benar."
    Write-Host "  Default: DB_USER=klip  DB_PASSWORD=klip123  DB_NAME=klip_db" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Tekan Enter setelah edit backend\.env (atau Enter untuk pakai default)"
} else {
    Info "backend\.env sudah ada, dilewati."
}

# -----------------------------------------------------------------------------
# 4. Setup .env frontend
# -----------------------------------------------------------------------------
Info "Setup file frontend\.env.local ..."
if (-not (Test-Path "frontend\.env.local")) {
    "NEXT_PUBLIC_API_URL=http://localhost:5001/api" | Out-File -FilePath "frontend\.env.local" -Encoding utf8
    Info "File frontend\.env.local dibuat."
} else {
    Info "frontend\.env.local sudah ada, dilewati."
}

# -----------------------------------------------------------------------------
# 5. Buat database & user PostgreSQL
# -----------------------------------------------------------------------------
Info "Mencoba membuat PostgreSQL user & database..."

$envContent = Get-Content "backend\.env"
$dbUser = ($envContent | Where-Object { $_ -match "^DB_USER=" }) -replace "DB_USER=", ""
$dbPass = ($envContent | Where-Object { $_ -match "^DB_PASSWORD=" }) -replace "DB_PASSWORD=", ""
$dbName = ($envContent | Where-Object { $_ -match "^DB_NAME=" }) -replace "DB_NAME=", ""

$env:PGPASSWORD = "postgres"
psql -U postgres -c "CREATE USER $dbUser WITH PASSWORD '$dbPass' CREATEDB;" 2>$null
if ($LASTEXITCODE -eq 0) { Info "User '$dbUser' dibuat." } else { Warn "User '$dbUser' mungkin sudah ada, dilanjutkan." }

psql -U postgres -c "CREATE DATABASE $dbName OWNER $dbUser;" 2>$null
if ($LASTEXITCODE -eq 0) { Info "Database '$dbName' dibuat." } else { Warn "Database '$dbName' mungkin sudah ada, dilanjutkan." }

# -----------------------------------------------------------------------------
# 6. Install backend dependencies
# -----------------------------------------------------------------------------
Info "Install backend dependencies..."
Set-Location backend
npm install
Set-Location ..

# -----------------------------------------------------------------------------
# 7. Migrasi & Seed database
# -----------------------------------------------------------------------------
Info "Menjalankan migrasi database..."
Set-Location backend
npm run db:migrate
Info "Menjalankan seed data..."
npm run db:seed
Set-Location ..

# -----------------------------------------------------------------------------
# 8. Install frontend dependencies
# -----------------------------------------------------------------------------
Info "Install frontend dependencies..."
Set-Location frontend
npm install
Set-Location ..

# -----------------------------------------------------------------------------
# 9. Jalankan backend & frontend di window terpisah
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Info "Setup selesai! Menjalankan KLIP..."
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Frontend : http://localhost:3001" -ForegroundColor Green
Write-Host "  Backend  : http://localhost:5001" -ForegroundColor Green
Write-Host "  API Docs : http://localhost:5001/api-docs" -ForegroundColor Green
Write-Host ""
Write-Host "  Login    : admin / admin123" -ForegroundColor Green
Write-Host ""

# Buka 2 terminal baru
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD\backend'; npm run dev"
Start-Sleep -Seconds 3
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD\frontend'; npm run dev"

Write-Host "Dua terminal baru dibuka untuk backend dan frontend." -ForegroundColor Green
Write-Host "Tunggu beberapa detik lalu buka: http://localhost:3001" -ForegroundColor Green
