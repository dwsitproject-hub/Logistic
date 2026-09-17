#!/usr/bin/env bash
# Pre-merge backup of authoritative DB on the DB server (172.28.92.60).
#
# Run on DB server (PuTTY → 172.28.92.60), from /opt/klip-db:
#   bash /opt/klip/docs/scripts/backup-pre-merge-remote.sh
# Or if repo only on BE host, copy script first or git pull on DB server.
set -euo pipefail

OUT_DIR="${OUT_DIR:-/opt/klip-db/backups}"
STAMP="$(date +%Y%m%d_%H%M%S)"
CONTAINER="${PG_CONTAINER:-klip-postgres}"
DB_NAME="${DB_NAME:-klip_db}"
DB_USER="${DB_USER:-postgres}"

mkdir -p "$OUT_DIR"

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  echo "ERROR: container $CONTAINER not running" >&2
  exit 1
fi

OUT_FILE="$OUT_DIR/klip_pre_merge_${STAMP}.dump"
echo "=== Pre-merge backup → $OUT_FILE ==="
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$OUT_FILE"

BYTES="$(wc -c < "$OUT_FILE" | tr -d ' ')"
if [[ "$BYTES" -lt 1024 ]]; then
  echo "ERROR: dump too small ($BYTES bytes)" >&2
  exit 1
fi

ls -lh "$OUT_FILE"
echo "Backup complete."
