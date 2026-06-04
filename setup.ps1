# KLIP Setup Script for Windows PowerShell
# This script automates the installation and setup process

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  KLIP Installation Script" -ForegroundColor Cyan
Write-Host "  KPN Logistics Intelligence Platform" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Host "Checking prerequisites..." -ForegroundColor Yellow

# Check Node.js
$nodeVersion = node --version 2>$null
if ($nodeVersion) {
    Write-Host "✓ Node.js found: $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "✗ Node.js not found. Please install Node.js 18+ from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# Check npm
$npmVersion = npm --version 2>$null
if ($npmVersion) {
    Write-Host "✓ npm found: v$npmVersion" -ForegroundColor Green
} else {
    Write-Host "✗ npm not found. Please install npm" -ForegroundColor Red
    exit 1
}

# Check PostgreSQL
$psqlVersion = psql --version 2>$null
if ($psqlVersion) {
    Write-Host "✓ PostgreSQL found: $psqlVersion" -ForegroundColor Green
} else {
    Write-Host "⚠ PostgreSQL not found. Please install PostgreSQL 14+" -ForegroundColor Yellow
    Write-Host "  Download from: https://www.postgresql.org/download/" -ForegroundColor Yellow
    $continue = Read-Host "Continue anyway? (y/n)"
    if ($continue -ne 'y') {
        exit 1
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Step 1: Installing Dependencies" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Install root dependencies
Write-Host "Installing root dependencies..." -ForegroundColor Yellow
npm install

# Install frontend dependencies
Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
Set-Location frontend
npm install
Set-Location ..

# Install backend dependencies
Write-Host "Installing backend dependencies..." -ForegroundColor Yellow
Set-Location backend
npm install
Set-Location ..

Write-Host "✓ All dependencies installed successfully!" -ForegroundColor Green
Write-Host ""

# Setup environment files
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Step 2: Setting Up Environment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Backend .env
if (Test-Path "backend\.env") {
    Write-Host "⚠ backend\.env already exists, skipping..." -ForegroundColor Yellow
} else {
    Write-Host "Creating backend\.env file..." -ForegroundColor Yellow
    
    $dbPassword = Read-Host "Enter PostgreSQL password (default: postgres)"
    if ([string]::IsNullOrWhiteSpace($dbPassword)) {
        $dbPassword = "postgres"
    }
    
    $jwtSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})
    
    @"
PORT=5000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://postgres:${dbPassword}@localhost:5432/klip_db
DB_HOST=localhost
DB_PORT=5432
DB_NAME=klip_db
DB_USER=postgres
DB_PASSWORD=${dbPassword}

# JWT
JWT_SECRET=${jwtSecret}
JWT_EXPIRES_IN=7d

# File Upload
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760

# SAP Integration (for future use)
SAP_API_URL=http://sap-server/odata/v2
SAP_USERNAME=
SAP_PASSWORD=

# Email (for alerts)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@klip.com

# Cron Job
DAILY_SYNC_CRON=0 7 * * *
"@ | Out-File -FilePath "backend\.env" -Encoding utf8
    
    Write-Host "✓ backend\.env created!" -ForegroundColor Green
}

# Frontend .env.local
if (Test-Path "frontend\.env.local") {
    Write-Host "⚠ frontend\.env.local already exists, skipping..." -ForegroundColor Yellow
} else {
    Write-Host "Creating frontend\.env.local file..." -ForegroundColor Yellow
    "NEXT_PUBLIC_API_URL=http://localhost:5000/api" | Out-File -FilePath "frontend\.env.local" -Encoding utf8
    Write-Host "✓ frontend\.env.local created!" -ForegroundColor Green
}

Write-Host ""

# Database setup
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Step 3: Database Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Please create the PostgreSQL database manually:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Open PostgreSQL command line (psql):" -ForegroundColor White
Write-Host "   psql -U postgres" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. Create the database:" -ForegroundColor White
Write-Host "   CREATE DATABASE klip_db;" -ForegroundColor Cyan
Write-Host ""
Write-Host "3. Exit psql:" -ForegroundColor White
Write-Host "   \q" -ForegroundColor Cyan
Write-Host ""

$dbReady = Read-Host "Have you created the database? (y/n)"

if ($dbReady -eq 'y') {
    Write-Host ""
    Write-Host "Running database migration..." -ForegroundColor Yellow
    Set-Location backend
    npm run db:migrate
    
    Write-Host ""
    Write-Host "Seeding database with test users..." -ForegroundColor Yellow
    npm run db:seed
    Set-Location ..
    
    Write-Host "✓ Database setup complete!" -ForegroundColor Green
} else {
    Write-Host "⚠ Skipping database setup. Run 'npm run db:migrate' and 'npm run db:seed' later." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To start the application, run:" -ForegroundColor Green
Write-Host "  npm run dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "Then access:" -ForegroundColor Green
Write-Host "  Frontend: http://localhost:3001" -ForegroundColor Cyan
Write-Host "  API Docs: http://localhost:5001/api-docs" -ForegroundColor Cyan
Write-Host ""
Write-Host "Demo Login Credentials:" -ForegroundColor Green
Write-Host "  Username: admin     Password: admin123" -ForegroundColor Cyan
Write-Host "  Username: trading   Password: trading123" -ForegroundColor Cyan
Write-Host "  Username: logistics Password: logistics123" -ForegroundColor Cyan
Write-Host ""
Write-Host "For more information, see:" -ForegroundColor Green
Write-Host "  - QUICKSTART.md for quick start guide" -ForegroundColor Cyan
Write-Host "  - INSTALLATION.md for detailed setup" -ForegroundColor Cyan
Write-Host "  - PROJECT_SUMMARY.md for project overview" -ForegroundColor Cyan
Write-Host ""
Write-Host "Happy coding!" -ForegroundColor Green

