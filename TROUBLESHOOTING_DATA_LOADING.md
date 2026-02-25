# Troubleshooting: Data Not Loading in Frontend

## Quick Checklist

1. ✅ **Backend Server Running?**
   - Check if backend is running on port 5001
   - Visit: http://localhost:5001/health
   - Should return: `{"status":"OK","message":"KLIP Backend is running"}`

2. ✅ **API URL Configuration**
   - Frontend expects: `http://localhost:5001/api`
   - Check browser console for API errors
   - Verify `NEXT_PUBLIC_API_URL` environment variable

3. ✅ **Authentication Token**
   - Check if you're logged in
   - Check browser localStorage for `token`
   - Token might be expired - try logging out and back in

4. ✅ **Browser Console Errors**
   - Open Developer Tools (F12)
   - Check Console tab for errors
   - Check Network tab for failed API requests

## Step-by-Step Diagnosis

### Step 1: Check Backend Server Status

Open a terminal and run:

```bash
# Check if backend is running
curl http://localhost:5001/health

# Or visit in browser
# http://localhost:5001/health
```

**Expected Response:**
```json
{"status":"OK","message":"KLIP Backend is running"}
```

**If backend is not running:**
```bash
cd backend
npm install
npm run dev
```

### Step 2: Check API URL Configuration

**Check Frontend Environment Variable:**

1. Create or edit `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:5001/api
```

2. Restart frontend server after changing environment variables:
```bash
cd frontend
npm run dev
```

**Verify Configuration:**

Open browser console (F12) and run:
```javascript
console.log('API URL:', process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api');
```

### Step 3: Check Browser Console

1. Open Developer Tools (F12)
2. Go to **Console** tab
3. Look for errors like:
   - `Failed to fetch`
   - `Network Error`
   - `CORS policy`
   - `401 Unauthorized`
   - `404 Not Found`

4. Go to **Network** tab
5. Refresh the page
6. Look for failed requests (red status codes)
7. Click on failed requests to see details

### Step 4: Check Authentication

1. Open browser console (F12)
2. Go to **Application** tab (Chrome) or **Storage** tab (Firefox)
3. Check **Local Storage** → `http://localhost:3001`
4. Verify `token` exists and is not expired

**If token is missing or expired:**
- Log out and log back in
- Check backend authentication endpoint

### Step 5: Test API Endpoint Directly

Test a specific API endpoint:

```bash
# Get your token from browser localStorage first
TOKEN="your-token-here"

# Test dashboard stats endpoint
curl -H "Authorization: Bearer $TOKEN" http://localhost:5001/api/dashboard/stats

# Test health endpoint (no auth required)
curl http://localhost:5001/health
```

## Common Issues and Solutions

### Issue 1: Backend Not Running

**Symptoms:**
- Network errors in browser console
- "Failed to fetch" errors
- Health check endpoint doesn't respond

**Solution:**
```bash
cd backend
npm run dev
```

### Issue 2: Wrong API URL

**Symptoms:**
- 404 errors for API endpoints
- Network tab shows requests to wrong URL

**Solution:**
1. Create `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:5001/api
```

2. Restart frontend:
```bash
cd frontend
npm run dev
```

### Issue 3: CORS Errors

**Symptoms:**
- Console shows: "CORS policy: No 'Access-Control-Allow-Origin' header"
- Network tab shows CORS errors

**Solution:**
Backend already has CORS enabled. If you still see errors:
1. Check backend is running
2. Verify CORS middleware is active in `backend/src/server.ts`
3. Check browser isn't blocking requests

### Issue 4: Authentication Token Expired

**Symptoms:**
- 401 Unauthorized errors
- Automatic redirect to login page
- Data loads briefly then stops

**Solution:**
1. Log out and log back in
2. Check token expiration in backend JWT configuration
3. Verify token is being sent in request headers

### Issue 5: Database Connection Issues

**Symptoms:**
- Backend running but returns 500 errors
- Backend logs show database connection errors

**Solution:**
1. Check PostgreSQL is running:
```bash
# Windows
# Check Services for PostgreSQL

# Linux/Mac
sudo systemctl status postgresql
```

2. Verify database credentials in `backend/.env`:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=klip_db
DB_USER=postgres
DB_PASSWORD=your_password
```

### Issue 6: Port Conflicts

**Symptoms:**
- Backend won't start
- "Port already in use" error

**Solution:**
1. Check what's using port 5001:
```bash
# Windows
netstat -ano | findstr :5001

# Linux/Mac
lsof -i :5001
```

2. Kill the process or change port in `backend/.env`:
```env
PORT=5002
```

3. Update frontend `.env.local` accordingly:
```env
NEXT_PUBLIC_API_URL=http://localhost:5002/api
```

## Debugging Tools

### Browser Console Commands

```javascript
// Check API URL
console.log('API URL:', process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api');

// Check token
console.log('Token:', localStorage.getItem('token'));

// Test API call manually
fetch('http://localhost:5001/api/dashboard/stats', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  }
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
```

### Backend Logs

Check backend terminal for:
- Request logs
- Error messages
- Database connection status

### Network Tab Analysis

1. Open Network tab in browser DevTools
2. Filter by "Fetch/XHR"
3. Look for:
   - Red status codes (4xx, 5xx)
   - Failed requests
   - Request/Response details

## Still Not Working?

1. **Check all services are running:**
   - Frontend: http://localhost:3001
   - Backend: http://localhost:5001/health
   - Database: PostgreSQL on port 5432

2. **Verify environment variables:**
   - `frontend/.env.local` has `NEXT_PUBLIC_API_URL`
   - `backend/.env` has database credentials

3. **Check logs:**
   - Browser console for frontend errors
   - Backend terminal for server errors
   - Database logs for connection issues

4. **Try clean restart:**
   ```bash
   # Stop all services
   # Restart database
   # Restart backend
   # Restart frontend
   ```

5. **Clear browser cache:**
   - Clear localStorage
   - Clear cookies
   - Hard refresh (Ctrl+Shift+R)

## Quick Test Script

Save this as `test-api.js` in project root:

```javascript
const axios = require('axios');

async function testAPI() {
  try {
    // Test health endpoint
    console.log('Testing health endpoint...');
    const health = await axios.get('http://localhost:5001/health');
    console.log('✅ Health check:', health.data);

    // Test login (get token)
    console.log('\nTesting login...');
    const login = await axios.post('http://localhost:5001/api/auth/login', {
      username: 'admin',
      password: 'admin123'
    });
    console.log('✅ Login successful');
    const token = login.data.data.token;

    // Test authenticated endpoint
    console.log('\nTesting dashboard stats...');
    const stats = await axios.get('http://localhost:5001/api/dashboard/stats', {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('✅ Dashboard stats:', stats.data);

    console.log('\n✅ All tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

testAPI();
```

Run with: `node test-api.js`





















