#!/usr/bin/env bash
#
# Daily snapshot of the uploaded documents (Commercial Documents and the Shipment Contract / SI / BL files) onto the LOCAL disk of ECS-DB.
#
# Why local, when the documents already live on the Synology share: a copy on the same NAS dies with the NAS, and an accidental delete or a bad
# overwrite on the share is mirrored at once. A second copy on another machine is what lets a lost file be put back.
# The database is backed up separately (backup-daily.sh); this one is for the FILES the database rows point to.
#
#   bash /opt/klip/docs/scripts/backup-uploads.sh              take today's snapshot, rotate, then check the last 2 days against the database
#   DRY_RUN=1 bash /opt/klip/docs/scripts/backup-uploads.sh    show what would be copied, change nothing
#
# Cron (02:00 every day, before the 06:00-10:00 SAP import), writing its own log:
#   0 2 * * * /bin/bash /opt/klip/docs/scripts/backup-uploads.sh >> /var/log/klip-uploads-backup.log 2>&1
#
# How it works: one folder per day under BACKUP_DIR (snap-YYYY-MM-DD). rsync --link-dest hard-links every unchanged file to the previous snapshot, so a
# day costs only the new files, yet each snapshot is a complete tree you can copy back from. The first run copies everything: start it with
# nohup (reading the share costs ~0.2 s per entry), later runs only read what changed.
#
# THE THINGS THAT MAKE IT SAFE (the same lessons as backup-daily.sh):
#   1. It refuses to run when the source is not the share (no marker file / not a mount): snapshotting an empty folder and then rotating away the good
#      snapshots is how a backup destroys itself. That is exactly the state the container was in on 2026-11-17.
#   2. A snapshot is written to a .part folder and renamed only after rsync finished without error.
#   3. Rotation deletes nothing unless at least MIN_KEEP good snapshots remain afterwards.
#   4. It stops when the disk it writes to is more than MAX_DISK_USED_PCT full.
set -uo pipefail

SRC_ROOT="${SRC_ROOT:-/mnt/synology-apps/dev/KLIP}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/klip-uploads}"
FOLDERS="${FOLDERS:-commercial-docs documents}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MIN_KEEP="${MIN_KEEP:-3}"
MAX_DISK_USED_PCT="${MAX_DISK_USED_PCT:-85}"
CONTAINER="${CONTAINER:-klip-backend}"
DRY_RUN="${DRY_RUN:-0}"
MARKER=".klip-uploads-root"

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { log "ERROR: $*"; exit 1; }

command -v rsync >/dev/null 2>&1 || fail "rsync is not installed (apt install rsync)"
log "uploads backup  ${SRC_ROOT}  ->  ${BACKUP_DIR}  (${FOLDERS})"

# 1. the source must really be the share
SRC_MOUNT="${SRC_ROOT}"
while [ "${SRC_MOUNT}" != "/" ] && ! mountpoint -q "${SRC_MOUNT}" 2>/dev/null; do SRC_MOUNT="$(dirname "${SRC_MOUNT}")"; done
[ "${SRC_MOUNT}" != "/" ] || fail "${SRC_ROOT} is not on a mounted share - refusing to snapshot a local stand-in folder"
if [ -e "${SRC_ROOT}/${MARKER}" ]; then
  log "source marker ${MARKER} found"
else
  log "WARNING: ${SRC_ROOT}/${MARKER} not found (create it once: touch ${SRC_ROOT}/${MARKER}); continuing because the mount check passed"
fi
for f in ${FOLDERS}; do [ -d "${SRC_ROOT}/${f}" ] || fail "${SRC_ROOT}/${f} does not exist"; done

# 4. disk space
mkdir -p "${BACKUP_DIR}" || fail "cannot create ${BACKUP_DIR}"
USED="$(df -P "${BACKUP_DIR}" | awk 'NR==2 {gsub("%","",$5); print $5}')"
[ -n "${USED}" ] || fail "cannot read the disk usage of ${BACKUP_DIR}"
[ "${USED}" -lt "${MAX_DISK_USED_PCT}" ] || fail "the disk of ${BACKUP_DIR} is ${USED}% full (limit ${MAX_DISK_USED_PCT}%) - free space first"

TODAY="$(date '+%Y-%m-%d')"
DEST="${BACKUP_DIR}/snap-${TODAY}"
PART="${DEST}.part"
LATEST="$(ls -1d "${BACKUP_DIR}"/snap-????-??-?? 2>/dev/null | grep -v "snap-${TODAY}$" | tail -n 1 || true)"

if [ -d "${DEST}" ] && [ "${DRY_RUN}" != "1" ]; then
  log "today's snapshot already exists (${DEST}); running the check only"
else
  rm -rf "${PART}"
  mkdir -p "${PART}"
  RSYNC=(rsync -a --partial)
  [ -n "${LATEST}" ] && RSYNC+=("--link-dest=${LATEST}")
  [ "${DRY_RUN}" = "1" ] && RSYNC+=(--dry-run --itemize-changes)
  OK=1
  for f in ${FOLDERS}; do
    log "copying ${f}"
    "${RSYNC[@]}" "${SRC_ROOT}/${f}/" "${PART}/${f}/" || { log "rsync failed for ${f}"; OK=0; }
  done
  if [ "${DRY_RUN}" = "1" ]; then rm -rf "${PART}"; log "dry run done, nothing kept"; exit 0; fi
  [ "${OK}" = "1" ] || { log "snapshot NOT kept: ${PART} is incomplete"; exit 1; }
  # 2. only a finished snapshot gets its final name
  mv "${PART}" "${DEST}" || fail "could not name the snapshot ${DEST}"
  log "snapshot ready: ${DEST} ($(du -sh --apparent-size "${DEST}" 2>/dev/null | cut -f1) apparent, hard-linked to the previous one)"

  # 3. rotation
  mapfile -t OLD < <(find "${BACKUP_DIR}" -maxdepth 1 -type d -name 'snap-????-??-??' -mtime +"${RETENTION_DAYS}" | sort)
  GOOD="$(find "${BACKUP_DIR}" -maxdepth 1 -type d -name 'snap-????-??-??' | wc -l)"
  if [ "${#OLD[@]}" -gt 0 ]; then
    if [ $((GOOD - ${#OLD[@]})) -ge "${MIN_KEEP}" ]; then
      for d in "${OLD[@]}"; do log "rotating out ${d}"; rm -rf "${d}"; done
    else
      log "rotation skipped: it would leave fewer than ${MIN_KEEP} snapshots"
    fi
  fi
fi

# every recorded document of the last 2 days must be on the disk the app sees (and the app's upload folder must be the share)
log "checking the last 2 days against the database"
if docker exec "${CONTAINER}" node dist/scripts/checkCommercialDocFiles.js --days 2; then
  log "integrity check: OK"
else
  log "integrity check: PROBLEM (see the lines above). Do not wait: fix the mount or restore from ${BACKUP_DIR}"
  exit 2
fi
log "done"
