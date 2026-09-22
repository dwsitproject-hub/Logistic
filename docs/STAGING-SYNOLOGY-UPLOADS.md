# Staging — Synology upload storage (172.30.1.94 / APPs / dev / klip)

## Fallback while Synology is unreachable (current default)

`\\172.30.1.94\APPs\dev\KLIP\COMMERCIAL DOCS\{YYYY}\{MM}` is **production only** (bulan berjalan). SIT must keep Docker volume `backend_uploads` and must **not** bind `dev/KLIP`.

If the backend server **cannot ping** `172.30.1.94` (cloud ↔ on-prem routing not ready), use the default compose stack — uploads go to Docker volume **`backend_uploads`**:

```bash
cd /opt/klip
git pull origin SIT
docker compose -f docker-compose.backend.yml up -d --build backend
docker compose -f docker-compose.backend.yml ps
```

Files persist in the volume until you migrate to Synology. Switch to Synology only after `ping 172.30.1.94` succeeds.

---

When Synology is reachable, **persistent** KLIP uploads on SIT/staging should use the Synology share under the **klip** app folder (shared `dev` is used by multiple applications):

| Item | Value |
|------|--------|
| Server | `172.30.1.94` |
| Share | `APPs` |
| Environment | `dev` |
| KLIP root | `dev/klip` |
| Backend bind mount | `/mnt/synology-apps/dev/klip` → container `/app/uploads` |

## Folder layout on Synology

```
APPs/
  dev/
    KLIP/                          ← production commercial-docs root (`KLIP_UPLOAD_MOUNT`)
      COMMERCIAL DOCS/
        {YYYY}/                    ← tahun berjalan (Asia/Jakarta), e.g. 2026 then 2027
          {MM}/                    ← 01–12
            {PO}/
              EOP_Dctr_{PO}.pdf
    klip/                          ← do not use for commercial-docs NAS (production uses KLIP/)
      commercial-documents/        ← SIT/local uploads: {PO}/ (Docker volume, no year/month)
      claim-mutu/
      claim-susut/
      suppliers/
      SAP Data/
        Original/                  ← drop SAP MASTER v2 Excel here (kept after import)
        Success/                   ← daily success-row workbooks
        Failed/                    ← daily failed-row workbooks + Remarks
      {uuid}_file.pdf              ← general documents module
    other-app/                     ← other applications under dev/
```

## Modules using this storage

| Module | Path under `dev/klip/` |
|--------|-------------------------|
| Commercial Documents (PDF) | Production NAS only: `dev/KLIP/COMMERCIAL DOCS/{YYYY}/{MM}/{PO}`. SIT: Docker volume `commercial-documents/{PO}` |
| Documents (contract/shipment/trucking) | root of upload folder |
| Claim Mutu import | `claim-mutu/` |
| Claim Susut import | `claim-susut/` |
| Supplier import | `suppliers/` |
| SAP MASTER v2 auto-import | `<SAP_AUTO_IMPORT_ROOT>/ORIGINAL/` (input, never moved), `Success/`, `Failed/` — see the note below |

Manual SAP upload in the UI still uses a temp file and is **not** written to Original. The **06:00** Asia/Jakarta scheduler (`SAP_AUTO_IMPORT_CRON`, default `0 6 * * *`) reads Original, runs the same MASTER v2 engine, writes Success/Failed workbooks (non-empty only), and emails ADMIN. Set `SAP_AUTO_IMPORT_ENABLED=true` after these folders exist on the share.

If IT stores SAP files under a share labelled `Klip > SAP Data` outside `APPs/dev/klip`, either copy/symlink that tree to `dev/klip/SAP Data` or set `SAP_AUTO_IMPORT_ROOT` to a second bind mount. The Synology overlay (`docker-compose.backend.synology.yml`) is enough when the KLIP upload root is already `/app/uploads`.

The Contract ETA reminder runs at 07:00; it is a separate job and still runs when SAP auto-import is enabled.

## One-time setup (backend server 172.28.92.57)

### 1. Credentials (do not commit to Git)

```bash
cd /opt/klip
cp docs/scripts/synology-credentials.example .synology-credentials
chmod 600 .synology-credentials
nano .synology-credentials   # set username=app-prj and password
```

### 2. Mount share + create dev/klip subfolders

```bash
sudo bash docs/scripts/staging-mount-synology-dev.sh
```

### 3. Persist mount across reboot (optional)

Add to `/etc/fstab` (adjust after successful manual mount):

```
//172.30.1.94/APPs  /mnt/synology-apps  cifs  credentials=/opt/klip/.synology-credentials,uid=1001,gid=1001,file_mode=0664,dir_mode=0775,noserverino,_netdev  0  0
```

Then: `sudo mount -a`

### 4. Environment

In `/opt/klip/.env` (and align `backend/.env`):

```env
KLIP_UPLOAD_MOUNT=/mnt/synology-apps/dev/klip
UPLOAD_DIR=/app/uploads
SAP_AUTO_IMPORT_ENABLED=true
SAP_AUTO_IMPORT_ROOT=/app/uploads/IMPORT DATA/LOGISTICS REPORT
```

**The path moved on 2026-09-13.** IT now publishes to
`\\172.30.1.94\APPs\dev\KLIP\IMPORT DATA\LOGISTICS REPORT\ORIGINAL`. Two things follow.

The UNC path is not the value to configure - the backend is a Linux container and cannot resolve
it. `//172.30.1.94/APPs` is mounted at `/mnt/synology-apps`, and `dev/klip` is bind-mounted to
`/app/uploads`, so the value is the container-side path above. Setting the UNC form logs an error
rather than failing silently.

`ORIGINAL` is in capitals while the code's canonical name is `Original`. Linux is case-sensitive,
so the subfolders are now resolved case-insensitively against what is actually on the share; a
mismatch used to report `filesScanned: 0`, which reads exactly like a morning with no new files.
Every run now logs the folder it scanned:

```

### Mounting IT's share (2026-09-13)

The folders on the share are `ORIGINAL`, `SUCCEED` and `FAILED` - `SUCCEED` is not a case variant
of `Success`, so it is handled as an accepted alias, not by case folding.

The share is mounted **read-only** on the host, and SIT and production read the **same** folder.
Both facts point the same way: KLIP reads the source and writes its result workbooks elsewhere.
`SAP_AUTO_IMPORT_RESULTS_ROOT` does that, and `ORIGINAL` is never created or written to - IT owns
those files and KLIP cannot alter them even by accident.

Bring the share into the container with its own mount, separate from `/app/uploads`:

```bash
docker compose -f docker-compose.backend.yml                -f docker-compose.backend.remote-db.yml                -f docker-compose.backend.sap-share.yml up -d --build backend
```

With this in `/opt/klip/.env`:

```env
KLIP_SAP_IMPORT_MOUNT=/mnt/synology-apps/dev/KLIP/IMPORT DATA/LOGISTICS REPORT
SAP_AUTO_IMPORT_ROOT=/mnt/sap-import
SAP_AUTO_IMPORT_RESULTS_ROOT=/app/uploads/SAP Data
```

**Check the container user before expecting reads to work.** The share's folders are mode `0550`
owned by uid/gid `1001`, so the container's user must be 1001 or in group 1001 - otherwise every
read is denied and the scan reports an empty folder rather than a permission error:

```bash
docker exec klip-backend id
docker exec klip-backend ls /mnt/sap-import/ORIGINAL
```

A missing source folder is now logged explicitly ("the source folder does not exist") instead of
surfacing as `filesScanned: 0`.

```bash
docker logs klip-backend 2>&1 | grep "auto-import scanning"


### 5. Deploy backend (Synology bind mount)

```bash
cd /opt/klip
git pull origin SIT
docker compose -f docker-compose.backend.yml -f docker-compose.backend.synology.yml up -d --build backend
```

## Verify

```bash
# Mount visible on host
ls -la /mnt/synology-apps/dev/klip

# Writable from container (runs as uid 1001)
docker compose -f docker-compose.backend.yml exec backend sh -c 'touch /app/uploads/.write-test && rm /app/uploads/.write-test && echo OK'

# Production only — COMMERCIAL DOCS/{YYYY}/{MM} (bulan berjalan). Do not expect this on SIT.
# ls -la "/mnt/synology/dev/KLIP/COMMERCIAL DOCS/$(date +%Y)/$(date +%m)/"

# SAP drop folders (scheduler reads Original/)
ls -la /mnt/synology-apps/dev/klip/SAP\ Data/Original /mnt/synology-apps/dev/klip/SAP\ Data/Success /mnt/synology-apps/dev/klip/SAP\ Data/Failed
```

On Synology File Station: **APPs → dev → klip** should show uploaded files.

## Migrate from old Docker volume or dev/ (without klip/)

```bash
# From old Docker volume
docker volume ls | grep backend_uploads
docker run --rm \
  -v klip_backend_uploads:/from:ro \
  -v /mnt/synology-apps/dev/klip:/to \
  alpine sh -c "cp -an /from/. /to/"

# From previous dev/ root (before klip/ subfolder)
cp -an /mnt/synology-apps/dev/commercial-documents /mnt/synology-apps/dev/klip/ 2>/dev/null || true
cp -an /mnt/synology-apps/dev/claim-mutu /mnt/synology-apps/dev/klip/ 2>/dev/null || true
cp -an /mnt/synology-apps/dev/claim-susut /mnt/synology-apps/dev/klip/ 2>/dev/null || true
cp -an /mnt/synology-apps/dev/suppliers /mnt/synology-apps/dev/klip/ 2>/dev/null || true

chown -R 1001:1001 /mnt/synology-apps/dev/klip
```

## Troubleshooting

| Issue | Action |
|-------|--------|
| `Permission denied` on upload | `chown -R 1001:1001 /mnt/synology-apps/dev/klip`; check Synology ACL for `app-prj` |
| Mount fails | `ping 172.30.1.94`; open SMB from host; verify share name `APPs` |
| View PDF 404 | File missing on share; check `commercial_document_files.file_path` in DB |
| Container starts but upload fails | Confirm `KLIP_UPLOAD_MOUNT=/mnt/synology-apps/dev/klip` in `/opt/klip/.env` |
