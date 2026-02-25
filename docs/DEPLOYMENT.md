# KLIP – Comprehensive Deployment Guide

This guide covers production deployment of KLIP (KPN Logistics Intelligence Platform) end-to-end: database, backend API, frontend, reverse proxy, process management, and optional SSL. The example topology uses **AliCloud** with the IPs you provided; the same steps apply to other clouds or on-premises with different IPs.

---

## Table of contents

1. [Architecture overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Network topology (AliCloud example)](#3-network-topology-alicloud-example)
4. [Database setup](#4-database-setup)
5. [Backend deployment](#5-backend-deployment)
6. [Frontend deployment](#6-frontend-deployment)
7. [Reverse proxy (Nginx)](#7-reverse-proxy-nginx)
8. [Process management (PM2)](#8-process-management-pm2)
9. [SSL/HTTPS (optional)](#9-sslhttps-optional)
10. [Security and firewall](#10-security-and-firewall)
11. [Health checks and troubleshooting](#11-health-checks-and-troubleshooting)
12. [Updates and rollback](#12-updates-and-rollback)

---

## 1. Architecture overview

```
                    Internet
                        │
                        ▼
              ┌─────────────────────┐
              │  Public IP           │
              │  8.215.6.189         │
              │  (Nginx :80 / :443)  │
              └──────────┬──────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
   ┌──────────┐   ┌──────────────┐   (future)
   │ /        │   │ /api/        │
   │ Next.js  │   │ → Backend    │
   │ :3001    │   │   :5001      │
   └──────────┘   └──────┬───────┘
         │               │
         │    Private    │    Private
         │  172.28.92.56 │  172.28.92.57
         │  (Frontend)   │  (Backend)
         │               │
         └───────────────┼───────────────────┐
                         │                   │
                         ▼                   ▼
                  ┌──────────────┐     ┌─────────────┐
                  │  PostgreSQL  │     │  (RDS/VPC)  │
                  │  (DB server) │     │             │
                  └──────────────┘     └─────────────┘
```

- **Frontend server**: Serves the Next.js app and runs Nginx. Browser requests to the public IP hit Nginx; `/` goes to Next.js, `/api/` is proxied to the backend.
- **Backend server**: Node.js API only; no public IP. Reachable from the frontend server over the private network.
- **Database**: PostgreSQL (e.g. AliCloud RDS or self-hosted) reachable from the backend.

---

## 2. Prerequisites

### 2.1 On both application servers (frontend and backend)

| Requirement | Version / notes |
|-------------|------------------|
| OS | Linux (e.g. Aliyun Linux, Ubuntu 20.04+) |
| Node.js | 18.x or 20.x LTS |
| npm | 9+ (comes with Node) |
| Git | To clone the repository |

Install Node.js (example for Aliyun/Ubuntu):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # v20.x
npm -v
```

### 2.2 On the frontend server only

| Requirement | Purpose |
|-------------|---------|
| Nginx | Reverse proxy, optional SSL termination |

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

### 2.3 On the backend server only

- No extra system packages required beyond Node.js and network access to PostgreSQL.

### 2.4 Optional (recommended for production)

| Tool | Purpose |
|------|---------|
| PM2 | Process manager for Node (restart on crash, logs) |
| Certbot | Free SSL certificates (Let’s Encrypt) |

```bash
sudo npm install -g pm2
# Certbot (Ubuntu/Debian):
sudo apt-get install -y certbot python3-certbot-nginx
```

### 2.5 Database

- **PostgreSQL 14+** (AliCloud RDS PostgreSQL or self-managed).
- A dedicated database and user for KLIP (e.g. `klip_db` / `klip_user`).

---

## 3. Network topology (AliCloud example)

| Role | Private IP | Public IP | Ports |
|------|------------|-----------|--------|
| Frontend + Nginx | 172.28.92.56 | 8.215.6.189 | 80, 443 (Nginx); 3001 (Next.js, localhost) |
| Backend API | 172.28.92.57 | — | 5001 (listen on 0.0.0.0 or 172.28.92.57) |
| PostgreSQL | (e.g. RDS endpoint) | — | 5432 |

Ensure:

- Frontend server can reach `172.28.92.57:5001` (same VPC).
- Backend server can reach the PostgreSQL host:5432.
- Security groups / firewall allow:
  - Inbound 80, 443 on the frontend’s public IP.
  - Inbound 5001 on the backend from the frontend private IP only (or VPC CIDR).

---

## 4. Database setup

You can use either **AliCloud RDS PostgreSQL** or a **self-managed PostgreSQL** instance. The application does **not** create tables automatically at runtime – all schema changes are applied by the migration tool in `backend`.

### 4.1 Create database and user

#### 4.1.1 Self‑managed PostgreSQL (Linux VM)

1. **Log in as postgres user** on the DB host:

   ```bash
   sudo -iu postgres
   psql
   ```

2. **Create app user and database** (adjust names/passwords for your environment):

   ```sql
   CREATE USER klip_user WITH PASSWORD 'your_secure_password';
   CREATE DATABASE klip_db OWNER klip_user;
   GRANT ALL PRIVILEGES ON DATABASE klip_db TO klip_user;
   \c klip_db
   GRANT ALL ON SCHEMA public TO klip_user;
   -- Required for migrations (uuid, etc.)
   CREATE EXTENSION IF NOT EXISTS "pgcrypto";
   ```

3. **Test from the backend server** (replace host/user/password as needed):

   ```bash
   psql \"postgresql://klip_user:your_secure_password@<db-host>:5432/klip_db\" -c \"SELECT 1;\"
   ```

#### 4.1.2 AliCloud RDS PostgreSQL

1. In the **AliCloud RDS console**:
   - Create a new **PostgreSQL instance** (or reuse an existing one).
   - Configure the VPC / security group so that the backend server IP `172.28.92.57` is allowed to connect on port **5432**.
2. Create a **database** (e.g. `klip_db`) and an **account** (e.g. `klip_user`) from the RDS UI and grant that account owner/DDL privileges on the database.\
   Exact clicks vary by console version, but typically:\
   *Databases → Create Database* and *Accounts → Create Account* → *Grant to Database*.
3. Enable the **`pgcrypto` extension** once (you can run this from any SQL client connected as a privileged account):

   ```sql
   \c klip_db
   CREATE EXTENSION IF NOT EXISTS \"pgcrypto\";
   ```

4. Note the connection details (you will put these into `backend/.env`):
   - Hostname (e.g. `pgm-xxxxxx.rds.aliyuncs.com`)
   - Port (`5432` by default)
   - Database name (`klip_db`)
   - Username / password (`klip_user` / password)

### 4.2 Run migrations (from backend server)

Migrations are executed from the **backend** host (172.28.92.57). They read SQL files from `backend/src/database/migrations/` and record what has been applied in the `schema_migrations` table.\n+\n+1. **Configure backend DB env** on the backend host (`backend/.env`), see [section 5.2](#52-environment-variables).\n+2. **Install dependencies and build once** (if you haven’t already):\n+\n+   ```bash\n+   cd /path/to/klip/backend\n+   npm ci\n+   npm run build\n+   ```\n+\n+3. **Run migrations**:\n+\n+   ```bash\n+   cd /path/to/klip/backend\n+   npm run db:migrate\n+   ```\n+\n+   Behind the scenes this will:\n+\n+   - Ensure the `schema_migrations` table exists (and the `pgcrypto` extension).\n+   - Discover all `*.sql` files in `src/database/migrations/`, sorted by filename (e.g. `001_initial_schema.sql`, `003_create_vessel_loading_ports.sql`, ..., `015_backfill_vessel_loading_ports_from_shipments.sql`).\n+   - Skip any migration whose filename is already recorded in `schema_migrations`.\n+   - Execute each **new** migration inside a transaction and then insert its filename into `schema_migrations`.\n+\n+4. **Verify the schema** (from any SQL client):\n+\n+   ```sql\n+   \\dt          -- list tables (contracts, shipments, vessel_loading_ports, ...)\n+   SELECT * FROM schema_migrations ORDER BY applied_at;\n+   ```\n+\n+If `npm run db:migrate` fails, fix the problem (e.g. wrong DB_HOST/credentials, missing permissions) and run the same command again; already-applied filenames are skipped, so rerunning is safe.\n+\n+### 4.3 Seed data (optional, usually only for dev/staging)\n+\n+The seed script inserts example data for local development and **should not** normally be run on production.\n+\n+From the backend directory:\n+\n+```bash\n+npm run db:seed\n+```\n+\n+Run this **only** on:\n+\n+- Developer laptops (local Docker/Postgres), or\n+- A non-production environment (staging/sandbox) where sample contracts/shipments are useful.\n+

---

## 5. Backend deployment

### 5.1 Clone and install (on 172.28.92.57)

```bash
cd /opt   # or your preferred path
sudo mkdir -p klip && sudo chown $USER:$USER klip
git clone <your-klip-repo-url> klip
cd klip/backend
npm ci
npm run build
```

### 5.2 Environment variables

Create `backend/.env` (do not commit this file):

```env
# Server
PORT=5001
NODE_ENV=production

# Database (use your actual RDS or DB host)
DB_HOST=your-postgres-host.rds.aliyuncs.com
DB_PORT=5432
DB_NAME=klip_db
DB_USER=klip_user
DB_PASSWORD=your_secure_password

# Auth (generate a long random string for production)
JWT_SECRET=your-jwt-secret-at-least-32-chars-long
JWT_EXPIRES_IN=1d
```

Important:

- `DB_HOST` can be an RDS endpoint or the private IP of your PostgreSQL server.
- `JWT_SECRET` must be strong and unique in production.

### 5.3 Run migrations

```bash
cd /opt/klip/backend
npm run db:migrate
```

### 5.4 Start the backend

**Option A – Direct (foreground):**

```bash
npm run start
# Listens on http://0.0.0.0:5001 (or PORT from .env)
```

**Option B – PM2 (recommended):**

```bash
pm2 start dist/server.js --name klip-backend
pm2 save
pm2 startup   # enable restart on reboot
```

Backend is now available at `http://172.28.92.57:5001` from the frontend server. Test from the frontend host:

```bash
curl -s http://172.28.92.57:5001/api/health
```

---

## 6. Frontend deployment

### 6.1 Clone and install (on 172.28.92.56)

```bash
cd /opt/klip
git clone <your-klip-repo-url> klip   # or git pull if already cloned
cd klip/frontend
npm ci
```

### 6.2 Environment variables for production

Create `frontend/.env.production`:

```env
# Use relative path so the browser sends API requests to the same origin;
# Nginx will proxy /api to the backend.
NEXT_PUBLIC_API_URL=/api
```

Do **not** put the backend’s private IP here; the browser cannot reach it. Using `/api` keeps same-origin requests; Nginx proxies them to `172.28.92.57:5001`.

### 6.3 Build and start

```bash
cd /opt/klip/frontend
npm run build
npm run start
# Next.js listens on http://localhost:3001
```

**With PM2:**

```bash
pm2 start npm --name klip-frontend -- start
pm2 save
pm2 startup
```

Frontend is now reachable on the frontend server at `http://127.0.0.1:3001`. External users will go through Nginx (next section).

---

## 7. Reverse proxy (Nginx)

Nginx runs on the **frontend** server (172.28.92.56 / 8.215.6.189). It serves the Next.js app and proxies `/api` to the backend.

### 7.1 Site configuration

Create a config file, e.g. `/etc/nginx/sites-available/klip` (or under `conf.d`):

```nginx
# Upstream for Next.js (optional but clear)
upstream klip_frontend {
    server 127.0.0.1:3001;
    keepalive 64;
}

# Backend API (private IP in VPC)
upstream klip_backend {
    server 172.28.92.57:5001;
    keepalive 32;
}

server {
    listen 80;
    server_name 8.215.6.189;   # or your domain, e.g. klip.example.com

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Frontend – Next.js
    location / {
        proxy_pass http://klip_frontend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API – proxy to private IP
    location /api/ {
        proxy_pass http://klip_backend/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        client_max_body_size 50M;
    }

    # Optional: health check endpoint
    location /api/health {
        proxy_pass http://klip_backend/api/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        access_log off;
    }
}
```

Enable and test:

```bash
sudo ln -s /etc/nginx/sites-available/klip /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 7.2 Verifying

- From the internet: `http://8.215.6.189` → Next.js UI.
- `http://8.215.6.189/api/health` → backend health response.
- Login and use the app; all API calls go to `/api` and are proxied to the backend.

---

## 8. Process management (PM2)

### 8.1 Backend (on 172.28.92.57)

```bash
cd /opt/klip/backend
pm2 start dist/server.js --name klip-backend
pm2 save
pm2 startup
```

### 8.2 Frontend (on 172.28.92.56)

```bash
cd /opt/klip/frontend
pm2 start npm --name klip-frontend -- start
pm2 save
pm2 startup
```

### 8.3 Useful commands

```bash
pm2 list
pm2 logs klip-backend
pm2 logs klip-frontend
pm2 restart klip-backend
pm2 restart klip-frontend
pm2 monit
```

---

## 9. SSL/HTTPS (optional)

For HTTPS on the public IP (or a domain pointing to 8.215.6.189):

### 9.1 Install Certbot

```bash
sudo apt-get install -y certbot python3-certbot-nginx
```

### 9.2 Obtain certificate

If you have a domain (e.g. `klip.example.com`) pointing to 8.215.6.189:

```bash
sudo certbot --nginx -d klip.example.com
```

Certbot will adjust your Nginx config and set up HTTPS. For a certificate bound only to an IP, you would need another approach (e.g. a cloud load balancer with a certificate).

### 9.3 Nginx HTTPS server block (manual alternative)

After you have certificates (e.g. under `/etc/letsencrypt/live/klip.example.com/`):

```nginx
server {
    listen 443 ssl http2;
    server_name klip.example.com;

    ssl_certificate     /etc/letsencrypt/live/klip.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/klip.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Same location blocks as in section 7.1 (/, /api/, etc.)
    location / {
        proxy_pass http://klip_frontend;
        # ... same proxy headers
    }
    location /api/ {
        proxy_pass http://klip_backend/api/;
        # ... same proxy headers
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name klip.example.com;
    return 301 https://$server_name$request_uri;
}
```

Then set in `frontend/.env.production`:

```env
NEXT_PUBLIC_API_URL=/api
```

(No change: the browser still uses relative `/api` on the same origin, which is now `https://klip.example.com`.)

---

## 10. Security and firewall

### 10.1 Frontend server (172.28.92.56)

- Allow inbound: 80 (HTTP), 443 (HTTPS). Restrict source IPs if possible.
- Port 3001: bind Next.js to `127.0.0.1` only (default with `next start`), so no firewall rule needed for 3001 from the internet.

### 10.2 Backend server (172.28.92.57)

- Allow inbound TCP 5001 only from the frontend server (e.g. 172.28.92.56) or from the VPC CIDR.
- Do not expose 5001 to the public internet.

### 10.3 Database

- Allow PostgreSQL (5432) only from the backend server (172.28.92.57) or your VPC.

### 10.4 Application

- Keep `JWT_SECRET` and `DB_PASSWORD` in `.env` only; never commit them.
- Use strong passwords and rotate them periodically.
- Keep Node and OS updated.

---

## 11. Health checks and troubleshooting

### 11.1 Backend health

From the backend server:

```bash
curl -s http://localhost:5001/api/health
```

From the frontend server (via Nginx):

```bash
curl -s http://127.0.0.1/api/health
# or
curl -s http://8.215.6.189/api/health
```

### 11.2 Frontend

Open in a browser: `http://8.215.6.189` (or your domain). You should see the KLIP login/dashboard.

### 11.3 Database connectivity (from backend)

```bash
cd /opt/klip/backend
node -e "
require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});
p.query('SELECT 1').then(() => { console.log('DB OK'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
"
```

### 11.4 Common issues

| Symptom | What to check |
|--------|----------------|
| 502 Bad Gateway (Nginx) | Backend not running or not reachable: `curl http://172.28.92.57:5001/api/health` from frontend host. Restart backend (e.g. `pm2 restart klip-backend`). |
| API calls fail / CORS | Ensure `NEXT_PUBLIC_API_URL=/api` and Nginx proxies `/api/` to the backend. Browser must call same origin (`/api`), not the backend IP. |
| Login fails | Check JWT_SECRET is set and identical if you have multiple backend instances. Check backend logs: `pm2 logs klip-backend`. |
| DB connection errors | Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and that the DB allows connections from 172.28.92.57. |
| Migrations fail | Ensure DB user has rights on `public` schema and that `pgcrypto` extension can be created. Run migrations from the backend server with correct `.env`. |

### 11.5 Logs

- Backend: `pm2 logs klip-backend` or log files if you configured file transport in the app.
- Frontend: `pm2 logs klip-frontend`
- Nginx: `sudo tail -f /var/log/nginx/access.log` and `error.log`

---

## 12. Updates and rollback

### 12.1 Deploying a new version

**Backend (172.28.92.57):**

```bash
cd /opt/klip
git pull
cd backend
npm ci
npm run build
npm run db:migrate   # if there are new migrations
pm2 restart klip-backend
```

**Frontend (172.28.92.56):**

```bash
cd /opt/klip
git pull
cd frontend
npm ci
npm run build
pm2 restart klip-frontend
```

If you use a single clone for both, do backend first, then frontend.

### 12.2 Rollback

- Restore the previous commit (e.g. `git checkout <previous-tag>`), then run the same steps (install, build, restart).
- Database: migrations are additive; there is no automatic “down” script. Rollback of data changes would require a backup restore or manual SQL if you keep rollback scripts.

### 12.3 Backup before major changes

- Database: use `pg_dump` or RDS snapshots before running new migrations or big releases.
- Keep a copy of the previous app version (e.g. a Git tag or tarball) so you can revert quickly.

---

## Quick reference – AliCloud IPs

| Component | Private IP | Public IP | URL / access |
|-----------|------------|-----------|--------------|
| Nginx + Next.js | 172.28.92.56 | 8.215.6.189 | http://8.215.6.189 (or your domain) |
| Backend API | 172.28.92.57 | — | Only via Nginx `/api` from frontend |
| PostgreSQL | (RDS or DB host) | — | From backend only |

For more detail on the app itself (scripts, local dev), see the main [README](../README.md).
