# Simple Test Commands for Excel Import

## ✅ Backend Server is Running!
According to your terminal logs (lines 85-113), your backend server is **RUNNING** on port 5001 with the scheduler initialized.

## 🧪 Quick Test Commands

### **Test 1: Check if server is responding**
Copy and paste this into PowerShell:
```powershell
Invoke-RestMethod -Uri "http://localhost:5001/health"
```

Expected output:
```
status  message
------  -------
OK      KLIP Backend is running
```

---

### **Test 2: Test Excel Import Endpoint (will ask for authentication)**
Copy and paste this into PowerShell:
```powershell
try {
    Invoke-RestMethod -Uri "http://localhost:5001/api/excel-import/import/logistics-overview" -Method Post
} catch {
    Write-Host "Status: $($_.Exception.Response.StatusCode)"
    Write-Host "This is expected - authentication required"
}
```

Expected output:
```
Status: 401
This is expected - authentication required
```

---

### **Test 3: Full Test with Login (Replace username/password)**
Copy and paste this ENTIRE block into PowerShell:
```powershell
# Step 1: Login
$loginBody = @{
    username = "admin"
    password = "admin123"
} | ConvertTo-Json

try {
    $login = Invoke-RestMethod -Uri "http://localhost:5001/api/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
    $token = $login.data.token
    Write-Host "Login successful! Token obtained." -ForegroundColor Green
    
    # Step 2: Call Excel Import
    $headers = @{
        "Authorization" = "Bearer $token"
    }
    
    $import = Invoke-RestMethod -Uri "http://localhost:5001/api/excel-import/import/logistics-overview" -Method Post -Headers $headers
    
    Write-Host "Excel Import Response:" -ForegroundColor Green
    $import | ConvertTo-Json -Depth 5
    
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Details: $responseBody" -ForegroundColor Yellow
    }
}
```

---

## 🌐 Using Postman (Recommended)

### **Step 1: Login**
- **Method**: POST
- **URL**: `http://localhost:5001/api/auth/login`
- **Headers**: 
  - `Content-Type: application/json`
- **Body** (raw JSON):
```json
{
  "username": "admin",
  "password": "your_password_here"
}
```
- Click **Send**
- Copy the `token` from the response

### **Step 2: Excel Import**
- **Method**: POST
- **URL**: `http://localhost:5001/api/excel-import/import/logistics-overview`
- **Headers**: 
  - `Authorization: Bearer <paste_token_here>`
- **Body**: Empty (no body needed)
- Click **Send**

---

## 🌐 Using Browser Extension (Thunder Client / REST Client)

Same steps as Postman above.

---

## 📊 Check Scheduler Status (No Auth Required for Health)

You can also check various endpoints:

```powershell
# Health check
Invoke-RestMethod -Uri "http://localhost:5001/health"

# API docs (open in browser)
Start-Process "http://localhost:5001/api-docs"
```

---

## 🎯 What You Should See

### **Successful Import Response:**
```json
{
  "success": true,
  "data": {
    "importId": "some-uuid-here",
    "totalRecords": 50,
    "processedRecords": 48,
    "failedRecords": 2,
    "errors": ["Row 5: Missing required field", ...]
  }
}
```

---

## ⚠️ Common Issues

### **Issue: 401 Unauthorized**
- **Cause**: No token or invalid token
- **Solution**: Login first to get a valid JWT token

### **Issue**: 403 Forbidden**
- **Cause**: Your user doesn't have ADMIN or SUPPORT role
- **Solution**: Use a user with proper permissions

### **Issue: File not found**
- **Cause**: Excel file doesn't exist at the expected location
- **Solution**: Ensure the file exists at:
  ```
  docs/Logistics Overview 13.10.2025 (Logic) - from IT.xlsx
  ```

---

## 📅 Automated Schedules (Already Running!)

Based on your logs, the scheduler is already running with these schedules:
- ✅ **Morning Import**: 8:00 AM JKT (next run: 2025-10-16T01:00:00.000Z)
- ✅ **Afternoon Import**: 1:00 PM JKT (next run: 2025-10-16T06:00:00.000Z)
- ✅ **Evening Import**: 5:00 PM JKT (next run: 2025-10-15T10:00:00.000Z)

The system will automatically import the Excel data at these times!

---

## 🎓 Need Default Login Credentials?

If you haven't set up users yet, you may need to:
1. Run the database seed script: `cd backend && npm run db:seed`
2. Or create a user manually through the database or signup endpoint

---

## 📞 Still Having Issues?

The backend server is running successfully based on your logs. If you're still getting "site can't be reached":
1. Make sure you're using **POST** method, not GET
2. Wait 10-15 seconds after server startup
3. Try accessing `http://localhost:5001/health` first to confirm connectivity
4. Check if any firewall or antivirus is blocking the port

