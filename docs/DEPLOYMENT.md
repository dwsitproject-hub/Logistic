# KLIP – Comprehensive Deployment Guide

This guide covers **Docker-based deployment** of KLIP (KPN Logistics Intelligence Platform): database, backend API, frontend, and Nginx reverse proxy. The example topology uses **AliCloud** with the IPs you provided; the same steps apply to other clouds or on-premises with different IPs.

---

## Table of contents

1. [Architecture overview](#1-architecture-overview)
2. [Staging / production deployment with Docker](#2-staging-deployment-with-docker)

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

## 2. Staging deployment with Docker

This section gives **detailed steps** to run the app on two servers using **Docker**:

- **Backend server (172.28.92.57)**: PostgreSQL + Backend API in Docker.
- **Frontend server (172.28.92.56)**: Next.js in Docker; Nginx on the host proxies `/` to the frontend container and `/api/` to the backend server.

No Node.js or PM2 is required on the servers; only Docker and Docker Compose.

### 2.1 Architecture (Docker staging)

```
                    Internet
                        │
                        ▼
              ┌─────────────────────┐
              │  Frontend server     │
              │  172.28.92.56        │
              │  Public: 8.215.6.189 │
              │  Nginx :80 / :443    │
              └──────────┬──────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               │
   ┌──────────────┐  /api → backend      │
   │ Docker:      │  (proxy to           │
   │ Next.js :3001│  172.28.92.57:5001)  │
   └──────────────┘                      │
                                         │
              ┌──────────────────────────┘
              │  Backend server 172.28.92.57
              ▼
   ┌─────────────────────────────────────┐
   │  Docker: postgres :5432 + backend :5001
   └─────────────────────────────────────┘
```

- **Frontend server**: Nginx listens on 80/443; `/` → `127.0.0.1:3001` (frontend container); `/api/` → `http://172.28.92.57:5001`.
- **Backend server**: `docker-compose.backend.yml` runs Postgres and the backend; backend runs migrations on startup. No Nginx on this server.

### 2.2 Prerequisites (Docker staging)

| Where | Requirement |
|-------|-------------|
| Both servers | Docker Engine 20.10+ and Docker Compose v2 |
| Frontend server only | Nginx (for reverse proxy and optional SSL) |

Install Docker and Docker Compose (example for Ubuntu/Aliyun):

```bash
# Docker
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod 644 /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add your user to docker group (optional, to run without sudo)
sudo usermod -aG docker $USER
# Log out and back in for group to take effect

# Verify
docker --version
docker compose version
```

On the **frontend server**, install Nginx if not already present:

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

### 2.3 Backend server (172.28.92.57) – step-by-step

1. **Clone the repository** (if not already):

   ```bash
   cd /opt
   sudo mkdir -p klip && sudo chown $USER:$USER klip
   git clone https://github.com/jerrypra0906/Logistic.git klip
   cd klip
   ```

2. **Create `.env` in the project root** (same directory as `docker-compose.backend.yml`):

   ```bash
   nano .env
   ```

   Example (set strong values for staging/production):

   ```env
   DB_NAME=klip_db
   DB_USER=postgres
   DB_PASSWORD=your_secure_postgres_password
   POSTGRES_PORT=5432
   BACKEND_PORT=5001
   JWT_SECRET=your_jwt_secret_at_least_32_characters_long
   ```

   Save and exit.

3. **Start PostgreSQL and the backend** (migrations run automatically when the backend container starts):

   ```bash
   cd /opt/klip
   docker compose -f docker-compose.backend.yml up -d --build
   ```

4. **Check that containers are running**:

   ```bash
   docker compose -f docker-compose.backend.yml ps
   ```

   You should see `klip-postgres` and `klip-backend` with status “Up”. Backend health:

   ```bash
   curl -s http://localhost:5001/health
   ```

5. **Firewall**: Allow inbound TCP **5001** from the frontend server only (e.g. 172.28.92.56). Example with `ufw`:

   ```bash
   sudo ufw allow from 172.28.92.56 to any port 5001
   sudo ufw reload
   ```

6. **Optional – bind backend to a specific IP**: By default the backend listens on all interfaces (0.0.0.0). If you want it only on the private IP, you would need to set `PORT` and use a custom command or override in the compose file; for most cases the default is fine and firewall restricts access.

Backend server is done. The frontend server will call `http://172.28.92.57:5001` for API requests (via Nginx proxy).

### 2.4 Frontend server (172.28.92.56) – step-by-step

1. **Clone the repository** (if not already):

   ```bash
   cd /opt
   sudo mkdir -p klip && sudo chown $USER:$USER klip
   git clone https://github.com/jerrypra0906/Logistic.git klip
   cd klip
   ```

2. **Create `.env` in the project root** (same directory as `docker-compose.frontend.yml`):

   ```bash
   nano .env
   ```

   For staging with Nginx proxying `/api` to the backend, the **browser** must send API requests to the same origin (e.g. `http://8.215.6.189/api`). So set:

   ```env
   NEXT_PUBLIC_API_URL=/api
   FRONTEND_PORT=3001
   ```

   Save and exit. **Important**: `NEXT_PUBLIC_API_URL` is baked into the frontend at **build** time. Use `/api` so the browser uses the same host as the page and Nginx can proxy to the backend.

3. **Build and start the frontend container**:

   ```bash
   cd /opt/klip
   docker compose -f docker-compose.frontend.yml up -d --build
   ```

   The first run may take a few minutes (npm install and Next.js build). Subsequent starts are fast.

4. **Check that the container is running**:

   ```bash
   docker compose -f docker-compose.frontend.yml ps
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001
   ```

   You should get `200`.

5. **Configure Nginx** on the frontend server so that:
   - `/` is proxied to the **frontend container** at `127.0.0.1:3001`.
   - `/api/` is proxied to the **backend server** at `http://172.28.92.57:5001/api/`.

   Follow these steps on the **frontend server** (172.28.92.56).

   **Step 5a – Ensure Nginx is installed**

   ```bash
   sudo apt-get update
   sudo apt-get install -y nginx
   nginx -v
   ```

   **Step 5b – Create the site configuration file**

   Create a new file for the KLIP site (sites-available is the standard place; enabling is done later with a symlink):

   ```bash
   sudo nano /etc/nginx/sites-available/klip
   ```

   Paste the configuration below. Adjust `server_name` if you use a domain instead of the IP (e.g. `klip.example.com`). Replace `172.28.92.57` only if your backend runs on a different host.

   **Important:** In `location /` use `proxy_pass http://klip_frontend;` and in `location /api/` use `proxy_pass http://klip_backend/api/;`. Do **not** put `http://172.28.92.56` or `http://172.28.92.57` in `proxy_pass` — that would use port 80 instead of 3001 (frontend) and 5001 (backend) and cause 502 or 400 errors.

   ```nginx
   # Upstream: frontend container (Next.js) on this server
   upstream klip_frontend {
       server 127.0.0.1:3001;
       keepalive 64;
   }

   # Upstream: backend API on the other server
   upstream klip_backend {
       server 172.28.92.57:5001;
       keepalive 32;
   }

   server {
       listen 80;
       server_name 8.215.6.189 localhost 127.0.0.1;   # public IP + local so curl http://localhost works

       add_header X-Frame-Options "SAMEORIGIN" always;
       add_header X-Content-Type-Options "nosniff" always;

       # Next.js can send large response headers; avoid "upstream sent too big header"
       proxy_buffer_size 128k;
       proxy_buffers 4 256k;
       proxy_busy_buffers_size 256k;
       proxy_temp_file_write_size 256k;

       # All non-/api requests → Next.js (frontend container on port 3001)
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

       # /api/* → backend server
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
   }
   ```

   Save and exit (in nano: `Ctrl+O`, Enter, then `Ctrl+X`).

   **Step 5c – Enable the site**

   Enable the KLIP site by creating a symlink in `sites-enabled` (Debian/Ubuntu style):

   ```bash
   sudo ln -sf /etc/nginx/sites-available/klip /etc/nginx/sites-enabled/
   ```

   If a default site is enabled and you want only KLIP on port 80, remove it:

   ```bash
   sudo rm -f /etc/nginx/sites-enabled/default
   ```

   **Step 5d – Test the Nginx configuration**

   Run the built-in test so you don’t load a broken config:

   ```bash
   sudo nginx -t
   ```

   You should see: `syntax is ok` and `test is successful`. If not, fix the reported errors in `/etc/nginx/sites-available/klip` and run `sudo nginx -t` again.

   **Step 5e – Reload Nginx**

   Apply the new config without dropping existing connections:

   ```bash
   sudo systemctl reload nginx
   ```

   Check that Nginx is running:

   ```bash
   sudo systemctl status nginx
   ```

   **Step 5f – Verify in the browser and from the server**

   - In a browser: open **http://8.215.6.189** (or your domain). You should see the KLIP login page.
   - From the frontend server: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost/api/health` should return `200`, and the response body can be checked with `curl -s http://localhost/api/health`. If `http://localhost` returns **502**, ensure `server_name` in the KLIP config includes `localhost` and `127.0.0.1` (see Step 5b), then `sudo nginx -t` and `sudo systemctl reload nginx`.

   If the app or API doesn’t load, check: (1) frontend container is up: `docker compose -f docker-compose.frontend.yml ps`; (2) backend is reachable: `curl -s http://172.28.92.57:5001/health` from the frontend server; (3) Nginx error log: `sudo tail -50 /var/log/nginx/error.log`.

   **504 Gateway Time-out on /api/health or other /api/* URLs** — Nginx is proxying but the backend (172.28.92.57:5001) is not responding in time. On the **backend server** (172.28.92.57): (1) Ensure the backend container is running: `docker compose -f docker-compose.backend.yml ps`. (2) Allow the frontend server to reach port 5001: `sudo ufw allow from 172.28.92.56 to any port 5001` and `sudo ufw reload`. (3) From the frontend server test: `curl -s -o /dev/null -w "%{http_code}\n" http://172.28.92.57:5001/health` should return 200. If that works, then http://8.215.6.189/api/health should work after a backend deploy that includes the `/api/health` route.

   **502 and "upstream sent too big header"** — Next.js often sends large response headers. Add to your KLIP `server` or `location /` block: `proxy_buffer_size 128k;`, `proxy_buffers 4 256k;`, `proxy_busy_buffers_size 256k;`, `proxy_temp_file_write_size 256k;` (see Step 5b config above), then `sudo nginx -t` and `sudo systemctl reload nginx`. If the error log shows **upstream: "http://...:80/"** (port 80), the frontend upstream is wrong: it must be **127.0.0.1:3001**. Edit `/etc/nginx/sites-available/klip` and set `upstream klip_frontend { server 127.0.0.1:3001; }`; disable or fix any other server block that proxies to port 80 on this host (e.g. remove `default` from sites-enabled if it conflicts).

   **"Site can't be reached" from your laptop**

   If the browser shows *This site can't be reached* when you open the site from your laptop (while it works with `curl http://localhost` on the server), the request from the internet is not reaching the server. Work through this checklist:

   1. **Use the correct public IP** — In **AliCloud Console** go to **ECS** → **Instances**, find your **frontend** instance (e.g. StagingdwsFront), and note its **Public IP** (it may not be 8.215.6.189). In the browser open **http://&lt;that-public-IP&gt;** (never use 172.28.92.56 from the laptop; that is private and only works inside the VPC).

   2. **Security group for the frontend instance** — Open that instance → **Security Groups** tab → click the security group ID. Under **Inbound**, ensure there is a rule: **Port 80**, **Protocol TCP**, **Source** `0.0.0.0/0` (or your IP). Apply to the **frontend** instance’s security group; a rule on another instance does not help.

   3. **From your laptop, run** `curl -v --connect-timeout 10 http://<public-IP>` (replace with the real public IP).  
     - **Connection timed out** → Traffic is blocked before reaching the server (recheck security group and that you used the frontend instance’s public IP).  
     - **Connection refused** → Port 80 is reachable but nothing is listening (on the server run `sudo ss -tlnp | grep :80`; Nginx should be there).  
     - **HTTP/1.1 200** or HTML output → The site is reachable; try the same URL in the browser again.

   4. **Server firewall (UFW)** — If the cloud security group allows 80 but the laptop still times out, UFW on the server may be blocking it. On the frontend server run `sudo ufw status`. You must see **80** in the "To" column with "ALLOW IN" from "Anywhere". If port 80 is missing, run `sudo ufw allow 80/tcp` and `sudo ufw reload`. Then try from the laptop again.

6. **Firewall**: Allow inbound **80** (and **443** if you add SSL) on the frontend server’s public IP. Port 3001 does not need to be exposed to the internet (Nginx proxies to it on localhost).

### 2.5 Verify staging (Docker)

- From a browser: **http://8.215.6.189** → KLIP login/dashboard.
- **http://8.215.6.189/api/health** → backend health JSON (via Nginx → backend server).
- Log in and use the app; all API calls go to `/api` and are proxied to the backend container on 172.28.92.57.

### 2.6 Updates and rollback (Docker staging)

**Backend server (172.28.92.57):**

```bash
cd /opt/klip
git pull
docker compose -f docker-compose.backend.yml up -d --build
```

New migrations run automatically when the backend container starts. To see logs: `docker compose -f docker-compose.backend.yml logs -f backend`.

**Frontend server (172.28.92.56):**

Because `NEXT_PUBLIC_API_URL` is fixed at build time, you must rebuild the image after pulling:

```bash
cd /opt/klip
git pull
docker compose -f docker-compose.frontend.yml up -d --build
```

**Rollback:** Check out the previous commit (e.g. `git checkout <tag>`) and run the same `docker compose ... up -d --build` on each server. Data in the Postgres volume on the backend server is preserved unless you remove the volume.

**Backup (backend server):** Postgres data is in the Docker volume `postgres_data`. To backup:

```bash
docker compose -f docker-compose.backend.yml exec postgres pg_dump -U postgres klip_db > backup_$(date +%Y%m%d).sql
```

---

## 3. Prerequisites

### 3.1 On both application servers (frontend and backend)

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

### 3.2 On the frontend server only

| Requirement | Purpose |
|-------------|---------|
| Nginx | Reverse proxy, optional SSL termination |

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

### 3.3 On the backend server only

- No extra system packages required beyond Node.js and network access to PostgreSQL.

### 3.4 Optional (recommended for production)

| Tool | Purpose |
|------|---------|
| PM2 | Process manager for Node (restart on crash, logs) |
| Certbot | Free SSL certificates (Let’s Encrypt) |

```bash
sudo npm install -g pm2
# Certbot (Ubuntu/Debian):
sudo apt-get install -y certbot python3-certbot-nginx
```

### 3.5 Database

- **PostgreSQL 14+** (AliCloud RDS PostgreSQL or self-managed).
- A dedicated database and user for KLIP (e.g. `klip_db` / `klip_user`).

---

## 4. Network topology (AliCloud example)

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

## 5. Database setup

You can use either **AliCloud RDS PostgreSQL** or a **self-managed PostgreSQL** instance. The application does **not** create tables automatically at runtime – all schema changes are applied by the migration tool in `backend`.

### 5.1 Create database and user

#### 5.1.1 Self‑managed PostgreSQL (Linux VM)

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

#### 5.1.2 AliCloud RDS PostgreSQL

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

### 5.2 Run migrations (from backend server)

Migrations are executed from the **backend** host (172.28.92.57). They read SQL files from `backend/src/database/migrations/` and record what has been applied in the `schema_migrations` table.\n+\n+1. **Configure backend DB env** on the backend host (`backend/.env`), see [section 6.2](#62-environment-variables).\n+2. **Install dependencies and build once** (if you haven’t already):\n+\n+   ```bash\n+   cd /path/to/klip/backend\n+   npm ci\n+   npm run build\n+   ```\n+\n+3. **Run migrations**:\n+\n+   ```bash\n+   cd /path/to/klip/backend\n+   npm run db:migrate\n+   ```\n+\n+   Behind the scenes this will:\n+\n+   - Ensure the `schema_migrations` table exists (and the `pgcrypto` extension).\n+   - Discover all `*.sql` files in `src/database/migrations/`, sorted by filename (e.g. `001_initial_schema.sql`, `003_create_vessel_loading_ports.sql`, ..., `015_backfill_vessel_loading_ports_from_shipments.sql`).\n+   - Skip any migration whose filename is already recorded in `schema_migrations`.\n+   - Execute each **new** migration inside a transaction and then insert its filename into `schema_migrations`.\n+\n+4. **Verify the schema** (from any SQL client):\n+\n+   ```sql\n+   \\dt          -- list tables (contracts, shipments, vessel_loading_ports, ...)\n+   SELECT * FROM schema_migrations ORDER BY applied_at;\n+   ```\n+\n+If `npm run db:migrate` fails, fix the problem (e.g. wrong DB_HOST/credentials, missing permissions) and run the same command again; already-applied filenames are skipped, so rerunning is safe.\n+\n+### 4.3 Seed data (optional, usually only for dev/staging)\n+\n+The seed script inserts example data for local development and **should not** normally be run on production.\n+\n+From the backend directory:\n+\n+```bash\n+npm run db:seed\n+```\n+\n+Run this **only** on:\n+\n+- Developer laptops (local Docker/Postgres), or\n+- A non-production environment (staging/sandbox) where sample contracts/shipments are useful.\n+

---

## 6. Backend deployment

### 6.1 Clone and install (on 172.28.92.57)

```bash
cd /opt   # or your preferred path
sudo mkdir -p klip && sudo chown $USER:$USER klip
git clone <your-klip-repo-url> klip
cd klip/backend
npm ci
npm run build
```

### 6.2 Environment variables

Create `backend/.env` (do not commit this file):

```env
# Server
PORT=5001
NODE_ENV=production

# Database (use your actual RDS or DB host)
DB_HOST=your-postgres-host.rds.aliyuncs.com
DB_PORT=5433
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

### 6.3 Run migrations

```bash
cd /opt/klip/backend
npm run db:migrate
```

### 6.4 Start the backend

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

## 7. Frontend deployment

### 7.1 Clone and install (on 172.28.92.56)

```bash
cd /opt/klip
git clone <your-klip-repo-url> klip   # or git pull if already cloned
cd klip/frontend
npm ci
```

### 7.2 Environment variables for production

Create `frontend/.env.production`:

```env
# Use relative path so the browser sends API requests to the same origin;
# Nginx will proxy /api to the backend.
NEXT_PUBLIC_API_URL=/api
```

Do **not** put the backend’s private IP here; the browser cannot reach it. Using `/api` keeps same-origin requests; Nginx proxies them to `172.28.92.57:5001`.

### 7.3 Build and start

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

## 8. Reverse proxy (Nginx)

Nginx runs on the **frontend** server (172.28.92.56 / 8.215.6.189). It serves the Next.js app and proxies `/api` to the backend.

### 8.1 Site configuration

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

### 8.2 Verifying

- From the internet: `http://8.215.6.189` → Next.js UI.
- `http://8.215.6.189/api/health` → backend health response.
- Login and use the app; all API calls go to `/api` and are proxied to the backend.

---

## 9. Process management (PM2)

### 9.1 Backend (on 172.28.92.57)

```bash
cd /opt/klip/backend
pm2 start dist/server.js --name klip-backend
pm2 save
pm2 startup
```

### 9.2 Frontend (on 172.28.92.56)

```bash
cd /opt/klip/frontend
pm2 start npm --name klip-frontend -- start
pm2 save
pm2 startup
```

### 9.3 Useful commands

```bash
pm2 list
pm2 logs klip-backend
pm2 logs klip-frontend
pm2 restart klip-backend
pm2 restart klip-frontend
pm2 monit
```

---

## 10. SSL/HTTPS (optional)

For HTTPS on the public IP (or a domain pointing to 8.215.6.189):

### 10.1 Install Certbot

```bash
sudo apt-get install -y certbot python3-certbot-nginx
```

### 10.2 Obtain certificate

If you have a domain (e.g. `klip.example.com`) pointing to 8.215.6.189:

```bash
sudo certbot --nginx -d klip.example.com
```

Certbot will adjust your Nginx config and set up HTTPS. For a certificate bound only to an IP, you would need another approach (e.g. a cloud load balancer with a certificate).

### 10.3 Nginx HTTPS server block (manual alternative)

After you have certificates (e.g. under `/etc/letsencrypt/live/klip.example.com/`):

```nginx
server {
    listen 443 ssl http2;
    server_name klip.example.com;

    ssl_certificate     /etc/letsencrypt/live/klip.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/klip.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Same location blocks as in section 8.1 (/, /api/, etc.)
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

## 11. Security and firewall

### 11.1 Frontend server (172.28.92.56)

- Allow inbound: 80 (HTTP), 443 (HTTPS). Restrict source IPs if possible.
- Port 3001: bind Next.js to `127.0.0.1` only (default with `next start`), so no firewall rule needed for 3001 from the internet.

### 11.2 Backend server (172.28.92.57)

- Allow inbound TCP 5001 only from the frontend server (e.g. 172.28.92.56) or from the VPC CIDR.
- Do not expose 5001 to the public internet.

### 11.3 Database

- Allow PostgreSQL (5432) only from the backend server (172.28.92.57) or your VPC.

### 11.4 Application

- Keep `JWT_SECRET` and `DB_PASSWORD` in `.env` only; never commit them.
- Use strong passwords and rotate them periodically.
- Keep Node and OS updated.

---

## 12. Health checks and troubleshooting

### 12.1 Backend health

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

### 12.2 Frontend

Open in a browser: `http://8.215.6.189` (or your domain). You should see the KLIP login/dashboard.

### 12.3 Database connectivity (from backend)

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

### 12.4 Common issues

| Symptom | What to check |
|--------|----------------|
| 502 Bad Gateway (Nginx) | Backend not running or not reachable: `curl http://172.28.92.57:5001/api/health` from frontend host. Restart backend (e.g. `pm2 restart klip-backend`). |
| API calls fail / CORS | Ensure `NEXT_PUBLIC_API_URL=/api` and Nginx proxies `/api/` to the backend. Browser must call same origin (`/api`), not the backend IP. |
| Login fails | Check JWT_SECRET is set and identical if you have multiple backend instances. Check backend logs: `pm2 logs klip-backend`. |
| DB connection errors | Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and that the DB allows connections from 172.28.92.57. |
| Migrations fail | Ensure DB user has rights on `public` schema and that `pgcrypto` extension can be created. Run migrations from the backend server with correct `.env`. |

### 12.5 Logs

- Backend: `pm2 logs klip-backend` or log files if you configured file transport in the app.
- Frontend: `pm2 logs klip-frontend`
- Nginx: `sudo tail -f /var/log/nginx/access.log` and `error.log`

---

## 13. Updates and rollback

### 13.1 Deploying a new version

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

### 13.2 Rollback

- Restore the previous commit (e.g. `git checkout <previous-tag>`), then run the same steps (install, build, restart).
- Database: migrations are additive; there is no automatic “down” script. Rollback of data changes would require a backup restore or manual SQL if you keep rollback scripts.

### 13.3 Backup before major changes

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
