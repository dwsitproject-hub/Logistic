# 🐳 Docker Development Environment Setup

## ✅ Setup Complete!

Your KLIP application is now running in Docker development mode with hot reload enabled.

## 📊 Services Status

All services are running:

| Service | Container Name | Status | Ports | URL |
|---------|---------------|--------|-------|-----|
| **Frontend** | klip-frontend-dev | ✅ Running | 3001 | http://localhost:3001 |
| **Backend** | klip-backend-dev | ✅ Running | 5001 | http://localhost:5001 |
| **PostgreSQL** | klip-postgres-dev | ✅ Healthy | 5433 | localhost:5433 |

## 🚀 Access Points

- **Frontend Web App**: http://localhost:3001
- **Backend API**: http://localhost:5001
- **API Documentation**: http://localhost:5001/api-docs
- **Health Check**: http://localhost:5001/health

## 🛠️ Managing Docker Services

### View Logs

```powershell
# All services
docker-compose -f docker-compose.dev.yml logs -f

# Specific service
docker-compose -f docker-compose.dev.yml logs -f backend
docker-compose -f docker-compose.dev.yml logs -f frontend
docker-compose -f docker-compose.dev.yml logs -f postgres
```

### Stop Services

```powershell
docker-compose -f docker-compose.dev.yml down
```

### Restart Services

```powershell
docker-compose -f docker-compose.dev.yml restart
```

### Rebuild After Code Changes

```powershell
docker-compose -f docker-compose.dev.yml up -d --build
```

## 🔥 Hot Reload Features

### Backend Hot Reload
- Changes to `backend/src/**` automatically restart the backend
- Nodemon watches for TypeScript changes
- Logs are displayed in real-time

### Frontend Hot Reload
- Changes to `frontend/src/**` automatically refresh the browser
- Next.js Fast Refresh enabled
- Component state preserved on edits

## 📝 Development Workflow

### 1. Making Backend Changes

Edit files in `backend/src/`:
```
backend/src/
├── controllers/
├── services/
├── routes/
└── ...
```

Changes are automatically detected and the server restarts.

### 2. Making Frontend Changes

Edit files in `frontend/src/`:
```
frontend/src/
├── app/
├── components/
└── lib/
```

Browser automatically refreshes with changes.

### 3. Database Changes

To modify the database schema:

```powershell
# Access database container
docker exec -it klip-postgres-dev psql -U postgres -d klip_db

# Or run migrations
docker exec klip-backend-dev npm run db:migrate
```

## 🗄️ Database Access

### PostgreSQL Connection

- **Host**: localhost
- **Port**: 5433 (external), 5432 (internal)
- **Database**: klip_db
- **Username**: postgres
- **Password**: postgres123

### Connect via psql

```powershell
docker exec -it klip-postgres-dev psql -U postgres -d klip_db
```

### Connect via GUI (pgAdmin, DBeaver, etc.)

```
Host: localhost
Port: 5433
Database: klip_db
Username: postgres
Password: postgres123
```

## 🔍 Troubleshooting

### Container Won't Start

```powershell
# Check logs
docker-compose -f docker-compose.dev.yml logs

# Remove and recreate containers
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up -d
```

### Port Already in Use

```powershell
# Check what's using the port
netstat -ano | findstr :5001

# Change port in docker-compose.dev.yml
# Edit the ports mapping
```

### Frontend Not Connecting to Backend

Check environment variables in `docker-compose.dev.yml`:
```yaml
frontend:
  environment:
    NEXT_PUBLIC_API_URL: http://localhost:5001/api
```

### Database Connection Errors

```powershell
# Check database is running
docker ps | findstr postgres

# Check database logs
docker-compose -f docker-compose.dev.yml logs postgres

# Test connection
docker exec klip-postgres-dev pg_isready -U postgres
```

## 📂 Volume Mounts

### Backend Volumes
- `./backend/src` → `/app/src` (source code)
- `./backend/uploads` → `/app/uploads` (file uploads)
- `./backend/logs` → `/app/logs` (application logs)

### Frontend Volumes
- `./frontend/src` → `/app/src` (source code)
- `./frontend/public` → `/app/public` (static files)

### Database Volume
- `postgres_data_dev` → persistent database storage

## 🎯 Environment Configuration

Development environment variables in `docker-compose.dev.yml`:

```yaml
NODE_ENV: development
PORT: 5001
DB_HOST: postgres
DB_PORT: 5432
DB_NAME: klip_db
DB_USER: postgres
DB_PASSWORD: postgres123
JWT_SECRET: dev-secret-change-in-production
```

## 🧪 Testing

### Test Backend Health

```powershell
Invoke-WebRequest -Uri http://localhost:5001/health -UseBasicParsing
```

### Test Frontend

Open browser:
```
http://localhost:3001
```

### Test API Endpoint

```powershell
Invoke-WebRequest -Uri http://localhost:5001/api/auth/login -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"username":"admin","password":"admin123"}'
```

## 📊 Monitoring

### View Container Stats

```powershell
docker stats
```

### View Resource Usage

```powershell
docker stats klip-backend-dev klip-frontend-dev klip-postgres-dev
```

## 🔄 Hot Reload Verification

### Test Backend Hot Reload

1. Edit `backend/src/server.ts`
2. Add a console.log
3. Save the file
4. Check logs - nodemon should restart automatically

### Test Frontend Hot Reload

1. Edit `frontend/src/app/page.tsx`
2. Change some text
3. Save the file
4. Browser should refresh automatically

## 📚 Next Steps

1. **Make your first change**: Edit a file and watch it hot reload
2. **Access the application**: Open http://localhost:3001
3. **Check API docs**: Visit http://localhost:5001/api-docs
4. **Start coding**: Make changes and see them reflected immediately

## 🆘 Quick Commands Reference

```powershell
# Start services
docker-compose -f docker-compose.dev.yml up -d

# Stop services
docker-compose -f docker-compose.dev.yml down

# View logs
docker-compose -f docker-compose.dev.yml logs -f

# Restart a service
docker-compose -f docker-compose.dev.yml restart backend

# Rebuild images
docker-compose -f docker-compose.dev.yml up -d --build

# Check status
docker-compose -f docker-compose.dev.yml ps

# Access database
docker exec -it klip-postgres-dev psql -U postgres -d klip_db
```

## 🎉 Success!

Your Docker development environment is ready! You can now:

- ✅ Develop with hot reload
- ✅ Access the application
- ✅ Make changes and see them instantly
- ✅ Use the full development stack in containers

Happy coding! 🚀

