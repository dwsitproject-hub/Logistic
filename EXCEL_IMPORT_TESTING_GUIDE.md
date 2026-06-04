# Excel Import Testing Guide

## ✅ Server Status
Your backend server is **RUNNING** on `http://localhost:5001`

## 🔐 Authentication Required
The Excel import endpoint requires JWT authentication with ADMIN or SUPPORT role.

## 📋 Step-by-Step Testing Guide

### **Step 1: Get Authentication Token**

First, you need to log in to get a JWT token.

#### Using PowerShell:
```powershell
$loginBody = @{
    username = "your_username"
    password = "your_password"
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Uri "http://localhost:5001/api/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
$token = $loginResponse.data.token

Write-Host "Token: $token"
```

#### Using cURL:
```bash
curl -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"your_username","password":"your_password"}'
```

#### Using Postman:
- **Method**: POST
- **URL**: `http://localhost:5001/api/auth/login`
- **Headers**: `Content-Type: application/json`
- **Body** (raw JSON):
```json
{
  "username": "your_username",
  "password": "your_password"
}
```

### **Step 2: Test Excel Import with Token**

Once you have the token, use it to call the Excel import endpoint.

#### Using PowerShell:
```powershell
# Use the $token from Step 1
$headers = @{
    "Authorization" = "Bearer $token"
}

$importResponse = Invoke-RestMethod -Uri "http://localhost:5001/api/excel-import/import/logistics-overview" -Method Post -Headers $headers

# View the response
$importResponse | ConvertTo-Json -Depth 5
```

#### Using cURL:
```bash
curl -X POST http://localhost:5001/api/excel-import/import/logistics-overview \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

#### Using Postman:
- **Method**: POST
- **URL**: `http://localhost:5001/api/excel-import/import/logistics-overview`
- **Headers**: 
  - `Authorization: Bearer YOUR_TOKEN_HERE`

---

## 🧪 Complete PowerShell Test Script

Save this as `test-full-excel-import.ps1`:

```powershell
# Complete Excel Import Test Script
Write-Host "==========================================="-ForegroundColor Cyan
Write-Host "Excel Import Full Test" -ForegroundColor Cyan
Write-Host "==========================================="-ForegroundColor Cyan
Write-Host ""

# Configuration
$baseUrl = "http://localhost:5001"
$username = "admin"  # Change this
$password = "admin"  # Change this

# Step 1: Login
Write-Host "Step 1: Logging in..." -ForegroundColor Yellow
try {
    $loginBody = @{
        username = $username
        password = $password
    } | ConvertTo-Json

    $loginResponse = Invoke-RestMethod -Uri "$baseUrl/api/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
    $token = $loginResponse.data.token
    
    Write-Host "✓ Login successful!" -ForegroundColor Green
    Write-Host "Token: $($token.Substring(0, 20))..." -ForegroundColor Gray
} catch {
    Write-Host "✗ Login failed: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 2: Test Excel Import
Write-Host "Step 2: Testing Excel Import..." -ForegroundColor Yellow
try {
    $headers = @{
        "Authorization" = "Bearer $token"
    }

    $importResponse = Invoke-RestMethod -Uri "$baseUrl/api/excel-import/import/logistics-overview" -Method Post -Headers $headers
    
    Write-Host "✓ Excel import successful!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Import Results:" -ForegroundColor White
    $importResponse | ConvertTo-Json -Depth 5
    
} catch {
    Write-Host "✗ Excel import failed: $_" -ForegroundColor Red
    
    # Show more details if available
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Error details: $responseBody" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "==========================================="-ForegroundColor Cyan
Write-Host "Test Complete" -ForegroundColor Cyan
Write-Host "==========================================="-ForegroundColor Cyan
```

---

## 📊 Other Available Endpoints

### **1. Check Scheduler Status**
```powershell
GET http://localhost:5001/api/excel-import/scheduler/status
Headers: Authorization: Bearer <token>
```

### **2. View Scheduled Imports**
```powershell
GET http://localhost:5001/api/excel-import/schedules
Headers: Authorization: Bearer <token>
```

### **3. Execute Scheduled Import Manually**
```powershell
POST http://localhost:5001/api/excel-import/schedules/{schedule-id}/execute
Headers: Authorization: Bearer <token>
```

### **4. Validate Excel File**
```powershell
GET http://localhost:5001/api/excel-import/validate?filePath=docs/Logistics%20Overview%2013.10.2025%20(Logic)%20-%20from%20IT.xlsx
Headers: Authorization: Bearer <token>
```

### **5. Preview Excel Data**
```powershell
GET http://localhost:5001/api/excel-import/preview?filePath=docs/Logistics%20Overview%2013.10.2025%20(Logic)%20-%20from%20IT.xlsx&maxRows=5
Headers: Authorization: Bearer <token>
```

---

## 🎯 Expected Response

### Success Response:
```json
{
  "success": true,
  "data": {
    "importId": "uuid-here",
    "totalRecords": 100,
    "processedRecords": 95,
    "failedRecords": 5,
    "errors": ["Row 10: Missing required field", ...]
  }
}
```

### Error Responses:

**401 Unauthorized:**
```json
{
  "success": false,
  "error": {
    "message": "Access token required"
  }
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "error": {
    "message": "Insufficient permissions"
  }
}
```

**404 Not Found:**
```json
{
  "success": false,
  "error": {
    "message": "File not found"
  }
}
```

---

## 🔧 Troubleshooting

### Issue: "Access token required"
- **Solution**: Make sure you're including the `Authorization` header with a valid Bearer token

### Issue: "Insufficient permissions"
- **Solution**: Your user must have ADMIN or SUPPORT role

### Issue: "File not found"
- **Solution**: Ensure the Excel file exists at:
  ```
  docs/Logistics Overview 13.10.2025 (Logic) - from IT.xlsx
  ```

### Issue: "Cannot reach the server"
- **Solution**: Make sure the backend is running on port 5001
- Check: `http://localhost:5001/health`

---

## 📅 Automated Schedule

Your Excel import is scheduled to run automatically at:
- **8:00 AM JKT** (1:00 AM UTC)
- **1:00 PM JKT** (6:00 AM UTC)
- **5:00 PM JKT** (10:00 AM UTC)

You can see the next run times in the scheduler logs:
```
info: Started schedule: Logistics Overview - Evening Import {"nextRun":"2025-10-15T10:00:00.000Z"...}
```

---

## 🎓 Using Postman Collection

If you're using Postman, create a collection with these requests:

1. **Login** → Save token to environment variable
2. **Excel Import** → Use token from environment
3. **Check Status** → Monitor import progress

---

## 📝 Notes

- The endpoint validates the Excel file structure before importing
- All imports are logged in the database with timestamps
- Failed rows are reported in the response
- The scheduler runs automatically in the background
- You can manually trigger imports anytime using the API

---

## 🆘 Need Help?

Check the backend logs for detailed error messages:
```
backend/logs/combined.log
backend/logs/error.log
```

