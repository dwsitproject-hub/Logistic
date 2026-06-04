# KLIP Port Configuration

## Current Port Settings

The KLIP application uses the following ports to avoid conflicts:

- **Frontend**: `http://localhost:3001`
- **Backend API**: `http://localhost:5001`
- **Database**: `localhost:5432` (PostgreSQL default)

## Why These Ports?

These ports were chosen to avoid conflicts with common applications:
- Port 3000 is commonly used by other React/Next.js apps
- Port 5000 is commonly used by other Node.js apps
- Using 3001 and 5001 provides separation

## Access URLs

Once the application is running:

| Service | URL | Description |
|---------|-----|-------------|
| **Frontend** | http://localhost:3001 | Main web application |
| **Backend API** | http://localhost:5001/api | REST API endpoints |
| **API Docs** | http://localhost:5001/api-docs | Swagger documentation |
| **Health Check** | http://localhost:5001/health | Server health status |
| **Database** | localhost:5432 | PostgreSQL (local access only) |

## Configuration Files

### Frontend Port

**File**: `frontend/package.json`
```json
{
  "scripts": {
    "dev": "next dev -p 3001",
    "start": "next start -p 3001"
  }
}
```

### Backend Port

**File**: `backend/.env`
```env
PORT=5001
```

**File**: `backend/src/server.ts`
```typescript
const PORT = process.env.PORT || 5001;
```

### API URL Configuration

**File**: `frontend/.env.local`
```env
NEXT_PUBLIC_API_URL=http://localhost:5001/api
```

**File**: `frontend/next.config.js`
```javascript
env: {
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api',
}
```

**File**: `frontend/src/lib/api.ts`
```typescript
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api',
});
```

## Changing Ports

### To Change Frontend Port

1. **Edit** `frontend/package.json`:
   ```json
   "dev": "next dev -p YOUR_PORT"
   ```

2. **No other changes needed** for frontend port

### To Change Backend Port

1. **Edit** `backend/.env`:
   ```env
   PORT=YOUR_BACKEND_PORT
   ```

2. **Update** `frontend/.env.local`:
   ```env
   NEXT_PUBLIC_API_URL=http://localhost:YOUR_BACKEND_PORT/api
   ```

3. **Restart** both servers

### Example: Using Ports 4000 and 4001

**Backend** (`backend/.env`):
```env
PORT=4001
```

**Frontend** (`frontend/package.json`):
```json
"dev": "next dev -p 4000"
```

**Frontend** (`frontend/.env.local`):
```env
NEXT_PUBLIC_API_URL=http://localhost:4001/api
```

## Docker Port Mapping

**File**: `docker-compose.yml`

```yaml
backend:
  ports:
    - "5001:5001"  # host:container

frontend:
  ports:
    - "3001:3001"  # host:container
```

To change Docker ports, update the **host** port (left side):
```yaml
backend:
  ports:
    - "8001:5001"  # Access backend on port 8001

frontend:
  ports:
    - "8000:3001"  # Access frontend on port 8000
```

## Checking Port Availability

### Windows PowerShell
```powershell
# Check if port is in use
netstat -ano | findstr :3001
netstat -ano | findstr :5001

# Kill process using port (if needed)
# First find the PID from netstat output, then:
taskkill /PID <PID_NUMBER> /F
```

### Linux/Mac
```bash
# Check if port is in use
lsof -i :3001
lsof -i :5001

# Kill process using port
lsof -ti:3001 | xargs kill -9
lsof -ti:5001 | xargs kill -9
```

## Firewall Configuration

If you need to access the application from other devices on your network:

### Windows Firewall
```powershell
# Allow inbound on port 3001
New-NetFirewallRule -DisplayName "KLIP Frontend" -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow

# Allow inbound on port 5001
New-NetFirewallRule -DisplayName "KLIP Backend" -Direction Inbound -LocalPort 5001 -Protocol TCP -Action Allow
```

### Linux (ufw)
```bash
sudo ufw allow 3001/tcp
sudo ufw allow 5001/tcp
```

## Production Ports

In production, you typically use:

- **HTTP**: Port 80
- **HTTPS**: Port 443

With a reverse proxy (Nginx), you would:
1. Run frontend on 3001 internally
2. Run backend on 5001 internally
3. Expose ports 80/443 externally
4. Nginx proxies to internal ports

## Environment-Specific Ports

### Development
- Frontend: 3001
- Backend: 5001

### Staging
- Frontend: 3001 (or 4001)
- Backend: 5001 (or 4001)

### Production
- Frontend: 80/443 (via reverse proxy)
- Backend: 5001 (internal only, not exposed)

## Troubleshooting

### Error: Port already in use

**Symptom**: "Error: listen EADDRINUSE: address already in use :::3001"

**Solution**:
1. Check what's using the port (see commands above)
2. Kill the process, or
3. Change to a different port

### Error: Cannot connect to API

**Symptom**: Frontend shows API connection errors

**Solution**:
1. Verify backend is running on port 5001
2. Check `frontend/.env.local` has correct API URL
3. Ensure no firewall blocking
4. Test backend directly: `curl http://localhost:5001/health`

### Error: Connection refused

**Symptom**: "Connection refused" or "Network error"

**Solution**:
1. Ensure backend is started
2. Check backend logs for errors
3. Verify PostgreSQL is running
4. Test: `curl http://localhost:5001/health`

## Quick Reference

```
┌─────────────────────────────────────────┐
│         KLIP Port Configuration         │
├─────────────────────────────────────────┤
│                                         │
│  Frontend:     localhost:3001           │
│  Backend API:  localhost:5001           │
│  Database:     localhost:5432           │
│                                         │
│  Access URLs:                           │
│  • App:        http://localhost:3001    │
│  • API Docs:   http://localhost:5001/   │
│                api-docs                 │
│  • Health:     http://localhost:5001/   │
│                health                   │
│                                         │
└─────────────────────────────────────────┘
```

## Summary

✅ **Frontend runs on port 3001** (changed from 3000)
✅ **Backend runs on port 5001** (changed from 5000)
✅ **Database stays on port 5432** (PostgreSQL default)
✅ **No conflicts with your existing apps**

All configuration files have been updated to reflect these new ports!

