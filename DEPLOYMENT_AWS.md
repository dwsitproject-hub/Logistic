# AWS Cloud Deployment Guide for KLIP

This guide walks you through deploying the KPN Logistics Intelligence Platform (KLIP) to AWS Cloud.

## Architecture Overview

```
Internet
  ↓
CloudFront / ALB (HTTPS)
  ↓
┌─────────────────────────────────┐
│   EC2 / ECS Cluster             │
│  ┌─────────────┐  ┌────────────┐│
│  │  Frontend   │  │  Backend   ││
│  │ (Next.js)   │  │ (Node.js)  ││
│  └─────────────┘  └────────────┘│
└─────────────────────────────────┘
  ↓
┌─────────────────────────────────┐
│      RDS PostgreSQL             │
│    (Managed Database)            │
└─────────────────────────────────┘
  ↓
┌─────────────────────────────────┐
│   S3 Bucket (File Storage)     │
└─────────────────────────────────┘
```

## Deployment Options

### Option 1: AWS ECS with Fargate (Recommended)

**Pros:**
- Fully managed container orchestration
- Auto-scaling
- High availability
- Pay only for what you use

**Steps:**

1. **Prepare Docker Images**

   ```bash
   # Build and tag images
   docker build -t klip-backend:latest ./backend
   docker build -t klip-frontend:latest ./frontend
   
   # Create ECR repositories
   aws ecr create-repository --repository-name klip-backend
   aws ecr create-repository --repository-name klip-frontend
   
   # Get login token and login
   aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com
   
   # Tag and push images
   docker tag klip-backend:latest <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/klip-backend:latest
   docker tag klip-frontend:latest <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/klip-frontend:latest
   
   docker push <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/klip-backend:latest
   docker push <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/klip-frontend:latest
   ```

2. **Create Task Definitions**

   See `ecs-task-definition.json` for backend and frontend configurations.

3. **Create ECS Cluster**

   ```bash
   aws ecs create-cluster --cluster-name klip-cluster
   ```

4. **Deploy Services**

   ```bash
   # Create backend service
   aws ecs create-service \
     --cluster klip-cluster \
     --service-name klip-backend \
     --task-definition klip-backend \
     --desired-count 2 \
     --launch-type FARGATE \
     --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=ENABLED}"
   
   # Create frontend service
   aws ecs create-service \
     --cluster klip-cluster \
     --service-name klip-frontend \
     --task-definition klip-frontend \
     --desired-count 2 \
     --launch-type FARGATE \
     --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=ENABLED}"
   ```

### Option 2: EC2 Instance with Docker

**Steps:**

1. **Launch EC2 Instance**

   - AMI: Amazon Linux 2
   - Instance Type: t3.medium or larger
   - Security Group: Allow ports 22, 80, 443, 5001, 3001, 5432

2. **Install Docker on EC2**

   ```bash
   sudo yum update -y
   sudo amazon-linux-extras install docker
   sudo service docker start
   sudo usermod -a -G docker ec2-user
   sudo chkconfig docker on
   
   # Install Docker Compose
   sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
   sudo chmod +x /usr/local/bin/docker-compose
   ```

3. **Deploy Application**

   ```bash
   # Clone repository
   git clone <your-repo-url> klip
   cd klip
   
   # Create .env file
   cp .env.example .env
   nano .env  # Edit with your values
   
   # Deploy
   docker-compose up -d
   
   # Initialize database
   docker exec klip-backend npm run db:migrate
   docker exec klip-backend npm run db:seed
   ```

4. **Configure Nginx (Reverse Proxy)**

   ```nginx
   upstream backend {
       server localhost:5001;
   }
   
   upstream frontend {
       server localhost:3001;
   }
   
   server {
       listen 80;
       server_name your-domain.com;
       
       location /api {
           proxy_pass http://backend;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
       
       location / {
           proxy_pass http://frontend;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

### Option 3: AWS App Runner (Simplest)

**Steps:**

1. Create Dockerfile with optimizations
2. Push to ECR
3. Create App Runner service
4. Configure environment variables
5. Deploy

## Required AWS Services

### 1. RDS PostgreSQL

```bash
aws rds create-db-instance \
  --db-instance-identifier klip-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --master-username admin \
  --master-user-password <your-password> \
  --allocated-storage 20 \
  --vpc-security-group-ids sg-xxx \
  --db-subnet-group-name klip-db-subnet-group
```

### 2. S3 Bucket for File Storage

```bash
aws s3 mb s3://klip-storage
aws s3api put-bucket-versioning \
  --bucket klip-storage \
  --versioning-configuration Status=Enabled
```

### 3. CloudFront Distribution (CDN)

```bash
aws cloudfront create-distribution \
  --origin-domain-name your-alb-endpoint \
  --default-root-object index.html
```

### 4. Route 53 Domain (Optional)

```bash
aws route53 create-hosted-zone --name your-domain.com --caller-reference $(date +%s)
```

## Environment Variables for AWS

Create `.env.aws`:

```env
# Database (RDS)
DB_HOST=klip-db.region.rds.amazonaws.com
DB_PORT=5432
DB_NAME=klip_db
DB_USER=admin
DB_PASSWORD=<your-secure-password>

# Application
NODE_ENV=production
PORT=5001
JWT_SECRET=<your-super-secure-jwt-secret>

# Frontend
NEXT_PUBLIC_API_URL=https://your-domain.com/api

# AWS
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=<your-aws-access-key>
AWS_SECRET_ACCESS_KEY=<your-aws-secret-key>
AWS_S3_BUCKET=klip-storage
```

## Security Best Practices

### 1. Security Groups

**Backend/ECS Security Group:**
- Inbound: 5001 from ALB only
- Outbound: 5432 to RDS, HTTPS to S3, HTTPS to internet

**Frontend/ECS Security Group:**
- Inbound: 3001 from ALB only
- Outbound: HTTPS to internet

**RDS Security Group:**
- Inbound: 5432 from Backend ECS security group
- Outbound: None

### 2. IAM Roles

Create IAM role for EC2/ECS with policies:
- AmazonEC2ContainerRegistryFullAccess
- AmazonRDSFullAccess
- AmazonS3FullAccess
- CloudWatchLogsFullAccess

### 3. SSL/TLS Certificates

Use AWS Certificate Manager (ACM) for HTTPS:

```bash
aws acm request-certificate \
  --domain-name your-domain.com \
  --validation-method DNS
```

### 4. Secrets Management

Use AWS Secrets Manager for sensitive data:

```bash
aws secretsmanager create-secret \
  --name klip/database/credentials \
  --secret-string '{"username":"admin","password":"secure-password"}'
```

## Monitoring and Logging

### CloudWatch Logs

Configure log groups:

```bash
aws logs create-log-group --log-group-name /klip/backend
aws logs create-log-group --log-group-name /klip/frontend
```

### CloudWatch Alarms

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name klip-high-cpu \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2
```

## Backup and Disaster Recovery

### Database Backups

```bash
aws rds create-db-snapshot \
  --db-instance-identifier klip-db \
  --db-snapshot-identifier klip-db-snapshot-$(date +%Y%m%d)
```

### S3 Backups

```bash
aws s3 sync /local/uploads s3://klip-storage/uploads
```

## Cost Optimization

- Use t3.micro instances for development
- Enable RDS automated backups retention
- Use S3 lifecycle policies for old files
- Enable CloudFront caching
- Monitor costs with AWS Cost Explorer

## Deployment Checklist

- [ ] RDS instance created and configured
- [ ] Security groups configured
- [ ] IAM roles and policies set up
- [ ] SSL certificates obtained
- [ ] Docker images pushed to ECR
- [ ] Environment variables configured
- [ ] Database migrations run
- [ ] Backup strategy implemented
- [ ] Monitoring and alerts configured
- [ ] Domain DNS configured
- [ ] Load balancer configured
- [ ] Auto-scaling configured
- [ ] Log rotation configured

## Troubleshooting

### Check Logs

```bash
# ECS logs
aws logs tail /klip/backend --follow
aws logs tail /klip/frontend --follow

# EC2 logs
docker-compose logs -f backend frontend
```

### SSH into ECS Task

```bash
aws ecs execute-command \
  --cluster klip-cluster \
  --task <task-id> \
  --container klip-backend \
  --command "/bin/sh" \
  --interactive
```

## Next Steps

1. Complete deployment
2. Run database migrations
3. Seed initial data
4. Configure monitoring
5. Set up automated backups
6. Enable auto-scaling
7. Configure load balancing
8. Test failover scenarios
9. Document runbook procedures
10. Schedule regular backups

## Support

For issues or questions:
- Check logs: `aws logs describe-log-streams --log-group-name /klip/backend`
- Review CloudWatch metrics
- Check AWS Health Dashboard
- Contact AWS Support

