# KLIP — Dump & export (read runbook for which server to use)
#
# **Authoritative SIT database** lives on the **DB server** (`172.28.92.60:5442`),
# NOT on the backend host. See `docs/Update Staging Server Code.md`.
#
# | Purpose | Server | Script |
# |---------|--------|--------|
# | Authoritative DB backup | 172.28.92.60 | `backup-pre-merge-remote.sh` on `/opt/klip-db` |
# | BE local fork backup (misconfig recovery) | 172.28.92.57 | `dump-be-local-fork.sh` |
# | Full legacy export (local klip-postgres on BE) | 172.28.92.57 | `export-sit-db.sh` (below) |
#
# For fork → remote migration after env mispointing, see **`docs/BE-DB-FORK-MIGRATION-RUNBOOK.md`**.

# Runbook: Dump & Export the Database from the Ali Cloud Staging Server

Export the KLIP PostgreSQL database from the staging (SIT) backend server on Alibaba
Cloud and download the dump to your laptop for a local restore.

## Facts (staging server)

| Item | Value |
|------|-------|
| Host | `172.28.92.57` (private IP — VPN must be connected) |
| SSH user | `ubuntu` |
| SSH key | `~/.ssh/id_ed25519` |
| Repo path | `/opt/klip` |
| Compose file | `docker-compose.backend.yml` |
| Postgres container | `klip-postgres` |
| Database | `klip_db` |
| DB user | `postgres` |
| Published DB port (host-only) | `127.0.0.1:5433` |

---

## Step 1 — Connect to the VPN

The host is a private `172.28.x.x` address, so you must be on the corporate VPN first.
Quick check from your laptop:

```bash
ping -n 1 172.28.92.57
```

You should get a reply. If it times out, connect the VPN and retry.

## Step 2 — SSH into the staging server

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@172.28.92.57
```

If this is the first connection, accept the host fingerprint when prompted.

## Step 3 — Run the export script (on the server)

```bash
cd /opt/klip
bash docs/scripts/export-sit-db.sh
```

What it does:
- Runs `pg_dump` **inside** the `klip-postgres` container
- Flags: `--no-owner --no-acl --clean --if-exists` (portable, self-cleaning restore)
- Writes to `/opt/klip/backups/sit_klip_db_<YYYYMMDD_HHMMSS>.sql`

It prints the final path and byte size, e.g.:

```
Wrote /opt/klip/backups/sit_klip_db_20260710_101530.sql (203004928 bytes)
```

**Copy that exact filename** — you need it in Step 5.

### Manual alternative (if the script is missing)

```bash
cd /opt/klip
mkdir -p backups
STAMP=$(date +%Y%m%d_%H%M%S)
docker compose -f docker-compose.backend.yml exec -T postgres \
  pg_dump -U postgres -d klip_db --no-owner --no-acl --clean --if-exists \
  > backups/sit_klip_db_${STAMP}.sql
ls -lh backups/sit_klip_db_${STAMP}.sql
```

## Step 4 — Verify the dump on the server (optional but recommended)

```bash
ls -lh /opt/klip/backups/
tail -n 5 /opt/klip/backups/sit_klip_db_<STAMP>.sql
```

A healthy dump ends with a line like `-- PostgreSQL database dump complete`.
File size should be tens–hundreds of MB, not a few bytes.

## Step 5 — Download the dump to your laptop

Open a **new local terminal** (leave the SSH session, or use a second window).
Replace the filename with the one from Step 3:

```bash
scp -i ~/.ssh/id_ed25519 \
  ubuntu@172.28.92.57:/opt/klip/backups/sit_klip_db_YYYYMMDD_HHMMSS.sql \
  "D:/Cursor/Logistic SAP/backups/"
```

Large files: `scp` shows a progress bar. A ~200 MB dump over VPN can take a few minutes.

## Step 6 — Confirm it landed locally

```bash
ls -lh "D:/Cursor/Logistic SAP/backups/"
```

You now have the `.sql` file locally, ready to restore into your local
`klip-postgres` container (port 5433).

---

## Optional — Housekeeping on the server

Dumps accumulate in `/opt/klip/backups/`. To free space, remove old ones:

```bash
ls -lt /opt/klip/backups/            # newest first
rm /opt/klip/backups/sit_klip_db_<OLD_STAMP>.sql
```

## Troubleshooting

| Symptom | Cause / Fix |
|---------|-------------|
| `ping` times out | VPN not connected. |
| `Permission denied (publickey)` | Wrong key or user. Confirm `-i ~/.ssh/id_ed25519` and `ubuntu@`. |
| `no such service: postgres` | Wrong compose file. Ensure you're in `/opt/klip` and using `docker-compose.backend.yml`. |
| Dump file is tiny (< 1 KB) | `pg_dump` failed — check DB name/credentials; run without `-T` to see the error. |
| `scp` very slow | Expected over VPN for large dumps; let it finish. |

## Next: restore locally

Once the `.sql` is in `D:\Cursor\Logistic SAP\backups\`, restore it into the running
local `klip-postgres` container. (Back up the local DB first, stop `klip-backend` to
drop active connections, then pipe the SQL through `psql`.)
