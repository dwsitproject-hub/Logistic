# Complete Clean Restart Script
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "KLIP Backend - Clean Restart" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Kill all Node processes
Write-Host "Step 1: Stopping all Node processes..." -ForegroundColor Yellow
taskkill /F /IM node.exe 2>$null
Start-Sleep -Seconds 2
Write-Host "✅ All Node processes stopped" -ForegroundColor Green
Write-Host ""

# Step 2: Clear ts-node cache
Write-Host "Step 2: Clearing ts-node cache..." -ForegroundColor Yellow
if (Test-Path "node_modules/.cache") {
    Remove-Item -Recurse -Force "node_modules/.cache"
    Write-Host "✅ Cache cleared" -ForegroundColor Green
} else {
    Write-Host "✅ No cache to clear" -ForegroundColor Green
}
Write-Host ""

# Step 3: Verify port 5001 is free
Write-Host "Step 3: Checking port 5001..." -ForegroundColor Yellow
$port5001 = netstat -ano | findstr ":5001" | findstr "LISTENING"
if ($port5001) {
    Write-Host "⚠️  Port 5001 still in use, extracting PID..." -ForegroundColor Yellow
    $pid = ($port5001 -split '\s+')[-1]
    Write-Host "Killing process $pid..." -ForegroundColor Yellow
    taskkill /F /PID $pid 2>$null
    Start-Sleep -Seconds 1
}
Write-Host "✅ Port 5001 is free" -ForegroundColor Green
Write-Host ""

# Step 4: Start backend
Write-Host "Step 4: Starting backend server..." -ForegroundColor Yellow
Write-Host "Please wait 10-15 seconds..." -ForegroundColor Gray
Write-Host ""
npm run dev

