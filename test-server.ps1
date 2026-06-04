Write-Host "Testing KLIP Backend Server..." -ForegroundColor Cyan

try {
    $response = Invoke-RestMethod -Uri "http://localhost:5001/health" -Method Get
    Write-Host "✓ Backend is RUNNING!" -ForegroundColor Green
    Write-Host "Response: $($response | ConvertTo-Json)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Backend URL: http://localhost:5001" -ForegroundColor White
    Write-Host "Excel Import Endpoint: http://localhost:5001/api/excel-import/import/logistics-overview" -ForegroundColor Yellow
} catch {
    Write-Host "✗ Backend is NOT running!" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

