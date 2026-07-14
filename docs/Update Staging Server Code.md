### 2.6 Updates and rollback (Docker staging)

Staging runs on **three servers** (the database was separated off the backend host on 2026‑07‑14):

| Role | Private IP | Deploy dir | Compose file |
|------|-----------|-----------|--------------|
| Frontend (web) | 172.28.92.56 | `/opt/klip` | `docker-compose.frontend.yml` |
| Backend (API) | 172.28.92.57 | `/opt/klip` | `docker-compose.backend.yml` |
| Database (Postgres 14) | 172.28.92.60 (host port **5442**) | `/opt/klip-db` | `docker-compose.db.yml` |

The backend **no longer runs its own Postgres** — `docker-compose.backend.yml` connects to the
dedicated DB server at **172.28.92.60:5442**. Code deploys touch only the frontend and backend;
the DB server is left alone (see its section below).

---

**Backend server (172.28.92.57):**

**Environment / database (read this if credentials or port “don’t match” `.env`):**
The backend reads its DB connection from `/opt/klip/backend/.env` (or the `environment:` overrides
in `docker-compose.backend.yml`). After the DB move these must point at the remote DB server:

```
DB_HOST=172.28.92.60
DB_PORT=5442
DB_NAME=klip_db
DB_USER=postgres
DB_PASSWORD=…            # must match the DB server's POSTGRES_PASSWORD
```

Deploy:

```bash
cd /opt/klip
git pull
docker compose -f docker-compose.backend.yml up -d --build
```

Only the backend container is built/started now (Postgres is no longer part of this stack).
New migrations run automatically when the backend container starts, executed against the
**remote** DB at 172.28.92.60:5442. To see logs: `docker compose -f docker-compose.backend.yml logs -f backend`.

Verify it came up and connected to the DB:

```bash
docker compose -f docker-compose.backend.yml logs backend | grep -iE "migration|connect|error"
curl -s http://localhost:5001/health
```

If the backend can't reach the DB, check the DB server is up, the security group allows TCP 5442
from 172.28.92.57, and the env values above. Quick test from the backend host:
`nc -vz 172.28.92.60 5442` (expect “succeeded”).

---

**Frontend server (172.28.92.56):**

Because `NEXT_PUBLIC_API_URL` is fixed at build time, you must rebuild the image after pulling:

```bash
cd /opt/klip
git pull
docker compose -f docker-compose.frontend.yml up -d --build
```

---

**Database server (172.28.92.60) — NOT part of code deploys:**

Postgres 14 runs in Docker at `/opt/klip-db` (a shared staging DB box that also hosts other
projects' databases; KLIP's container is `klip-postgres`, published on `172.28.92.60:5442`).
A normal code release does **not** touch this server. Occasional ops:

```bash
cd /opt/klip-db
docker compose -f docker-compose.db.yml ps                  # status
docker logs klip-postgres | tail -20                        # health ("ready to accept connections")
docker compose -f docker-compose.db.yml restart postgres    # restart (rare; will briefly drop the app)
```

Manual backup (see also `docs/MOVE-DB-TO-SEPARATE-SERVER.md`):

```bash
mkdir -p /opt/klip-db/backups
docker exec klip-postgres pg_dump -U postgres -Fc klip_db > /opt/klip-db/backups/klip_$(date +%F).dump
```

Schema changes ship as **migrations in the app code** and are applied automatically by the backend
on startup — do not hand-edit the schema on this server.

---

**Rollback:**

- **App code (frontend or backend):** in `/opt/klip`, check out the previous known-good commit and
  re-run the matching build:
  ```bash
  cd /opt/klip
  git log --oneline -5            # find the previous good commit
  git checkout <sha>             # or: git reset --hard <sha>
  docker compose -f docker-compose.backend.yml up -d --build     # (or -f docker-compose.frontend.yml on the FE box)
  ```
  A rolled-back backend still runs any migrations already applied to the DB — migrations are
  forward-only, so a code rollback does **not** undo schema changes. If a migration must be
  reverted, do it deliberately with a new migration.
- **DB connectivity:** if a deploy breaks the backend↔DB link, confirm the DB container is up on
  172.28.92.60, the security group still allows TCP 5442 from 172.28.92.57, and `DB_HOST`/`DB_PORT`
  in the backend env are `172.28.92.60` / `5442`.
