#!/usr/bin/env bash
#
# Daily KLIP database backup to the Synology share, keeping 30 days.
#
# Destination: \172.30.1.94\APPs\dev\KLIP\BACKUP, reached through the CIFS mount that
# mount-synology-backup.sh sets up at /mnt/synology-apps. Run that first.
#
# Why this exists: as of 2026-09-17 /opt/klip-db/backups held two dumps, both from 6 August, both
# taken by hand before a merge. Losing the database would have meant losing six weeks. A dump is
# ~43 MB and the data grows ~0.3 MB/day, so a month of daily backups is about 1.3 GB.
#
#   bash /opt/klip/docs/scripts/backup-daily.sh
#   BACKUP_DIR=/mnt/synology-apps/dev/KLIP/BACKUP bash /opt/klip/docs/scripts/backup-daily.sh
#
# Cron (03:15 every day), writing its own log:
#   15 3 * * * /bin/bash /opt/klip/docs/scripts/backup-daily.sh >> /var/log/klip-backup.log 2>&1
#
# THE THREE THINGS THAT MAKE THIS SAFE, and each is here because the naive version is dangerous:
#
#   1. It refuses to run when the destination is not a mount point. If the Synology share drops,
#      the mount path becomes an ordinary empty directory on the local disk - a naive script would
#      write there, fill the system disk, and then its own rotation would delete the real backups
#      it can no longer see. Set REQUIRE_MOUNT=0 only for a genuinely local destination.
#
#   2. It writes to a .part file and renames it only after pg_restore --list can read it back. An
#      interrupted dump is not left looking like a good one.
#
#   3. Rotation deletes nothing unless at least MIN_KEEP good backups remain afterwards. If dumping
#      has been failing silently for a month, the old backups are what is left - deleting them on
#      schedule would destroy the last copies precisely when they matter.
#
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/klip}"
BACKUP_DIR="${BACKUP_DIR:-/mnt/synology-apps/dev/KLIP/BACKUP}"   # \172.30.1.94\APPs\dev\KLIP\BACKUP
RETENTION_DAYS="${RETENTION_DAYS:-30}"
MIN_KEEP="${MIN_KEEP:-7}"
REQUIRE_MOUNT="${REQUIRE_MOUNT:-1}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { log "ERROR: $*"; exit 1; }

cd "${APP_DIR}" || fail "app dir not found: ${APP_DIR}"
[ -f .env ] || fail "no .env in ${APP_DIR}"

env_val() { sed -n "s/^$1=//p" .env | head -1 | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
DB_HOST="$(env_val DB_HOST)"; DB_PORT="$(env_val DB_PORT)"
DB_USER="$(env_val DB_USER)"; DB_NAME="$(env_val DB_NAME)"
export PGPASSWORD="$(env_val DB_PASSWORD)"
[ -n "${DB_HOST}" ] && [ -n "${DB_NAME}" ] || fail "DB_HOST / DB_NAME missing from .env"

log "KLIP daily backup -> ${BACKUP_DIR}"

# 1. destination must be a real mount, not a stand-in directory left behind by a dropped share
if [ "${REQUIRE_MOUNT}" = "1" ]; then
  MOUNT_ROOT="${BACKUP_DIR}"
  while [ "${MOUNT_ROOT}" != "/" ] && ! mountpoint -q "${MOUNT_ROOT}" 2>/dev/null; do
    MOUNT_ROOT="$(dirname "${MOUNT_ROOT}")"
  done
  [ "${MOUNT_ROOT}" != "/" ] || fail "${BACKUP_DIR} is not on a mounted share - refusing to write to the local disk. Set REQUIRE_MOUNT=0 if this destination really is local."
  log "destination is on mount ${MOUNT_ROOT}"
fi

mkdir -p "${BACKUP_DIR}" || fail "cannot create ${BACKUP_DIR}"
[ -w "${BACKUP_DIR}" ] || fail "${BACKUP_DIR} is not writable"

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="${BACKUP_DIR}/klip_${STAMP}.dump"
PART="${OUT}.part"

#
# pg_dump has to be at least the server's major version - it refuses outright, it does not warn.
# Production runs PostgreSQL 18 while this host carries the 16 client that ships with Ubuntu 24.04,
# so the host binary cannot be used. Rather than add a package repository to a database server, run
# the matching client from a container; the image is pulled once and cached.
#
# Set PG_CLIENT=host to force the host binary, or PG_IMAGE to pin a specific image.
#
server_major() {
  local v
  v="$(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -Atc 'SHOW server_version_num' 2>/dev/null)" || return 1
  [ -n "${v}" ] || return 1
  echo $(( v / 10000 ))
}
host_major() { pg_dump --version 2>/dev/null | grep -oE '[0-9]+' | head -1; }

PG_CLIENT="${PG_CLIENT:-auto}"
if [ "${PG_CLIENT}" = "auto" ]; then
  SRV="$(server_major || true)"
  HST="$(host_major || true)"
  if [ -n "${SRV}" ] && [ -n "${HST}" ] && [ "${HST}" -ge "${SRV}" ] 2>/dev/null; then
    PG_CLIENT="host"
    log "using the host client (pg_dump ${HST} vs server ${SRV})"
  elif command -v docker >/dev/null 2>&1; then
    PG_CLIENT="docker"
    PG_IMAGE="${PG_IMAGE:-postgres:${SRV:-18}-alpine}"
    log "host pg_dump is ${HST:-unknown} but the server is ${SRV:-unknown} - using ${PG_IMAGE}"
  else
    fail "host pg_dump is ${HST:-unknown}, the server is ${SRV:-unknown}, and docker is not available to supply a matching client"
  fi
fi

run_pg() {  # run_pg <pg_dump|pg_restore> [args...]
  if [ "${PG_CLIENT}" = "docker" ]; then
    docker run --rm -i -e PGPASSWORD="${PGPASSWORD}" -v "${BACKUP_DIR}:/backup" "${PG_IMAGE}" "$@"
  else
    "$@"
  fi
}

# Inside the container the backup directory is /backup; on the host it is ${BACKUP_DIR}.
if [ "${PG_CLIENT}" = "docker" ]; then PART_REF="/backup/$(basename "${PART}")"; else PART_REF="${PART}"; fi

# 2. dump to .part, verify it can be read back, only then publish it under its real name
log "dumping ${DB_NAME} from ${DB_HOST}:${DB_PORT}"
if ! run_pg pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -Fc -f "${PART_REF}" "${DB_NAME}"; then
  rm -f "${PART}"
  fail "pg_dump failed"
fi

SIZE_BYTES="$(stat -c%s "${PART}" 2>/dev/null || echo 0)"
[ "${SIZE_BYTES}" -gt 1048576 ] || { rm -f "${PART}"; fail "dump is only ${SIZE_BYTES} bytes - treating as failed"; }

if ! run_pg pg_restore --list "${PART_REF}" > /dev/null 2>&1; then
  rm -f "${PART}"
  fail "dump did not verify with pg_restore --list - discarded"
fi

mv "${PART}" "${OUT}"
log "wrote $(du -h "${OUT}" | cut -f1) to ${OUT}"

# 3. rotate, but never below MIN_KEEP good backups
TOTAL="$(find "${BACKUP_DIR}" -maxdepth 1 -name 'klip_*.dump' -type f | wc -l)"
OLD="$(find "${BACKUP_DIR}" -maxdepth 1 -name 'klip_*.dump' -type f -mtime "+${RETENTION_DAYS}" | wc -l)"
REMAINING=$((TOTAL - OLD))

if [ "${OLD}" -eq 0 ]; then
  log "rotation: nothing older than ${RETENTION_DAYS} days (${TOTAL} kept)"
elif [ "${REMAINING}" -lt "${MIN_KEEP}" ]; then
  log "rotation SKIPPED: deleting ${OLD} would leave ${REMAINING}, below MIN_KEEP=${MIN_KEEP}."
  log "                  that usually means dumping has been failing - check this log before trusting the schedule."
else
  find "${BACKUP_DIR}" -maxdepth 1 -name 'klip_*.dump' -type f -mtime "+${RETENTION_DAYS}" -print -delete
  log "rotation: removed ${OLD}, kept ${REMAINING}"
fi

log "total in ${BACKUP_DIR}: $(du -sh "${BACKUP_DIR}" | cut -f1) across $(find "${BACKUP_DIR}" -maxdepth 1 -name 'klip_*.dump' -type f | wc -l) dumps"
log "done"
