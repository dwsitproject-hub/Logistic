#!/usr/bin/env bash
#
# Mount the Synology share that holds the KLIP database backups, and make it survive a reboot.
#
#   share   \\172.30.1.94\APPs        ->  /mnt/synology-apps
#   backups \\172.30.1.94\APPs\dev\KLIP\BACKUP  ->  /mnt/synology-apps/dev/KLIP/BACKUP
#
# Run once, as root:
#   bash /opt/klip/docs/scripts/mount-synology-backup.sh
#
# The NAS username and password are typed here, on this machine, into a hidden prompt. They are
# written to /etc/klip-synology.cred with mode 0600 and never appear in the command line, in shell
# history, or in this repository. Nothing else needs them - the backup script reads the mount, not
# the credentials.
#
set -uo pipefail

SERVER="${SERVER:-172.30.1.94}"
SHARE="${SHARE:-APPs}"
MOUNT_POINT="${MOUNT_POINT:-/mnt/synology-apps}"
BACKUP_SUBPATH="${BACKUP_SUBPATH:-dev/KLIP/BACKUP}"
CRED_FILE="${CRED_FILE:-/etc/klip-synology.cred}"

log() { echo "[$(date '+%H:%M:%S')] $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || fail "run as root (mounting and writing /etc need it)"

if ! command -v mount.cifs >/dev/null 2>&1; then
  log "installing cifs-utils"
  (apt-get update -qq && apt-get install -y -qq cifs-utils) || fail "could not install cifs-utils"
fi

if [ ! -f "${CRED_FILE}" ]; then
  log "credentials for \\\\${SERVER}\\${SHARE} - typed here, stored ${CRED_FILE} (0600), never echoed"
  read -rp  "  NAS username: " NAS_USER
  read -rsp "  NAS password: " NAS_PASS; echo
  read -rp  "  NAS domain (blank if none): " NAS_DOMAIN
  umask 077
  {
    echo "username=${NAS_USER}"
    echo "password=${NAS_PASS}"
    [ -n "${NAS_DOMAIN}" ] && echo "domain=${NAS_DOMAIN}"
  } > "${CRED_FILE}"
  unset NAS_PASS
  chmod 600 "${CRED_FILE}"
  log "wrote ${CRED_FILE}"
else
  log "reusing existing ${CRED_FILE}"
fi

mkdir -p "${MOUNT_POINT}"

if mountpoint -q "${MOUNT_POINT}"; then
  log "${MOUNT_POINT} is already mounted"
else
  log "mounting //${SERVER}/${SHARE} -> ${MOUNT_POINT}"
  mount -t cifs "//${SERVER}/${SHARE}" "${MOUNT_POINT}" \
    -o "credentials=${CRED_FILE},uid=0,gid=0,file_mode=0640,dir_mode=0750,vers=3.0,nofail" \
    || fail "mount failed - check the credentials, and whether the NAS allows SMB 3.0 (try vers=2.1)"
  log "mounted"
fi

BACKUP_DIR="${MOUNT_POINT}/${BACKUP_SUBPATH}"
mkdir -p "${BACKUP_DIR}" || fail "cannot create ${BACKUP_DIR} on the share"
PROBE="${BACKUP_DIR}/.klip-write-test"
( echo ok > "${PROBE}" && rm -f "${PROBE}" ) || fail "${BACKUP_DIR} is not writable by this host"
log "verified writable: ${BACKUP_DIR}"

# Persist across reboots. nofail keeps a NAS outage from blocking boot; the backup script refuses
# to run when the share is not mounted, so an unmounted state fails loudly rather than silently
# filling the local disk.
FSTAB_LINE="//${SERVER}/${SHARE} ${MOUNT_POINT} cifs credentials=${CRED_FILE},uid=0,gid=0,file_mode=0640,dir_mode=0750,vers=3.0,nofail,_netdev 0 0"
if grep -qsF "//${SERVER}/${SHARE} ${MOUNT_POINT}" /etc/fstab; then
  log "/etc/fstab already has an entry for this share"
else
  cp /etc/fstab "/etc/fstab.bak.$(date +%Y%m%d_%H%M%S)"
  echo "${FSTAB_LINE}" >> /etc/fstab
  log "added to /etc/fstab (previous copy saved alongside it)"
fi

echo
echo "Backup destination ready:"
echo "  ${BACKUP_DIR}"
echo
echo "Next, take one backup by hand and check what it reports:"
echo "  BACKUP_DIR=${BACKUP_DIR} bash /opt/klip/docs/scripts/backup-daily.sh"
echo
echo "Then schedule it at 03:15 daily:"
echo "  ( crontab -l 2>/dev/null; echo '15 3 * * * BACKUP_DIR=${BACKUP_DIR} /bin/bash /opt/klip/docs/scripts/backup-daily.sh >> /var/log/klip-backup.log 2>&1' ) | crontab -"
