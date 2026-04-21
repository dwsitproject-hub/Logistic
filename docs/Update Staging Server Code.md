### 2.6 Updates and rollback (Docker staging)

**Backend server (172.28.92.57):**

**Environment / database (read this if credentials or port “don’t match” `.env`):**

- **`docker-compose.backend.yml` forces the backend container to use `DB_HOST=postgres` and `DB_PORT=5432`** (the `klip-postgres` service on the Docker network). Values like `DB_HOST=127.0.0.1` / `DB_PORT=5433` in `backend/.env` apply to **Node or psql on the host**, not inside the backend container.
- **Compose substitutes `${DB_NAME}`, `${DB_USER}`, `${DB_PASSWORD}` for the Postgres container from a `.env` file in `/opt/klip/`** (next to the compose file), **not** only from `backend/.env`. If that file is missing, Postgres may still be created with the compose **defaults** (`postgres` / `postgres123`), while `backend/.env` had other credentials — they won’t match.
- **Fix:** From `/opt/klip`, copy `.env.example` to `.env`, set `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and keep `backend/.env` in sync (or symlink). After changing Postgres user/password on an **existing** volume, you may need to align roles in Postgres or recreate the volume (destructive).
- **Host access to Postgres** (psql, `ts-node` scripts): compose publishes `127.0.0.1:${POSTGRES_PORT:-5433}->5432`. Use `DB_HOST=127.0.0.1` and `DB_PORT=5433` (or your `POSTGRES_PORT`) in the shell when **not** using Docker for the app.

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