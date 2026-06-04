# Complete Excel Import Test with Login
Write-Host "==========================================="-ForegroundColor Cyan
Write-Host "Excel Import Test with Authentication" -ForegroundColor Cyan
Write-Host "==========================================="-ForegroundColor Cyan
Write-Host ""

$baseUrl = "http://localhost:5001"

# Get credentials from user
Write-Host "Enter your credentials:" -ForegroundColor Yellow
$username = Read-Host "Username (default: admin)"
if ([string]::IsNullOrWhiteSpace($username)) { $username = "admin" }

$password = Read-Host "Password" -AsSecureString
$passwordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))

Write-Host ""

# Step 1: Login
Write-Host "Step 1: Logging in as '$username'..." -ForegroundColor Yellow
try {
    $loginBody = @{
        username = $username
        password = $passwordPlain
    } | ConvertTo-Json

    $loginResponse = Invoke-RestMethod -Uri "$baseUrl/api/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
    $token = $loginResponse.data.token
    
    Write-Host "Login successful!" -ForegroundColor Green
    Write-Host "   User: $($loginResponse.data.user.username)" -ForegroundColor Gray
    Write-Host "   Role: $($loginResponse.data.user.role)" -ForegroundColor Gray
    Write-Host "   Token: $($token.Substring(0, 30))..." -ForegroundColor Gray
} catch {
    Write-Host "Login failed!" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Error: $responseBody" -ForegroundColor Red
    } else {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    }
    exit 1
}

Write-Host ""

# Step 2: Test Excel Import
Write-Host "Step 2: Importing Excel data..." -ForegroundColor Yellow
Write-Host "   File: docs/Logistics Overview 13.10.2025 (Logic) - from IT.xlsx" -ForegroundColor Gray
Write-Host ""

try {
    $headers = @{
        "Authorization" = "Bearer $token"
    }

    $importResponse = Invoke-RestMethod -Uri "$baseUrl/api/excel-import/import/logistics-overview" -Method Post -Headers $headers
    
    Write-Host "Excel import completed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Import Results:" -ForegroundColor White
    Write-Host "================================" -ForegroundColor Gray
    Write-Host "Import ID:        $($importResponse.data.importId)" -ForegroundColor Cyan
    Write-Host "Total Records:    $($importResponse.data.totalRecords)" -ForegroundColor Cyan
    Write-Host "Processed:        $($importResponse.data.processedRecords)" -ForegroundColor Green
    Write-Host "Failed:           $($importResponse.data.failedRecords)" -ForegroundColor $(if ($importResponse.data.failedRecords -gt 0) { "Red" } else { "Green" })
    
    if ($importResponse.data.errors -and $importResponse.data.errors.Count -gt 0) {
        Write-Host ""
        Write-Host "Errors:" -ForegroundColor Yellow
        $importResponse.data.errors | ForEach-Object {
            Write-Host "  - $_" -ForegroundColor Red
        }
    }
    
    Write-Host ""
    Write-Host "Full Response:" -ForegroundColor Gray
    $importResponse | ConvertTo-Json -Depth 5
    
} catch {
    Write-Host "Excel import failed!" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Error: $responseBody" -ForegroundColor Red
    } else {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "==========================================="-ForegroundColor Cyan
Write-Host "Test Complete" -ForegroundColor Cyan
Write-Host "==========================================="-ForegroundColor Cyan

