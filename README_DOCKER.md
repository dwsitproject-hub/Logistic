# 🐳 KLIP Docker Deployment

This document provides complete instructions for deploying KLIP (KPN Logistics Intelligence Platform) using Docker for production and AWS deployment.

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Production Deployment](#production-deployment)
- [Development Mode](#development-mode)
- [AWS Deployment](#aws-deployment)
- [Configuration](#configuration)
- [Maintenance](#maintenance)
- [Troubleshooting](#troubleshooting)

## 🚀 Quick Start

### Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- At least 4GB RAM
- 10GB free disk space

### Production Deployment

```bash
# 1. Clone the repository
cd "D:\Cursor\Logistic SAP"

# 2. Copy environment file
cp .env.example .env

# 3. Edit .env with production values
nano .env  # Edit JWT_SECRET, DB_PASSWORD, etc.

# 4. Run deployment script
# On Windows:
.\deploy.ps1

# On Linux/Mac:
./deploy.sh

# 5. Access the application
# Frontend: http://localhost:3001
# Backend:  http://localhost:5001
# API Docs: http://localhost:5001/api-docs
```

## 🏭 Production Deployment

### Manual Deployment

```bash
# 1. Set environment variables
cp .env.example .env
# Edit .env with your production values

# 2. Build and start services
docker-compose up -d --build

# 3. Initialize database (first time only)
docker exec klip-backend npm run db:migrate
docker exec klip-backend npm run db:seed

# 4. View logs
docker-compose logs -f
```

### Environment Variables

Key variables to configure in `.env`:

```env
# Database
DB_NAME=klip_db
DB_USER=postgres
DB_PASSWORD=your-strong-password  # CHANGE THIS!

# Application
NODE_ENV=production
JWT_SECRET=your-super-secure-random-string  # CHANGE THIS!
JWT_EXPIRES_IN=7d

# Ports
FRONTEND_PORT=3001
BACKEND_PORT=5001
POSTGRES_PORT=5432
```

## 🔧 Development Mode

For local development with hot reload:

```bash
# Start development environment
docker-compose -f docker-compose.dev.yml up -d

# Or with rebuild
docker-compose -f docker-compose.dev.yml up -d --build

# View logs
docker-compose -f docker-compose.dev.yml logs -f
```

## ☁️ AWS Deployment

See [DEPLOYMENT_AWS.md](DEPLOYMENT_AWS.md) for detailed AWS deployment instructions.

### Quick AWS Setup

1. **Prerequisites**
   - AWS CLI configured
   - ECR repositories created
   - RDS PostgreSQL instance
   - Security groups configured

2. **Build and Push Images**

```bash
# Build images
docker build -t klip-backend:latest ./backend
docker build -t klip-frontend:latest ./frontend

# Push to ECR
aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com

docker tag klip-backend:latest <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/klip-backend:latest
docker tag klip-frontend:latest <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/klip-frontend:latest

docker push <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/klip-backend:latest
docker push <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/klip-frontend:latest
```

3. **Deploy to ECS**

```bash
# Update task definitions with new image URIs
aws ecs update-service --cluster klip-cluster --service klip-backend --force-new-deployment
aws ecs update-service --cluster klip-cluster --service klip-frontend --force-new-deployment
```

## ⚙️ Configuration

### Docker Compose Files

- **docker-compose.yml** - Production configuration
- **docker-compose.dev.yml** - Development with hot reload
- **docker-compose.aws.yml** - AWS-specific configuration

### Dockerfiles

- **backend/Dockerfile** - Production multi-stage build
- **backend/Dockerfile.dev** - Development with nodemon
- **frontend/Dockerfile** - Production Next.js standalone
- **frontend/Dockerfile.dev** - Development with hot reload

## 🔄 Maintenance

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
```

### Database Backup

```bash
# Backup
docker exec klip-postgres pg_dump -U postgres klip_db > backup_$(date +%Y%m%d).sql

# Restore
cat backup.sql | docker exec -i klip-postgres psql -U postgres klip_db
```

### Update Application

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose up -d --build

# Run migrations if needed
docker exec klip-backend npm run db:migrate
```

### Stop Services

```bash
# Stop without removing volumes
docker-compose down

# Stop and remove volumes (⚠️ deletes data)
docker-compose down -v
```

## 🐛 Troubleshooting

### Services Won't Start

```bash
# Check logs
docker-compose logs backend frontend postgres

# Check disk space
docker system df

# Check Docker status
docker info
```

### Database Connection Errors

```bash
# Check database health
docker exec klip-postgres pg_isready -U postgres

# Check database logs
docker-compose logs postgres

# Check backend logs for connection errors
docker-compose logs backend | grep -i "database\|connection"
```

### Port Already in Use

```bash
# Check what's using the port
# Windows:
netstat -ano | findstr :5001

# Linux/Mac:
lsof -i :5001

# Update port in .env
FRONTEND_PORT=3002
BACKEND_PORT=5002
```

### Out of Memory

```bash
# Clean up Docker
docker system prune -a

# Increase Docker memory limit in Docker Desktop settings
# Docker Desktop > Settings > Resources > Advanced
```

### Container Health Checks Failing

```bash
# Check container status
docker-compose ps

# Manually test health endpoint
curl http://localhost:5001/health

# Restart unhealthy service
docker-compose restart backend
```

## 📊 Monitoring

### Container Statistics

```bash
# Real-time stats
docker stats

# For specific services
docker stats klip-backend klip-frontend klip-postgres
```

### Health Checks

```bash
# Backend health
curl http://localhost:5001/health

# Check all services
docker-compose ps
```

## 🔐 Security Checklist

- [ ] Changed default database password
- [ ] Generated strong JWT_SECRET
- [ ] Configured CORS for production domains
- [ ] Set up SSL/TLS certificates
- [ ] Configured firewall rules
- [ ] Enabled database backups
- [ ] Set up log rotation
- [ ] Configured resource limits
- [ ] Used secrets management (AWS Secrets Manager)
- [ ] Regular security updates

## 📚 Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Reference](https://docs.docker.com/compose/)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [AWS ECS Guide](https://aws.amazon.com/ecs/)
- [Full Deployment Guide](DOCKER.md)
- [AWS Deployment Guide](DEPLOYMENT_AWS.md)

## 🆘 Support

For issues or questions:
- Check logs: `docker-compose logs -f`
- Review documentation in this directory
- Check CloudWatch metrics (for AWS deployment)
- Contact support team

