# Test Excel Import with POST Method
Write-Host "Testing Excel Import Endpoint..." -ForegroundColor Cyan
Write-Host ""

# Test WITHOUT authentication (will fail but show the endpoint is working)
Write-Host "1. Testing endpoint WITHOUT authentication (should return 401)..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://localhost:5001/api/excel-import/import/logistics-overview" -Method Post -ErrorAction Stop
    Write-Host "Response:" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 3
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "Status Code: $statusCode" -ForegroundColor $(if ($statusCode -eq 401) { "Yellow" } else { "Red" })
    
    if ($statusCode -eq 401) {
        Write-Host "✓ Endpoint is working! Authentication required (as expected)" -ForegroundColor Green
    } else {
        Write-Host "Error: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "==========================================="-ForegroundColor Cyan
Write-Host "To use this endpoint, you need to:" -ForegroundColor Cyan
Write-Host "==========================================="-ForegroundColor Cyan
Write-Host "1. Log in to get a JWT token:" -ForegroundColor White
Write-Host "   POST http://localhost:5001/api/auth/login" -ForegroundColor Gray
Write-Host "   Body: { username, password }" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Use the token in the Authorization header:" -ForegroundColor White
Write-Host "   Authorization: Bearer <your-token>" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Then call the Excel import endpoint:" -ForegroundColor White
Write-Host "   POST http://localhost:5001/api/excel-import/import/logistics-overview" -ForegroundColor Gray
Write-Host ""
Write-Host "Required Role: ADMIN or SUPPORT" -ForegroundColor Yellow

