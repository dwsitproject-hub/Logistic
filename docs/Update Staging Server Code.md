### 2.6 Updates and rollback (Docker staging)

Staging runs on **two app servers** plus **Aliyun RDS** (Postgres was moved off `172.28.92.60`):

| Role | Address | Deploy dir | Compose file |
|------|-----------|-----------|--------------|
| Frontend (web) | 172.28.92.56 | `/opt/klip` | `docker-compose.frontend.yml` |
| Backend (API) | 172.28.92.57 | `/opt/klip` | `docker-compose.backend.yml` + `docker-compose.backend.remote-db.yml` |
| Database | Aliyun RDS `pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com:5432` | (managed) | — |

The backend **does not run Postgres**. Code deploys touch only frontend and backend.

---

**Backend server (172.28.92.57):**

**Environment / database (read this if credentials or port “don’t match” `.env`):**
Compose interpolates `DB_HOST` / `DB_PORT` from **`/opt/klip/.env`** (not `backend/.env` alone). Set both files:

```
DB_HOST=pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com
DB_PORT=5432
DB_NAME=klip_db
DB_USER=postgres
DB_PASSWORD=…            # RDS password — do not commit
```

Deploy:

```bash
cd /opt/klip
git pull
bash docs/scripts/staging-deploy-backend.sh
```

New migrations run automatically when the backend container starts, against **RDS :5432**.

Verify:

```bash
docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml exec -T backend printenv DB_HOST DB_PORT
docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml logs backend | grep -iE "migration|connect|error"
curl -s http://localhost:5001/health
```

If the backend can't reach RDS, check security group / whitelist for `172.28.92.57` → RDS:5432:
`nc -vz pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com 5432`

---

**Frontend server (172.28.92.56):**

Because `NEXT_PUBLIC_API_URL` is fixed at build time, you must rebuild the image after pulling:

```bash
cd /opt/klip
git pull
docker compose -f docker-compose.frontend.yml up -d --build
```

---

**Database (Aliyun RDS) — NOT part of code deploys:**

KLIP SIT data lives on Aliyun RDS (`pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com:5432`).
A normal code release does **not** change RDS. Schema changes ship as **migrations in the app code**
and are applied automatically by the backend on startup.

The old VM `172.28.92.60:5442` is no longer the SIT app database.

---

**Rollback:**

- **App code (frontend or backend):** in `/opt/klip`, check out the previous known-good commit and
  re-run the matching build:
  ```bash
  cd /opt/klip
  git log --oneline -5            # find the previous good commit
  git checkout <sha>             # or: git reset --hard <sha>
  bash docs/scripts/staging-deploy-backend.sh     # backend .57
  docker compose -f docker-compose.frontend.yml up -d --build   # frontend .56
  ```
  A rolled-back backend still runs any migrations already applied to the DB — migrations are
  forward-only, so a code rollback does **not** undo schema changes. If a migration must be
  reverted, do it deliberately with a new migration.
- **DB connectivity:** if a deploy breaks the backend↔DB link, confirm RDS is reachable from
  `172.28.92.57` on TCP 5432, and `DB_HOST`/`DB_PORT` in `/opt/klip/.env` are the RDS hostname / `5432`.
