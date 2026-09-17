#!/usr/bin/env bash
# Run ON the SIT/testing backend server (172.28.92.57) after SSH login.
# Creates a pg_dump SQL file under /opt/klip/backups/ for download to your laptop.
#
# Usage (on server):
#   cd /opt/klip
#   bash docs/scripts/export-sit-db.sh
#
# Then on your Windows laptop (replace key path):
#   pscp -i C:\path\to\key.ppk ubuntu@172.28.92.57:/opt/klip/backups/sit_klip_db_*.sql D:\Cursor\Logistic SAP\backups\
#   cd D:\Cursor\Logistic SAP
#   .\scripts\import-sit-db-to-local.ps1 -DumpFileOnly .\backups\sit_klip_db_YYYYMMDD_HHMMSS.sql

set -euo pipefail

REPO="${REPO:-/opt/klip}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.backend.yml}"
DB_NAME="${DB_NAME:-klip_db}"
DB_USER="${DB_USER:-postgres}"
OUT_DIR="${OUT_DIR:-$REPO/backups}"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="${OUT_DIR}/sit_${DB_NAME}_${STAMP}.sql"

mkdir -p "$OUT_DIR"
cd "$REPO"

echo "Dumping $DB_NAME from docker postgres ..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl --clean --if-exists \
  > "$OUT_FILE"

BYTES="$(wc -c < "$OUT_FILE" | tr -d ' ')"
echo "Wrote $OUT_FILE ($BYTES bytes)"
echo ""
echo "Download to laptop (PuTTY pscp example):"
echo "  pscp -i C:\\path\\to\\key.ppk ubuntu@172.28.92.57:$OUT_FILE .\\backups\\"
