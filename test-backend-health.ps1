# PowerShell script to test backend health
Write-Host "Testing KLIP Backend Server..." -ForegroundColor Cyan
Write-Host ""

# Test 1: Health check
Write-Host "1. Testing health endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:5001/health" -UseBasicParsing
    Write-Host "   ✓ Health check successful!" -ForegroundColor Green
    Write-Host "   Response: $($response.Content)" -ForegroundColor Gray
} catch {
    Write-Host "   ✗ Health check failed!" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test 2: API Documentation
Write-Host "2. Testing API documentation..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:5001/api-docs/" -UseBasicParsing
    Write-Host "   ✓ API docs accessible!" -ForegroundColor Green
    Write-Host "   URL: http://localhost:5001/api-docs/" -ForegroundColor Gray
} catch {
    Write-Host "   ✗ API docs failed!" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "==========================================="-ForegroundColor Cyan
Write-Host "Server Status Summary:" -ForegroundColor Cyan
Write-Host "==========================================="-ForegroundColor Cyan
Write-Host "Backend URL: http://localhost:5001" -ForegroundColor White
Write-Host "Frontend URL: http://localhost:3001" -ForegroundColor White
Write-Host "API Docs: http://localhost:5001/api-docs" -ForegroundColor White
Write-Host ""
Write-Host "Excel Import Endpoints:" -ForegroundColor Yellow
Write-Host "  POST /api/excel-import/import/logistics-overview" -ForegroundColor Gray
Write-Host "  GET  /api/excel-import/schedules" -ForegroundColor Gray
Write-Host "  GET  /api/excel-import/scheduler/status" -ForegroundColor Gray
Write-Host ""
Write-Host "Note: Excel import endpoints require authentication." -ForegroundColor Cyan

