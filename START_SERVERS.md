# Quick Start Guide - Login Issue Fix

## Problem
You can't login because the backend server is not running.

## Solution - Start Both Servers

### Step 1: Start Backend Server

Open a **NEW PowerShell window** and run:

```powershell
cd "D:\Cursor\Logistic SAP\backend"
npm run dev
```

You should see:
```
🚀 Server is running on port 5001
📚 API Documentation available at http://localhost:5001/api-docs
```

**Keep this window open!** The backend needs to keep running.

---

### Step 2: Start Frontend Server

Open **ANOTHER PowerShell window** and run:

```powershell
cd "D:\Cursor\Logistic SAP\frontend"
npm run dev
```

You should see:
```
✓ Ready in 2.3s
○ Local: http://localhost:3000
```

**Keep this window open too!**

---

### Step 3: Login

1. Open your browser and go to: **http://localhost:3000**

2. Use these credentials:

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin123` | ADMIN |
| `trading` | `trading123` | TRADING |
| `logistics` | `logistics123` | LOGISTICS |
| `quality` | `quality123` | QUALITY |
| `finance` | `finance123` | FINANCE |

---

## Troubleshooting

### "Port already in use" Error

If you get a port conflict:

**For Backend (port 5001):**
```powershell
# Find what's using port 5001
netstat -ano | findstr :5001

# Kill the process (replace PID with the number from above)
taskkill /F /PID <PID>

# Then start backend again
npm run dev
```

**For Frontend (port 3000):**
```powershell
# Find what's using port 3000
netstat -ano | findstr :3000

# Kill the process
taskkill /F /PID <PID>

# Then start frontend again
npm run dev
```

### Database Connection Error

If backend shows database errors:

1. Make sure PostgreSQL is running
2. Check credentials in `backend/.env` file
3. Test database connection:
   ```powershell
   cd backend
   node create-test-user.js
   ```

---

## Quick Test

After starting both servers, test the backend:

```powershell
cd backend
node test-login.js
```

You should see:
```
✅ Login successful!
Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
User Info:
  Username: admin
  Email: admin@klip.com
  Role: ADMIN
```

---

## One-Line Commands (Copy & Paste)

**Terminal 1 (Backend):**
```powershell
cd "D:\Cursor\Logistic SAP\backend"; npm run dev
```

**Terminal 2 (Frontend):**
```powershell
cd "D:\Cursor\Logistic SAP\frontend"; npm run dev
```

---

## What's Happening?

- **Backend** (Port 5001): API server that handles login, database, SAP imports
- **Frontend** (Port 3000): Web interface that you see in your browser
- **Both must be running** for the system to work

---

## After Login Success

Once logged in, you can access:

- **Main Dashboard**: http://localhost:3000
- **SAP Data Entry**: http://localhost:3000/sap-data-entry
- **SAP Import Management**: http://localhost:3000/sap-imports
- **API Documentation**: http://localhost:5001/api-docs

---

**Need Help?**
If you still can't login after following these steps, check:
1. Both PowerShell windows are still open and running
2. No red error messages in either window
3. You're using the correct URL: http://localhost:3000 (not 5001)

---

*Quick Reference: Default Admin Login*
- Username: `admin`
- Password: `admin123`

