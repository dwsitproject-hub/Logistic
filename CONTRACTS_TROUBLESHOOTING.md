# Contracts Page - Troubleshooting Guide

## Issue: "I didn't see any contract"

### Quick Fix Steps

#### 1. **Hard Refresh Your Browser**
The frontend code has been updated, so you need to clear the cache:

**Windows/Linux**:
- Press `Ctrl + Shift + R` or `Ctrl + F5`

**Mac**:
- Press `Cmd + Shift + R`

Or manually:
1. Open browser DevTools (F12)
2. Right-click the refresh button
3. Select "Empty Cache and Hard Reload"

#### 2. **Check Browser Console**
1. Press `F12` to open DevTools
2. Go to "Console" tab
3. Look for any errors (red messages)
4. You should see: "Contracts loaded: X" where X is the number of contracts

#### 3. **Verify Backend is Running**
Check that the backend server restarted successfully:
- Look at your terminal where backend is running
- Should see: "Server is running on port 5001"
- Should NOT see any errors about "function max(uuid)"

#### 4. **Check Database Has Data**
Open a new PowerShell terminal and run:
```powershell
cd backend
node -e "const pool = require('./dist/database/connection').default; (async () => { const result = await pool.query('SELECT COUNT(*) FROM contracts'); console.log('Total contracts in database:', result.rows[0].count); process.exit(0); })()"
```

This will tell you if there are contracts in the database.

## What Was Fixed

### SQL Error: "function max(uuid) does not exist"
**Fixed**: Changed from `MAX(c.id)` to `(array_agg(c.id))[1]` for UUID fields

### The Fix
The backend SQL query was updated to use PostgreSQL's `array_agg` function instead of `MAX` for UUID and other fields, which is the proper way to select values when grouping.

## Expected Behavior

After refreshing, you should see:

### Contracts Page
```
Contracts
X total contracts | X shown

[Search box]  [Status Filter]

All Contracts

┌─────────────────────────────────────────┐
│ 5120395862  [ACTIVE] [LTC] [Land]      │
│ Group: TAP                              │
│ Supplier: PT Etam Bersama Lestari      │
│ Product: CPO                            │
│ Contract Date: 9/1/2025                 │
│ ───────────────────────────────────────│
│ PO Numbers (X): ...                     │
│ STO Numbers (X): ...                    │
│ ───────────────────────────────────────│
│ Contract Qty: 2,500,000 MT              │
│ Total STO Qty: 7,500,000 MT             │
│ Outstanding: -5,000,000 MT [RED]        │
│                      [View Details]     │
└─────────────────────────────────────────┘
```

## If Still No Contracts

### Check 1: Are there contracts in the database?
Run this in backend directory:
```powershell
node -e "const pool = require('./dist/database/connection').default; (async () => { const result = await pool.query('SELECT contract_id, supplier, product FROM contracts LIMIT 5'); console.log(result.rows); process.exit(0); })()"
```

### Check 2: Is the API endpoint working?
1. Login to the application first at http://localhost:3001
2. Open browser DevTools → Network tab
3. Refresh the Contracts page
4. Look for API call to `/api/contracts`
5. Check the response - should show contract data

### Check 3: Are you logged in?
If you're not logged in:
1. Go to http://localhost:3001/login
2. Login with your credentials
3. Navigate to Contracts page

### Check 4: Backend logs
Look at the backend terminal for:
```
debug: Executed query {"duration":X,"rows":Y,"text":"...SELECT c.contract_id..."}
```
- If rows > 0: Contracts exist and query works
- If rows = 0: No contracts in database (need to import SAP data)

## Solutions

### Solution 1: Re-import SAP Data
If no contracts in database:
1. Go to http://localhost:3001/sap-imports
2. Click "Import New File"
3. Upload your Excel file (sample.xlsx)
4. Wait for import to complete
5. Go back to Contracts page

### Solution 2: Clear Browser Storage
If data exists but not showing:
1. Open DevTools (F12)
2. Go to Application tab
3. Clear Site Data
4. Refresh page
5. Login again

### Solution 3: Check Token
If authentication errors:
1. Check localStorage has 'token'
2. If not, login again
3. Token should be set after successful login

## Current Status

✅ Backend: Fixed (UUID MAX error resolved)
✅ Frontend: Updated (limit increased to 100)
✅ Formatting: All numbers have commas
✅ Multiple POs/STOs: Showing with counts
✅ Outstanding Quantity: Correctly calculated

## Next Steps

1. **Hard refresh browser** (Ctrl + Shift + R)
2. **Check browser console** for errors
3. **Verify you're logged in**
4. **Check backend logs** for query execution
5. If still issues, **check database** has contracts

---

**The SQL error has been fixed!** Please refresh your browser and you should see your contracts.

