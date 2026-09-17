# Runbook: Migrasi DB Fork (BE local Postgres → DB server)

Data transaksional KLIP yang tertulis ke **Postgres co-located** di backend server (`172.28.92.57`, container `klip-postgres`) selama misconfig env (~**3 Agustus 2026** – perbaikan env) harus dimigrasikan ke DB authoritative di **`172.28.92.60:5442`**.

## Arsitektur

| Server | IP | Postgres |
|--------|-----|----------|
| Backend | 172.28.92.57 | Fork: `klip-postgres` (127.0.0.1:5433) — **sumber migrasi** |
| DB | 172.28.92.60:5442 | Authoritative — **target merge** |
| Frontend | 172.28.92.56 | — |

Root cause: `DB_HOST=klip-postgres` / `postgres` (Docker DNS) di backend container → write ke DB lokal, bukan `.60`.

---

## Prasyarat

1. VPN ke AliCloud VPC (`172.28.x.x`)
2. SSH ke backend: `ssh ubuntu@172.28.92.57`
3. Repo up to date: `cd /opt/klip && git pull origin SIT`
4. Backend **sudah** pointing ke remote:
   ```bash
   docker exec klip-backend printenv DB_HOST DB_PORT
   # DB_HOST=172.28.92.60  DB_PORT=5442
   ```
5. `postgresql-client` di BE host: `sudo apt-get install -y postgresql-client`
6. Password DB di `backend/.env` / `/opt/klip/.env`

---

## Quick start (orchestrator)

```bash
cd /opt/klip

# Preview semua fase (tanpa mengubah data)
bash docs/scripts/run-be-fork-migration.sh

# Setelah review report, jalankan merge
bash docs/scripts/run-be-fork-migration.sh --apply
```

Cutoff date (default `2026-08-03`):

```bash
BE_FORK_CUTOFF=2026-08-03 bash docs/scripts/run-be-fork-migration.sh --apply
```

---

## Langkah manual per fase

### Phase 0 — Verifikasi & inventory

```bash
bash docs/scripts/compare-be-fork-vs-remote.sh
```

Output: `/opt/klip/backups/be_fork_compare_*.txt` — bandingkan `local_total`, `remote_total`, `local_delta`.

### Phase 1 — Backup

**1A — Fork lokal (BE host):**

```bash
bash docs/scripts/dump-be-local-fork.sh
FULL=1 bash docs/scripts/dump-be-local-fork.sh
```

**1B — DB authoritative (DB server `.60`):**

```bash
ssh ubuntu@172.28.92.60
cd /opt/klip-db   # or copy script from repo
bash /opt/klip/docs/scripts/backup-pre-merge-remote.sh
```

**1C — Download ke laptop (opsional):**

```bash
scp ubuntu@172.28.92.57:/opt/klip/backups/be_fork_full_*.dump D:/Project/Klip/docs/
scp ubuntu@172.28.92.60:/opt/klip-db/backups/klip_pre_merge_*.dump D:/Project/Klip/docs/
```

### Phase 3 — Staging + merge

```bash
# Copy data fork → schema be_fork di remote
bash docs/scripts/load-be-fork-to-remote-staging.sh

# Preview merge
bash docs/scripts/apply-be-fork-merge.sh

# Apply merge (insert + update by updated_at/created_at)
bash docs/scripts/apply-be-fork-merge.sh --apply
```

Merge logic: row dengan `updated_at` / `created_at` ≥ cutoff; `ON CONFLICT (id) DO UPDATE` hanya jika row staging lebih baru.

### Phase 4 — File uploads

```bash
bash docs/scripts/sync-be-fork-uploads.sh          # preview
bash docs/scripts/sync-be-fork-uploads.sh --apply  # archive dari klip-backend volume
```

Jika production memakai Synology bind mount, rsync archive ke path shared storage.

### Phase 5 — Validasi

```bash
bash docs/scripts/validate-be-fork-merge.sh
curl -s http://localhost:5001/health
```

Opsional setelah merge:

```bash
# Pre-planned grouping rebuild (butuh JWT)
curl -X POST http://localhost:5001/api/pre-planned/rebuild \
  -H "Authorization: Bearer <token>"
```

---

## Tabel yang dimigrasikan

Transactional tables (lihat `docs/scripts/lib/be-fork-migration-common.sh` → `BE_FORK_MERGE_TABLES`).

**Tidak dimigrasikan:** `users`, `roles`, `permissions`, `*_snapshot*`, `schema_migrations`.

---

## Rollback

1. Stop backend writes (opsional): `docker compose -f docker-compose.backend.yml stop backend`
2. Restore pre-merge dump di DB server:
   ```bash
   docker exec -i klip-postgres pg_restore -U postgres -d klip_db -c \
     < /opt/klip-db/backups/klip_pre_merge_YYYYMMDD.dump
   ```
3. Restart backend: `docker compose -f docker-compose.backend.yml up -d backend`

Simpan fork dump BE minimal **1 minggu** sebelum hapus volume lokal.

---

## Pencegahan recurrence

1. Env permanen di `/opt/klip/.env`:
   ```
   DB_HOST=172.28.92.60
   DB_PORT=5442
   ```
2. Backend log **ERROR** jika production `DB_HOST` ∈ `{postgres, klip-postgres, localhost}` — set `KLIP_FAIL_ON_LOCAL_DB=true` untuk refuse start.
3. Long-term: deploy backend tanpa Postgres co-located:
   ```bash
   docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml up -d --build
   ```

---

## Script reference

| Script | Host | Fungsi |
|--------|------|--------|
| `compare-be-fork-vs-remote.sh` | BE `.57` | Inventory diff |
| `dump-be-local-fork.sh` | BE `.57` | Backup fork |
| `backup-pre-merge-remote.sh` | DB `.60` | Backup authoritative |
| `load-be-fork-to-remote-staging.sh` | BE `.57` | Copy → `be_fork` schema |
| `apply-be-fork-merge.sh` | BE `.57` | Merge ke `public` |
| `sync-be-fork-uploads.sh` | BE `.57` | Archive document files |
| `validate-be-fork-merge.sh` | BE `.57` | Post-merge checks |
| `run-be-fork-migration.sh` | BE `.57` | Orchestrator |
