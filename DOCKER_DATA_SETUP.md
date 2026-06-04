# 🔄 Docker Development - Data Access

## ✅ Solution Applied

Your Docker backend is now configured to connect to your **host PostgreSQL database** instead of the Docker container database.

This means:
- ✅ All your existing data is accessible
- ✅ Database is running on your local machine (port 5432)
- ✅ Docker backend connects to host database via `host.docker.internal`
- ✅ Frontend is running in Docker with hot reload
- ✅ Backend is running in Docker with hot reload

## 🎯 Current Setup

```
┌─────────────────────────────────────┐
│  Docker Containers                  │
│  ┌──────────────┐  ┌──────────────┐ │
│  │  Frontend    │  │  Backend     │ │
│  │  (Port 3001) │→ │  (Port 5001) │ │
│  └──────────────┘  └──────────────┘ │
│                         ↓            │
└─────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────┐
│  Host PostgreSQL                    │
│  (Port 5432)                        │
│  - All your existing data 📊       │
└─────────────────────────────────────┘
```

## 📝 Database Connection

- **Type**: External (host PostgreSQL)
- **Host**: `host.docker.internal` (from Docker)
- **Port**: 5432
- **Database**: klip_db
- **Username**: postgres
- **Password**: postgres123

## 🔍 Verify Data Access

### Option 1: Check in Application
1. Go to http://localhost:3001/login
2. Login with `admin` / `admin123`
3. Check the Dashboard and other pages
4. Your existing data should be visible

### Option 2: Verify via Database
Connect to your host PostgreSQL:
```powershell
# Check how many records exist
psql -U postgres -d klip_db -c "SELECT COUNT(*) FROM contracts;"
psql -U postgres -d klip_db -c "SELECT COUNT(*) FROM shipments;"
```

## 🔄 Switching Between Docker DB and Host DB

### Use Host Database (Current Setup)
```yaml
# docker-compose.dev.yml
backend:
  environment:
    DB_HOST: host.docker.internal  # ← Connection to host PostgreSQL
    DB_PORT: 5432
```

### Use Docker Database
```yaml
# docker-compose.dev.yml
backend:
  environment:
    DB_HOST: postgres              # ← Connection to Docker PostgreSQL
    DB_PORT: 5432
```

Then:
```powershell
docker-compose -f docker-compose.dev.yml down
docker-compose -f docker-compose.dev.yml up -d
```

## 📊 Services Status

| Service | Location | Database | Port |
|---------|----------|----------|------|
| Frontend | Docker | N/A | 3001 |
| Backend | Docker | Host PostgreSQL | 5001 |
| PostgreSQL | Host | Local Machine | 5432 |

## 🛠️ Development Workflow

### Make Code Changes
- Edit files in `backend/src/` → Auto-restart
- Edit files in `frontend/src/` → Auto-refresh

### View Data Changes
- Changes made in Docker app affect host PostgreSQL
- All existing data remains intact
- New data added is also accessible outside Docker

### Database Access
From outside Docker:
```powershell
psql -U postgres -d klip_db
```

From inside Docker:
```powershell
docker exec -it klip-backend-dev psql -h host.docker.internal -U postgres -d klip_db
```

## 🆘 Troubleshooting

### Backend Can't Connect to Host DB

Check if PostgreSQL is running on host:
```powershell
Get-Service -Name postgresql*
```

If not running:
```powershell
net start postgresql-x64-14  # Or your PostgreSQL service name
```

### Still See Empty Data

1. Restart backend:
   ```powershell
   docker-compose -f docker-compose.dev.yml restart backend
   ```

2. Clear browser cache and refresh:
   ```powershell
   # In browser: Ctrl + Shift + Delete
   ```

3. Check backend logs:
   ```powershell
   docker-compose -f docker-compose.dev.yml logs backend
   ```

## 🎉 Benefits of This Setup

✅ **Preserves Your Data**: All existing data remains intact  
✅ **Hot Reload**: Automatic code reload in Docker  
✅ **Development Flexibility**: Easy to switch between databases  
✅ **Unified Database**: One database for all environments  
✅ **Data Safety**: No risk of losing data when stopping Docker

## 📚 Quick Commands

```powershell
# View backend logs
docker-compose -f docker-compose.dev.yml logs backend -f

# Restart backend
docker-compose -f docker-compose.dev.yml restart backend

# Check database connection
docker exec klip-backend-dev psql -h host.docker.internal -U postgres -d klip_db -c "\dt"

# View all services
docker-compose -f docker-compose.dev.yml ps
```

