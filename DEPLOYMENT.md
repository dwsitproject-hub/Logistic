# KLIP Deployment Guide

## Deployment Options

### Option 1: Docker Deployment (Recommended)

#### Prerequisites
- Docker
- Docker Compose

#### Steps

1. **Build and start containers**:
   ```bash
   docker-compose up -d
   ```

2. **Check status**:
   ```bash
   docker-compose ps
   ```

3. **View logs**:
   ```bash
   docker-compose logs -f
   ```

4. **Stop containers**:
   ```bash
   docker-compose down
   ```

#### Services
- **postgres**: PostgreSQL database on port 5432
- **backend**: Node.js API on port 5000
- **frontend**: Next.js web app on port 3000

---

### Option 2: Cloud Deployment

#### AWS Deployment

**Architecture**:
```
Route 53 (DNS)
    ↓
CloudFront (CDN)
    ↓
ALB (Load Balancer)
    ↓
┌─────────────┬─────────────────┐
│             │                 │
EC2/ECS       RDS PostgreSQL   S3
(Backend)     (Database)        (Files)
    ↓
CloudWatch (Monitoring)
```

**Services Needed**:
- **Frontend**: AWS Amplify or S3 + CloudFront
- **Backend**: EC2 or ECS (Fargate)
- **Database**: RDS PostgreSQL
- **Storage**: S3 for file uploads
- **Secrets**: AWS Secrets Manager
- **Monitoring**: CloudWatch

**Steps**:

1. **Database (RDS)**:
   ```bash
   # Create PostgreSQL RDS instance
   - Engine: PostgreSQL 14
   - Instance class: db.t3.medium
   - Storage: 20GB
   - Enable automated backups
   ```

2. **Backend (EC2/ECS)**:
   ```bash
   # Create EC2 instance or ECS service
   - Install Node.js 18
   - Clone repository
   - Set environment variables
   - Install dependencies
   - Build and start
   ```

3. **Frontend (Amplify)**:
   ```bash
   # Connect GitHub repository
   - Build command: npm run build
   - Start command: npm start
   - Environment variables: NEXT_PUBLIC_API_URL
   ```

#### Azure Deployment

**Services Needed**:
- **Frontend**: Azure Static Web Apps or App Service
- **Backend**: Azure App Service
- **Database**: Azure Database for PostgreSQL
- **Storage**: Azure Blob Storage
- **Secrets**: Azure Key Vault

**Steps**:

1. **Create Resource Group**
2. **Create Azure Database for PostgreSQL**
3. **Create App Service for Backend**
4. **Deploy Frontend to Static Web Apps**
5. **Configure Application Settings**

#### DigitalOcean Deployment

**Services Needed**:
- **Droplet**: Ubuntu server
- **Managed Database**: PostgreSQL
- **Spaces**: Object storage
- **Load Balancer**: Optional

**Steps**:

1. **Create Managed PostgreSQL Database**
2. **Create Droplet** (Ubuntu 22.04)
3. **Install Dependencies**:
   ```bash
   # Update system
   sudo apt update && sudo apt upgrade -y
   
   # Install Node.js 18
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt install -y nodejs
   
   # Install PM2
   sudo npm install -g pm2
   ```

4. **Deploy Application**:
   ```bash
   # Clone repository
   git clone <repo-url>
   cd klip
   
   # Install dependencies
   npm run install:all
   
   # Set up environment
   # Edit backend/.env with production values
   
   # Build
   npm run build
   
   # Start with PM2
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

---

### Option 3: Traditional VPS

#### Requirements
- Linux server (Ubuntu 22.04 recommended)
- Node.js 18+
- PostgreSQL 14+
- Nginx (reverse proxy)
- SSL certificate (Let's Encrypt)

#### Setup

1. **Update System**:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

2. **Install Node.js**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt install -y nodejs
   ```

3. **Install PostgreSQL**:
   ```bash
   sudo apt install postgresql postgresql-contrib
   sudo systemctl start postgresql
   sudo systemctl enable postgresql
   ```

4. **Create Database**:
   ```bash
   sudo -u postgres psql
   CREATE DATABASE klip_db;
   CREATE USER klip_user WITH ENCRYPTED PASSWORD 'secure_password';
   GRANT ALL PRIVILEGES ON DATABASE klip_db TO klip_user;
   \q
   ```

5. **Clone and Setup Application**:
   ```bash
   git clone <repo-url>
   cd klip
   npm run install:all
   ```

6. **Configure Environment**:
   ```bash
   # Edit backend/.env
   nano backend/.env
   
   # Edit frontend/.env.local
   nano frontend/.env.local
   ```

7. **Initialize Database**:
   ```bash
   cd backend
   npm run db:migrate
   npm run db:seed
   cd ..
   ```

8. **Install PM2** (Process Manager):
   ```bash
   sudo npm install -g pm2
   ```

9. **Create PM2 Ecosystem**:

Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [
    {
      name: 'klip-backend',
      cwd: './backend',
      script: 'dist/server.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'klip-frontend',
      cwd: './frontend',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      instances: 1,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
```

10. **Build and Start**:
    ```bash
    npm run build
    pm2 start ecosystem.config.js
    pm2 save
    pm2 startup
    ```

11. **Install Nginx**:
    ```bash
    sudo apt install nginx
    ```

12. **Configure Nginx**:

Create `/etc/nginx/sites-available/klip`:
```nginx
# Backend API
server {
    listen 80;
    server_name api.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

# Frontend
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

13. **Enable Site**:
    ```bash
    sudo ln -s /etc/nginx/sites-available/klip /etc/nginx/sites-enabled/
    sudo nginx -t
    sudo systemctl restart nginx
    ```

14. **Install SSL** (Let's Encrypt):
    ```bash
    sudo apt install certbot python3-certbot-nginx
    sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
    sudo certbot --nginx -d api.yourdomain.com
    ```

15. **Configure Firewall**:
    ```bash
    sudo ufw allow 'Nginx Full'
    sudo ufw allow OpenSSH
    sudo ufw enable
    ```

---

## Environment Configuration

### Production Environment Variables

**Backend** (`backend/.env`):
```env
PORT=5000
NODE_ENV=production

# Use production database
DB_HOST=your-db-host.rds.amazonaws.com
DB_PORT=5432
DB_NAME=klip_production
DB_USER=klip_user
DB_PASSWORD=strong_production_password

# Strong JWT secret
JWT_SECRET=generate-a-very-strong-random-secret-here
JWT_EXPIRES_IN=7d

# Production file storage
UPLOAD_DIR=/var/app/uploads

# SAP Integration
SAP_API_URL=https://sap.yourcompany.com/odata/v2
SAP_USERNAME=sap_integration_user
SAP_PASSWORD=sap_password

# Email for alerts
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@yourcompany.com
SMTP_PASSWORD=email_password
SMTP_FROM=KLIP Alerts <noreply@yourcompany.com>
```

**Frontend** (`frontend/.env.local`):
```env
NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api
```

---

## Database Backup

### Automated Backups

Create a backup script `/opt/scripts/backup-klip.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/klip"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/klip_backup_$DATE.sql"

mkdir -p $BACKUP_DIR

# Backup database
pg_dump -h localhost -U postgres -d klip_db > $BACKUP_FILE

# Compress
gzip $BACKUP_FILE

# Delete backups older than 30 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_FILE.gz"
```

Make executable and add to cron:
```bash
chmod +x /opt/scripts/backup-klip.sh
crontab -e
# Add: 0 2 * * * /opt/scripts/backup-klip.sh
```

### Manual Backup

```bash
# Backup
pg_dump -U postgres -d klip_db > backup.sql

# Restore
psql -U postgres -d klip_db < backup.sql
```

---

## Monitoring

### PM2 Monitoring

```bash
# Monitor processes
pm2 monit

# View logs
pm2 logs

# Restart application
pm2 restart all

# Reload without downtime
pm2 reload all
```

### Log Monitoring

Backend logs location: `backend/logs/`

```bash
# Watch error log
tail -f backend/logs/error.log

# Watch combined log
tail -f backend/logs/combined.log
```

### Database Monitoring

```bash
# Check active connections
psql -U postgres -d klip_db -c "SELECT count(*) FROM pg_stat_activity;"

# Check database size
psql -U postgres -d klip_db -c "SELECT pg_database_size('klip_db');"
```

---

## Performance Optimization

### Backend

1. **Enable compression**:
   - Already configured in server.ts

2. **Database connection pooling**:
   - Configured in connection.ts (max 20)

3. **Add caching** (future):
   ```bash
   npm install redis
   # Implement Redis caching layer
   ```

### Frontend

1. **Image optimization**:
   - Use Next.js Image component
   - Configure image domains in next.config.js

2. **Code splitting**:
   - Already handled by Next.js

3. **CDN**:
   - Deploy frontend to Vercel or CloudFront

### Database

1. **Optimize queries**:
   ```sql
   -- Analyze query performance
   EXPLAIN ANALYZE SELECT * FROM contracts WHERE status = 'ACTIVE';
   ```

2. **Add indexes** as needed:
   ```sql
   CREATE INDEX idx_custom ON table_name(column_name);
   ```

---

## Security Checklist

- [ ] Change default JWT_SECRET
- [ ] Use strong database passwords
- [ ] Enable HTTPS/SSL
- [ ] Configure CORS properly
- [ ] Set up firewall rules
- [ ] Regular security updates
- [ ] Monitor audit logs
- [ ] Implement rate limiting
- [ ] Use environment variables for secrets
- [ ] Regular backups
- [ ] Database access restrictions
- [ ] API authentication enforced

---

## Rollback Procedure

If deployment fails:

1. **Database Rollback**:
   ```bash
   psql -U postgres -d klip_db < backup_previous.sql
   ```

2. **Application Rollback**:
   ```bash
   git checkout previous-version-tag
   npm run build
   pm2 restart all
   ```

3. **Verify**:
   - Check application health
   - Test critical functions
   - Monitor error logs

---

## Health Checks

### Application Health

```bash
# Check backend
curl http://localhost:5000/health

# Expected response
{"status":"OK","message":"KLIP Backend is running"}
```

### Database Health

```bash
psql -U postgres -d klip_db -c "SELECT 1;"
```

### Process Health

```bash
pm2 status
```

---

## Maintenance

### Regular Tasks

**Daily**:
- Monitor error logs
- Check disk space
- Verify backups completed

**Weekly**:
- Review audit logs
- Check system performance
- Update dependencies (dev environment first)

**Monthly**:
- Security updates
- Performance optimization
- Database maintenance (VACUUM, ANALYZE)
- Review and archive old logs

### Database Maintenance

```sql
-- Vacuum and analyze
VACUUM ANALYZE;

-- Check database bloat
SELECT schemaname, tablename, 
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Rebuild indexes
REINDEX DATABASE klip_db;
```

---

## Scaling

### Vertical Scaling

Increase server resources:
- CPU: 2+ cores recommended
- RAM: 8GB+ for production
- Storage: SSD recommended

### Horizontal Scaling

1. **Frontend**: Deploy multiple instances behind load balancer
2. **Backend**: Run multiple instances with PM2 cluster mode
3. **Database**: Use read replicas for read-heavy operations

---

## Monitoring Tools

### Recommended Tools

1. **Application Monitoring**:
   - PM2 Plus
   - New Relic
   - Datadog

2. **Database Monitoring**:
   - pgAdmin
   - CloudWatch (AWS)
   - Azure Monitor

3. **Log Management**:
   - ELK Stack (Elasticsearch, Logstash, Kibana)
   - CloudWatch Logs
   - Papertrail

4. **Uptime Monitoring**:
   - UptimeRobot
   - Pingdom
   - StatusCake

---

## Troubleshooting Deployment

### Issue: Cannot connect to database

**Solution**:
1. Check database is running
2. Verify connection string
3. Check firewall rules
4. Test with psql

### Issue: Frontend cannot reach backend

**Solution**:
1. Verify NEXT_PUBLIC_API_URL is correct
2. Check CORS settings
3. Ensure backend is running
4. Test API endpoint directly

### Issue: Out of memory

**Solution**:
1. Increase server RAM
2. Optimize database queries
3. Reduce PM2 instances
4. Add swap space

### Issue: Slow performance

**Solution**:
1. Check database query performance
2. Add database indexes
3. Enable caching
4. Use CDN for frontend
5. Optimize images

---

## Disaster Recovery

### Backup Strategy

1. **Database**: Daily automated backups (retained 30 days)
2. **Files**: Replicate to S3/Azure Blob
3. **Code**: Git repository (always up to date)
4. **Configuration**: Securely backed up .env files

### Recovery Steps

1. **Restore Database**:
   ```bash
   psql -U postgres -d klip_db < latest_backup.sql
   ```

2. **Restore Application**:
   ```bash
   git pull origin main
   npm run install:all
   npm run build
   pm2 restart all
   ```

3. **Restore Files**:
   ```bash
   aws s3 sync s3://backup-bucket/uploads ./backend/uploads
   ```

---

## Update Procedure

### Application Updates

1. **Backup current state**
2. **Pull latest code**:
   ```bash
   git pull origin main
   ```
3. **Install new dependencies**:
   ```bash
   npm run install:all
   ```
4. **Run migrations** (if any):
   ```bash
   cd backend && npm run db:migrate && cd ..
   ```
5. **Build**:
   ```bash
   npm run build
   ```
6. **Restart** (zero-downtime):
   ```bash
   pm2 reload all
   ```
7. **Verify** deployment
8. **Monitor** for errors

### Database Updates

1. **Backup database** first
2. **Test migration** in staging
3. **Run migration** in production
4. **Verify** data integrity
5. **Rollback** if issues occur

---

## Cost Estimation

### AWS Costs (Monthly)

- **EC2** (t3.medium): ~$30
- **RDS** (db.t3.medium): ~$50
- **S3**: ~$5
- **CloudFront**: ~$10
- **Data Transfer**: ~$10
**Total**: ~$105/month

### Azure Costs (Monthly)

- **App Service** (B2): ~$55
- **PostgreSQL** (Basic): ~$30
- **Blob Storage**: ~$5
**Total**: ~$90/month

### DigitalOcean Costs (Monthly)

- **Droplet** (4GB): ~$24
- **Managed PostgreSQL**: ~$15
- **Spaces**: ~$5
**Total**: ~$44/month

---

## Production Checklist

Before going live:

- [ ] All environment variables set correctly
- [ ] Database backed up
- [ ] SSL certificate installed
- [ ] Firewall configured
- [ ] Health checks working
- [ ] Monitoring configured
- [ ] Backups automated
- [ ] DNS configured
- [ ] Load testing completed
- [ ] Security audit performed
- [ ] Documentation updated
- [ ] Team trained on system
- [ ] Support procedures defined
- [ ] Rollback plan documented

---

## Support & Resources

- **AWS**: https://aws.amazon.com/documentation/
- **Azure**: https://docs.microsoft.com/azure/
- **DigitalOcean**: https://docs.digitalocean.com/
- **PM2**: https://pm2.keymetrics.io/docs/
- **Nginx**: https://nginx.org/en/docs/
- **PostgreSQL**: https://www.postgresql.org/docs/

---

Need help? Refer to the main README.md or contact the development team.

