# 🐳 Quick Start - Docker Development Environment

## ✅ Current Status

Your Docker development environment is running with all services:

| Service | URL |
|---------|-----|
| **Frontend** | http://localhost:3001 |
| **Backend** | http://localhost:5001 |
| **API Docs** | http://localhost:5001/api-docs |

## 🚀 Quick Access

### Option 1: Direct Login Page
Go directly to: **http://localhost:3001/login**

This bypasses the root redirect and loads the login page immediately.

### Option 2: Root Page
Visit: **http://localhost:3001**

This will automatically redirect you to `/login` if not authenticated.

## 🎯 First Steps

1. **Access the login page**: http://localhost:3001/login
2. **Login with default credentials**:
   - Username: `admin`
   - Password: `admin123` (or your configured password)
3. **You'll be redirected to the dashboard**

## 🐛 If Still Loading

### Clear Browser Cache
- Press `Ctrl + Shift + Delete`
- Select "Cached images and files"
- Click "Clear data"

### Hard Refresh
- Press `Ctrl + F5` (or `Cmd + Shift + R` on Mac)

### Check Container Status
```powershell
docker-compose -f docker-compose.dev.yml ps
```

All containers should show "Up" status.

### View Logs
```powershell
# Frontend logs
docker-compose -f docker-compose.dev.yml logs frontend -f

# Backend logs  
docker-compose -f docker-compose.dev.yml logs backend -f
```

### Restart Frontend
```powershell
docker-compose -f docker-compose.dev.yml restart frontend
```

## 🔧 Hot Reload Verification

Changes you make to files will automatically reload:

### Backend Changes
Edit any file in `backend/src/`:
- File automatically triggers nodemon restart
- Check logs: `docker-compose -f docker-compose.dev.yml logs backend -f`

### Frontend Changes
Edit any file in `frontend/src/`:
- Page automatically refreshes in browser
- Check logs: `docker-compose -f docker-compose.dev.yml logs frontend -f`

## 📝 Management Commands

### Start Services
```powershell
docker-compose -f docker-compose.dev.yml up -d
```

### Stop Services
```powershell
docker-compose -f docker-compose.dev.yml down
```

### View All Logs
```powershell
docker-compose -f docker-compose.dev.yml logs -f
```

### Restart Service
```powershell
docker-compose -f docker-compose.dev.yml restart [service-name]
```

## 🎉 Next Steps

1. Access http://localhost:3001/login
2. Login with admin credentials
3. Start developing with hot reload
4. Make changes and see them instantly!

## 📚 Full Documentation

For complete setup guide, see: [DOCKER_DEV_SETUP.md](DOCKER_DEV_SETUP.md)

