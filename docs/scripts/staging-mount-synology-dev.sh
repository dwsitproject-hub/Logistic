#!/usr/bin/env bash
# Mount Synology share for KLIP staging uploads (APPs/dev/klip → backend /app/uploads)
# Run on backend server 172.28.92.57 as user with sudo.
#
# Usage:
#   sudo bash docs/scripts/staging-mount-synology-dev.sh
#
# Requires /opt/klip/.synology-credentials (see synology-credentials.example)

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/klip}"
SYNO_HOST="${SYNO_HOST:-172.30.1.94}"
SYNO_SHARE="${SYNO_SHARE:-APPs}"
SYNO_SUBDIR="${SYNO_SUBDIR:-dev}"
KLIP_UPLOAD_SUBDIR="${KLIP_UPLOAD_SUBDIR:-klip}"
MOUNT_ROOT="${MOUNT_ROOT:-/mnt/synology-apps}"
MOUNT_DEV="${MOUNT_ROOT}/${SYNO_SUBDIR}"
MOUNT_KLIP="${KLIP_UPLOAD_MOUNT:-${MOUNT_DEV}/${KLIP_UPLOAD_SUBDIR}}"
CREDS="${SYNOLOGY_CREDENTIALS:-${APP_DIR}/.synology-credentials}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash $0"
  exit 1
fi

if ! command -v mount.cifs >/dev/null 2>&1; then
  echo "Installing cifs-utils..."
  apt-get update -qq
  apt-get install -y cifs-utils
fi

if [[ ! -f "${CREDS}" ]]; then
  echo "ERROR: Missing credentials file: ${CREDS}"
  echo "Copy docs/scripts/synology-credentials.example → ${CREDS} and set password."
  exit 1
fi

chmod 600 "${CREDS}"

mkdir -p "${MOUNT_ROOT}" "${MOUNT_DEV}" "${MOUNT_KLIP}"

if ! mountpoint -q "${MOUNT_ROOT}"; then
  echo "Mounting //${SYNO_HOST}/${SYNO_SHARE} → ${MOUNT_ROOT}"
  mount -t cifs "//${SYNO_HOST}/${SYNO_SHARE}" "${MOUNT_ROOT}" \
    -o "credentials=${CREDS},uid=1001,gid=1001,file_mode=0664,dir_mode=0775,noserverino,_netdev"
else
  echo "Share already mounted at ${MOUNT_ROOT}"
fi

mkdir -p "${MOUNT_KLIP}"
chown 1001:1001 "${MOUNT_KLIP}" 2>/dev/null || true

for sub in commercial-documents claim-mutu claim-susut suppliers; do
  mkdir -p "${MOUNT_KLIP}/${sub}"
  chown 1001:1001 "${MOUNT_KLIP}/${sub}" 2>/dev/null || true
done

echo "KLIP upload root ready: ${MOUNT_KLIP}"
echo "Synology path: ${SYNO_SHARE}/${SYNO_SUBDIR}/${KLIP_UPLOAD_SUBDIR}/"
echo ""
echo "Set in /opt/klip/.env:"
echo "  KLIP_UPLOAD_MOUNT=${MOUNT_KLIP}"
echo "  UPLOAD_DIR=/app/uploads"
