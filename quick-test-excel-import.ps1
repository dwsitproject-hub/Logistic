# Quick Excel Import Test
Write-Host "==========================================="-ForegroundColor Cyan
Write-Host "Quick Excel Import Test" -ForegroundColor Cyan
Write-Host "==========================================="-ForegroundColor Cyan
Write-Host ""

$baseUrl = "http://localhost:5001"

# Test 1: Health Check
Write-Host "1. Testing Health Check..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health"
    Write-Host "Server is running!" -ForegroundColor Green
    Write-Host "   Response: $($health | ConvertTo-Json)" -ForegroundColor Gray
} catch {
    Write-Host "Server is not responding!" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Test 2: Test Excel Import Endpoint (without auth - will return 401)
Write-Host "2. Testing Excel Import Endpoint (without authentication)..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$baseUrl/api/excel-import/import/logistics-overview" -Method Post -UseBasicParsing
    Write-Host "Response: $($response.Content)" -ForegroundColor Green
} catch {
    if ($_.Exception.Response) {
        $statusCode = [int]$_.Exception.Response.StatusCode
        
        Write-Host "Status Code: $statusCode" -ForegroundColor Yellow
        
        if ($statusCode -eq 401) {
            Write-Host "Endpoint is working correctly!" -ForegroundColor Green
            Write-Host "   Authentication required (as expected)" -ForegroundColor Yellow
        } elseif ($statusCode -eq 404) {
            Write-Host "Endpoint not found (404)" -ForegroundColor Red
        } else {
            Write-Host "Unexpected status code" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "==========================================="-ForegroundColor Cyan
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "==========================================="-ForegroundColor Cyan
Write-Host ""
Write-Host "To actually import data, you need to:" -ForegroundColor White
Write-Host ""
Write-Host "1. First, log in to get a token:" -ForegroundColor Yellow
Write-Host ""
Write-Host '   Example commands:' -ForegroundColor Gray
Write-Host '   $loginBody = @{ username = "admin"; password = "your_password" } | ConvertTo-Json' -ForegroundColor Gray
Write-Host '   $login = Invoke-RestMethod -Uri "http://localhost:5001/api/auth/login" -Method Post -Body $loginBody -ContentType "application/json"' -ForegroundColor Gray
Write-Host '   $token = $login.data.token' -ForegroundColor Gray
Write-Host ""
Write-Host "2. Then, call the Excel import with the token:" -ForegroundColor Yellow
Write-Host ""
Write-Host '   $headers = @{ "Authorization" = "Bearer $token" }' -ForegroundColor Gray
Write-Host '   $import = Invoke-RestMethod -Uri "http://localhost:5001/api/excel-import/import/logistics-overview" -Method Post -Headers $headers' -ForegroundColor Gray
Write-Host ""
Write-Host "For detailed instructions, see: EXCEL_IMPORT_TESTING_GUIDE.md" -ForegroundColor Cyan
Write-Host ""
