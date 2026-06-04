# Running KLIP with Docker

This guide describes how to run the full KLIP stack (PostgreSQL, backend API, frontend) using Docker Compose.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) (v2 or later)

## Quick start

1. **Optional – create a `.env` file** in the project root to override defaults:

   ```env
   DB_NAME=klip_db
   DB_USER=postgres
   DB_PASSWORD=your_secure_password
   POSTGRES_PORT=5432
   BACKEND_PORT=5001
   FRONTEND_PORT=3001
   JWT_SECRET=your_jwt_secret_for_production
   NEXT_PUBLIC_API_URL=http://localhost:5001/api
   ```

   If you don’t create `.env`, Compose uses the defaults in `docker-compose.yml` (see comments at the top of that file).

2. **Build and start all services:**

   ```bash
   docker-compose up -d --build
   ```

3. **Open the app:**

   - Frontend: http://localhost:3001  
   - Backend API: http://localhost:5001/api  
   - Health: http://localhost:5001/health  

## What runs

- **postgres** – PostgreSQL 14. The schema is **not** loaded from `schema.sql`; it is created by the **backend migrations** when the backend container starts.
- **backend** – Node.js API. On startup it runs `node dist/database/migrate.js` (applying all migrations from `backend/src/database/migrations`), then starts the server. Needs a healthy Postgres.
- **frontend** – Next.js app (standalone). Build-time env `NEXT_PUBLIC_API_URL` must be the URL the **browser** uses to call the API (e.g. `http://localhost:5001/api` when everything is on the same host).

## Useful commands

```bash
# View logs
docker-compose logs -f

# Restart a service
docker-compose restart backend

# Stop everything
docker-compose down

# Stop and remove database volume (fresh DB)
docker-compose down -v
```

## Production notes

- Set strong `DB_PASSWORD` and `JWT_SECRET` in `.env` (or export them).
- For production, set `NEXT_PUBLIC_API_URL` to the public API base URL (e.g. `https://your-domain.com/api`) and put a reverse proxy (e.g. Nginx) in front of the frontend and backend. See [DEPLOYMENT.md](DEPLOYMENT.md) for a full production setup without Docker.
