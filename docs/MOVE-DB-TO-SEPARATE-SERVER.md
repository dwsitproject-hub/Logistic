# Move KLIP Postgres off the staging BE server onto a dedicated DB server

**Goal:** relieve the shared 2‑vCPU backend host (`172.28.92.57`, "StagingdwsBack") by moving
`klip-postgres` to its own ECS instance. The backend keeps running on the BE server and
connects to the new DB over the private network.

**Strategy:** brief‑downtime logical dump/restore. For staging this is the right trade‑off —
a few minutes of downtime is fine, and it avoids the complexity of logical replication.
Expected total downtime: ~5–15 minutes (DB is small, a few hundred MB).

> Placeholders used below — fill these in once:
> - `<DB_PRIVATE_IP>`  – private IP of the NEW DB server (same VPC, e.g. `172.28.x.y`)
> - `<BE_PRIVATE_IP>`  – private IP of the EXISTING backend server (`172.28.92.57`)
> - `<DB_PASSWORD>`    – the Postgres password (same value currently in `/opt/klip/.env` → `DB_PASSWORD`)

---

## Target architecture

```
        ┌──────────────────────────┐         private VPC network          ┌──────────────────────────┐
        │  BE server (existing)     │         (port 5432, TCP only)        │  DB server (NEW)          │
        │  172.28.92.57             │  ───────────────────────────────▶   │  <DB_PRIVATE_IP>          │
        │  docker: klip-backend     │                                      │  docker: klip-postgres    │
        │  (postgres REMOVED here)  │                                      │  volume: postgres_data    │
        └──────────────────────────┘                                      └──────────────────────────┘
```

Rules:
- The DB server and BE server must be in the **same VPC / vSwitch / zone** (low latency, private traffic).
- Postgres 5432 is **never** exposed to the public internet — only to the BE server's private IP.
- Keep Postgres **version 14** on the new server (must match the current major version).

---

## Phase 0 — Provision the new DB server

1. In the Alibaba ECS console, create a new instance:
   - **Same region + same VPC + same vSwitch/zone** as the BE server.
   - Recommended size: **≥ 2 vCPU / 4 GB RAM** dedicated to the DB (4 vCPU if budget allows — the
     shipments/shipping‑performance analytical queries do large sorts and benefit from more cores + RAM).
   - **SSD** system/data disk, ≥ 40 GB.
   - OS: Ubuntu 22.04 LTS (or the same OS you use elsewhere).
2. Note the new instance's **private IP** → this is `<DB_PRIVATE_IP>`.
3. Confirm the BE server's private IP → `<BE_PRIVATE_IP>` (`ip -4 addr` on the BE server).

---

## Phase 1 — Install Docker + Postgres on the new DB server

SSH into the new DB server (via ECS Workbench or SSH), then:

```bash
# 1. Install Docker Engine + compose plugin
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 2. Deploy dir
sudo mkdir -p /opt/klip-db && cd /opt/klip-db
```

> **How to read this runbook:** blocks marked ```bash are commands — paste them into the
> shell. The `sudo tee <file> <<'EOF' … EOF` commands below *write a file for you*; paste the
> whole block (from `sudo tee` through the closing `EOF`) as one unit. Do **not** paste raw YAML
> into the shell — that's what caused the `command not found` errors.

**Create the `.env`** — first set your two real values, then paste the whole block. The unquoted
heredoc fills `DB_PASSWORD`/`DB_PRIVATE_IP` in from what you exported; docker compose reads the
rest at runtime.

> **If the DB box already hosts other Postgres containers** (check `docker ps`): host port
> 5432 may be taken. Pick a free host port for KLIP (e.g. 5442) via `DB_HOST_PORT` below, and
> confirm it's free first: `ss -ltn | grep ':5442' && echo IN-USE || echo free`.

```bash
export DB_PRIVATE_IP=172.28.x.y        # <-- replace with the NEW DB server's private IP
export DB_PASSWORD='REPLACE_WITH_REAL_PASSWORD'   # <-- same value as /opt/klip/.env on the BE server
export DB_HOST_PORT=5442               # <-- a FREE host port on this box (5432 if nothing else uses it)

sudo -E tee /opt/klip-db/.env >/dev/null <<EOF
DB_NAME=klip_db
DB_USER=postgres
DB_PASSWORD=${DB_PASSWORD}
DB_PRIVATE_IP=${DB_PRIVATE_IP}
DB_HOST_PORT=${DB_HOST_PORT}
EOF
sudo chmod 600 /opt/klip-db/.env
cat /opt/klip-db/.env    # sanity-check: real IP + password + port are filled in, not <placeholders>
```

**Create the compose file** — paste this whole block verbatim (the quoted `<<'YAML'` keeps the
`${...}` literal so docker compose substitutes them from `.env` at runtime):

```bash
sudo tee /opt/klip-db/docker-compose.db.yml >/dev/null <<'YAML'
services:
  postgres:
    image: postgres:14-alpine
    container_name: klip-postgres
    environment:
      POSTGRES_DB: ${DB_NAME:-klip_db}
      POSTGRES_USER: ${DB_USER:-postgres}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      # Force scram-sha-256 for remote auth (default in this image, set explicitly to be safe)
      POSTGRES_INITDB_ARGS: "--auth-host=scram-sha-256"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      # Bind to the private IP only — never 0.0.0.0 on a box with a public interface.
      # Host port is DB_HOST_PORT (default 5432); container port is always 5432.
      - "${DB_PRIVATE_IP}:${DB_HOST_PORT:-5432}:5432"
    # Dedicated DB box → give Postgres real memory. Tune to ~50-75% of RAM.
    shm_size: "1g"
    command:
      - "postgres"
      - "-c"
      - "shared_buffers=1GB"
      - "-c"
      - "effective_cache_size=3GB"
      - "-c"
      - "work_mem=64MB"
      - "-c"
      - "maintenance_work_mem=256MB"
      - "-c"
      - "max_connections=100"
      # Safety net: no single query may pin CPU forever (the legit heavy query is now ~17s).
      - "-c"
      - "statement_timeout=120000"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-postgres}"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  postgres_data:
    driver: local
YAML
```

> If you prefer to keep the 4 GB box conservative, lower `shared_buffers`/`effective_cache_size`.
> These values assume ~4 GB RAM dedicated to the DB.

**Start it** (run from `/opt/klip-db` so compose picks up the `.env` automatically):

```bash
cd /opt/klip-db
sudo docker compose -f docker-compose.db.yml config    # validates YAML + shows ${...} resolved
sudo docker compose -f docker-compose.db.yml up -d
sudo docker compose -f docker-compose.db.yml ps
sudo docker logs klip-postgres | tail -20   # expect "database system is ready to accept connections"
```

---

## Phase 2 — Network & firewall (Alibaba security group)

1. On the **new DB server's** security group, add ONE inbound rule:
   - Protocol/Port: **TCP `<DB_HOST_PORT>`** (the host port you chose, e.g. 5442)
   - Source: `<BE_PRIVATE_IP>/32` (or the BE server's security group id)
   - Action: Allow
2. Ensure there is **no** rule allowing that port from `0.0.0.0/0`.
3. Verify connectivity **from the BE server**:

```bash
# On the BE server:
nc -vz <DB_PRIVATE_IP> <DB_HOST_PORT>        # expect "succeeded"
# Optional deeper check (needs psql client on BE host):
PGPASSWORD='<DB_PASSWORD>' psql -h <DB_PRIVATE_IP> -p <DB_HOST_PORT> -U postgres -d klip_db -c "SELECT version();"
```

---

## Phase 3 — Migrate the data (brief downtime starts here)

Run these **on the BE server** (where the old `klip-postgres` still runs).

```bash
cd /opt/klip

# 1. Stop the backend so no new writes happen during the copy (DB downtime begins).
sudo docker compose -f docker-compose.backend.yml stop backend

# 2. Dump the current DB straight out of the old container (uses the container's own
#    pg_dump → guaranteed matching version). Custom format = compressed + parallel restore.
#    IMPORTANT: no -t / -i flags here. A pseudo-TTY (-t) corrupts binary (-Fc) output.
sudo docker exec klip-postgres \
  pg_dump -U postgres -Fc -d klip_db > /opt/klip/klip_db_cutover.dump
ls -lh /opt/klip/klip_db_cutover.dump          # sanity: non-zero size
head -c 5 /opt/klip/klip_db_cutover.dump; echo # must print: PGDMP
# Prove the dump is readable/valid before relying on it for cutover:
sudo docker exec -i klip-postgres pg_restore --list - < /opt/klip/klip_db_cutover.dump | tail -5

# 3. Copy the dump to the new DB server.
scp /opt/klip/klip_db_cutover.dump <user>@<DB_PRIVATE_IP>:/opt/klip-db/
```

Then **on the new DB server**, restore into the freshly-created (empty) `klip_db`:

```bash
cd /opt/klip-db
# --no-owner/--no-privileges: restore cleanly as the postgres role regardless of source ownership.
sudo docker exec -i klip-postgres \
  pg_restore -U postgres -d klip_db --no-owner --no-privileges --exit-on-error \
  < /opt/klip-db/klip_db_cutover.dump

# Verify extensions + row counts match the source.
sudo docker exec -t klip-postgres psql -U postgres -d klip_db -c "SELECT extname FROM pg_extension ORDER BY 1;"
sudo docker exec -t klip-postgres psql -U postgres -d klip_db -c \
  "SELECT 'contracts' t, count(*) FROM contracts
   UNION ALL SELECT 'shipments', count(*) FROM shipments
   UNION ALL SELECT 'sap_processed_data', count(*) FROM sap_processed_data
   UNION ALL SELECT 'contract_stos', count(*) FROM contract_stos
   UNION ALL SELECT 'schema_migrations', count(*) FROM schema_migrations;"
```

Compare those counts to the source (run the same `SELECT count(*)` block via
`docker exec klip-postgres psql ...` on the BE server before you removed it). They must match.

> Expected: you should see `pgcrypto` and `pg_trgm` in `pg_extension`, and `schema_migrations`
> already listing all applied migrations (107, 108, …). Because migrations are recorded, the
> backend will **skip** them on next start rather than re-run.

---

## Phase 4 — Repoint the backend at the new DB

On the **BE server**, edit `/opt/klip/docker-compose.backend.yml`:

1. **Remove** (or comment out) the entire `postgres:` service block, its `volumes: postgres_data`
   entry, and the backend's `depends_on: postgres` block.
2. In the `backend:` service `environment:`, change the DB host to the new server:

   ```yaml
       environment:
         NODE_ENV: production
         PORT: 5001
         DB_HOST: <DB_PRIVATE_IP>       # was: klip-postgres
         DB_PORT: "<DB_HOST_PORT>"      # the host port you published, e.g. "5442"; was "5432"
         # DB_NAME/DB_USER/DB_PASSWORD still come from ./backend/.env (must match the new DB)
   ```

3. Make sure `/opt/klip/backend/.env` (or `/opt/klip/.env`) has the **same** `DB_PASSWORD`,
   `DB_NAME=klip_db`, `DB_USER=postgres` as the new DB server.

Start the backend:

```bash
cd /opt/klip
sudo docker compose -f docker-compose.backend.yml up -d backend
sudo docker logs klip-backend --tail 40   # expect: migrations "skip" (all applied), then server start
```

---

## Phase 5 — Validate

```bash
# Backend health
curl -s http://localhost:5001/health

# Backend is talking to the NEW db (should show it connected; no ECONNREFUSED)
sudo docker logs klip-backend --tail 20
```

Then in the browser, smoke-test the app end to end:
- Log in.
- Shipments page loads, Summary + list render, status-card clicks work.
- Trucking page loads, search by contract works (e.g. `1004030828` → 2 rows).
- Contract Performance → a contract's detail loads with correct STO quantities.

Confirm on the new DB server that queries are actually arriving:

```bash
sudo docker exec -t klip-postgres psql -U postgres -d klip_db -c \
  "SELECT count(*) active FROM pg_stat_activity WHERE datname='klip_db';"
```

---

## Phase 6 — Cleanup (this is what actually frees the BE box)

Only after validation succeeds and you've kept a rollback window (recommend keeping the old
data ~1 week):

```bash
# On the BE server — the old postgres container should already be gone from compose after Phase 4.
# Confirm nothing references it, then reclaim its memory + disk:
sudo docker rm -f klip-postgres 2>/dev/null || true
sudo docker volume ls | grep postgres_data           # find the old volume name (e.g. klip_postgres_data)
# After the rollback window, remove it to reclaim disk:
# sudo docker volume rm <old_postgres_data_volume>
rm -f /opt/klip/klip_db_cutover.dump                 # remove the transient dump
```

Removing `klip-postgres` from the BE server returns its 1 GB memory reservation and all its CPU
to the other stacks on that shared host — the original point of this move.

---

## Rollback (if something goes wrong in Phase 4–5)

The old DB is untouched until Phase 6, so rollback is fast:

```bash
# On the BE server: restore the postgres service block + depends_on in docker-compose.backend.yml,
# set backend DB_HOST back to klip-postgres, then:
cd /opt/klip
sudo docker compose -f docker-compose.backend.yml up -d
```

You're back on the old co-located DB. Investigate, then retry the cutover.

---

## Post-move follow-ups

- **Backups:** point your DB dump/backup job (see `docs/DUMP-EXPORT-STAGING-DB.md`) at the new
  DB server. A simple cron on the DB server:
  `docker exec klip-postgres pg_dump -U postgres -Fc klip_db > /opt/klip-db/backups/klip_$(date +%F).dump`
- **Monitoring:** once the monitoring app is live, add the new DB server to it (CPU/mem/disk),
  and alert on `pg_stat_activity` long-running queries.
- **Optional hardening for later (prod):** enable TLS between backend and Postgres
  (`sslmode=require`), and rotate the DB password to a strong secret stored only in the env files.

---

## Gotchas / notes

- **Version parity:** always dump with the source's `pg_dump` (we use `docker exec klip-postgres pg_dump`
  so the version always matches). The new server must be Postgres **14**.
- **Extensions:** `pgcrypto` and `pg_trgm` are bundled in `postgres:14-alpine` and are re-created by
  the dump and by the app's migrations (`CREATE EXTENSION IF NOT EXISTS`). No manual install needed.
- **`statement_timeout=120000`** (120 s) is a safety net, not a fix — the heavy shipments query is
  now ~17 s after migrations 107/108, so it stays well under this. It only kills a future runaway.
- **Latency:** keep both servers in the same zone. Cross-zone/region adds round-trip latency to every
  query and will slow the app.
- **Do not** publish 5432 on `0.0.0.0` with a public IP present; bind to the private IP and lock the
  security group to the BE server.
