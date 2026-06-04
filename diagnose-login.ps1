# KLIP Login Diagnostic Script
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "KLIP System Diagnostic" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check if ports are in use
Write-Host "1. Checking Ports..." -ForegroundColor Yellow
Write-Host "Backend (Port 5001):" -NoNewline
$backend = netstat -ano | findstr ":5001"
if ($backend) {
    Write-Host " IN USE" -ForegroundColor Green
    $backend | Select-Object -First 1
} else {
    Write-Host " NOT RUNNING" -ForegroundColor Red
}

Write-Host "Frontend (Port 3001):" -NoNewline
$frontend = netstat -ano | findstr ":3001"
if ($frontend) {
    Write-Host " IN USE" -ForegroundColor Green
    $frontend | Select-Object -First 1
} else {
    Write-Host " NOT RUNNING" -ForegroundColor Red
}

Write-Host ""

# 2. Check Node processes
Write-Host "2. Checking Node Processes..." -ForegroundColor Yellow
$nodeProcesses = Get-Process -Name node -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    Write-Host "Found $($nodeProcesses.Count) Node process(es)" -ForegroundColor Green
} else {
    Write-Host "No Node processes running!" -ForegroundColor Red
}

Write-Host ""

# 3. Test Database Connection
Write-Host "3. Testing Database..." -ForegroundColor Yellow
cd backend
$dbTest = node create-test-user.js 2>&1
if ($dbTest -match "Found \d+ user") {
    Write-Host "Database: OK" -ForegroundColor Green
    $dbTest | Select-String "Found"
} else {
    Write-Host "Database: ERROR" -ForegroundColor Red
    $dbTest | Select-Object -Last 3
}

Write-Host ""

# 4. Test Backend API
Write-Host "4. Testing Backend API..." -ForegroundColor Yellow
$apiTest = node test-login.js 2>&1
if ($apiTest -match "Login successful") {
    Write-Host "Backend API: OK" -ForegroundColor Green
    Write-Host "Login works!" -ForegroundColor Green
} else {
    Write-Host "Backend API: ERROR" -ForegroundColor Red
    $apiTest | Select-Object -Last 5
}

Write-Host ""

# 5. Summary and Recommendations
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "DIAGNOSIS SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if (-not $backend) {
    Write-Host ""
    Write-Host "ISSUE: Backend not running" -ForegroundColor Red
    Write-Host "FIX: Check terminal for TypeScript errors" -ForegroundColor Yellow
    Write-Host "     Look for 'TSError' in the output" -ForegroundColor Yellow
    Write-Host ""
}

if (-not $frontend) {
    Write-Host ""
    Write-Host "ISSUE: Frontend not running" -ForegroundColor Red
    Write-Host "FIX: Port 3001 might be in use" -ForegroundColor Yellow
    Write-Host "     Run: netstat -ano | findstr :3001" -ForegroundColor Yellow
    Write-Host "     Then: taskkill /F /PID <PID>" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host ""
Write-Host "Quick Fixes:" -ForegroundColor Cyan
Write-Host "1. Stop all: Ctrl+C in terminal, then restart" -ForegroundColor White
Write-Host "2. Kill all Node: taskkill /F /IM node.exe" -ForegroundColor White
Write-Host "3. Restart: npm run dev" -ForegroundColor White
Write-Host ""

cd ..

