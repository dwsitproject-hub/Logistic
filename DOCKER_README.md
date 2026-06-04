# Docker Deployment Guide

This guide will help you deploy KLIP (KPN Logistics Intelligence Platform) using Docker for production deployment.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- At least 4GB RAM available
- Internet connection for pulling images

## Quick Start

### 1. Clone and Navigate

```bash
cd "D:\Cursor\Logistic SAP"
```

### 2. Create Environment File

Copy `.env.example` to `.env` and update values:

```bash
cp .env.example .env
```

Edit `.env` with your production values, especially:
- `JWT_SECRET` - Generate a secure random string
- `DB_PASSWORD` - Use a strong password
- Database credentials

### 3. Build and Start Services

```bash
# Production mode
docker-compose up -d

# Or with build
docker-compose up -d --build

# Development mode
docker-compose -f docker-compose.dev.yml up -d
```

### 4. Access the Application

- **Frontend**: http://localhost:3001
- **Backend API**: http://localhost:5001
- **API Docs**: http://localhost:5001/api-docs
- **Health Check**: http://localhost:5001/health

### 5. Initialize Database (First Time Only)

```bash
# Run migrations
docker exec klip-backend npm run db:migrate

# Seed initial data
docker exec klip-backend npm run db:seed
```

## Service Management

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f postgres
```

### Stop Services

```bash
docker-compose down
```

### Stop and Remove Volumes (⚠️ Deletes Data)

```bash
docker-compose down -v
```

### Restart Services

```bash
docker-compose restart
```

### Update Services

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker-compose up -d --build
```

## Production Considerations

### Environment Variables

Update `.env` for production:

```env
NODE_ENV=production
JWT_SECRET=<generate-a-strong-random-string>
DB_PASSWORD=<strong-password>
```

### Security Checklist

- [ ] Change default database password
- [ ] Generate strong JWT_SECRET
- [ ] Configure proper CORS origins
- [ ] Set up SSL/TLS certificates
- [ ] Configure firewall rules
- [ ] Enable database backups
- [ ] Set up log rotation
- [ ] Configure resource limits

### Resource Limits

Add to `docker-compose.yml` services:

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
```

## AWS Deployment

### 1. Using ECS with Fargate

See `DEPLOYMENT_AWS.md` for detailed AWS ECS deployment instructions.

### 2. Using EC2 with Docker

```bash
# On EC2 instance
sudo yum install docker -y
sudo systemctl start docker
sudo systemctl enable docker

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Clone and deploy
git clone <your-repo>
cd <repo-name>
cp .env.example .env
# Edit .env with production values
docker-compose up -d
```

### 3. Using AWS RDS for PostgreSQL

Update `.env`:

```env
DB_HOST=your-rds-endpoint.region.rds.amazonaws.com
DB_PORT=5432
DB_NAME=klip_db
DB_USER=your-rds-user
DB_PASSWORD=your-rds-password
```

Remove postgres service from `docker-compose.yml`:

```yaml
# Remove this service when using RDS
# postgres:
#   ...
```

### 4. Using AWS S3 for File Storage

Update backend to use S3:

1. Install AWS SDK:
```bash
npm install aws-sdk
```

2. Create S3 service
3. Update upload endpoints to use S3
4. Configure IAM roles with S3 permissions

## Backups

### Database Backup

```bash
# Backup
docker exec klip-postgres pg_dump -U postgres klip_db > backup.sql

# Restore
cat backup.sql | docker exec -i klip-postgres psql -U postgres klip_db
```

### Automated Backups

Create `backup.sh`:

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker exec klip-postgres pg_dump -U postgres klip_db > backup_$DATE.sql
# Upload to S3 or other storage
aws s3 cp backup_$DATE.sql s3://your-backup-bucket/
```

## Monitoring

### Health Checks

All services have health checks configured:

```bash
# Check service health
docker-compose ps

# Test health endpoints
curl http://localhost:5001/health
curl http://localhost:3001/api/health
```

### Resource Usage

```bash
# Container stats
docker stats

# Service-specific
docker stats klip-backend klip-frontend klip-postgres
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose logs [service-name]

# Check resource usage
docker stats

# Restart
docker-compose restart [service-name]
```

### Database Connection Issues

```bash
# Check database status
docker exec klip-postgres pg_isready -U postgres

# Check connection logs
docker-compose logs postgres
```

### Port Already in Use

Update ports in `.env`:

```env
FRONTEND_PORT=3002
BACKEND_PORT=5002
```

### Out of Disk Space

```bash
# Clean up unused images
docker system prune -a

# Clean up volumes
docker volume prune
```

## Development vs Production

| Feature | Development | Production |
|---------|------------|------------|
| Dockerfile | `Dockerfile.dev` | `Dockerfile` |
| Hot Reload | ✅ Enabled | ❌ Disabled |
| Source Mount | ✅ Yes | ❌ No |
| Optimization | ❌ None | ✅ Full |
| Logging | Verbose | Production-level |

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Reference](https://docs.docker.com/compose/)
- [Next.js Docker Deployment](https://nextjs.org/docs/deployment#docker-image)
- [AWS ECS Deployment](https://aws.amazon.com/ecs/)

