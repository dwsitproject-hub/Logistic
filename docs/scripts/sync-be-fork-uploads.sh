#!/usr/bin/env bash
# Sync document files from BE backend uploads volume for rows created since cutoff.
#
# Run on backend host (172.28.92.57):
#   bash docs/scripts/sync-be-fork-uploads.sh
#   bash docs/scripts/sync-be-fork-uploads.sh --apply
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=docs/scripts/lib/be-fork-migration-common.sh
source "$ROOT/docs/scripts/lib/be-fork-migration-common.sh"

APPLY=false
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=true
fi

CUTOFF="${BE_FORK_CUTOFF:-2026-08-03}"
BACKUP_DIR="${UPLOAD_BACKUP_DIR:-/opt/klip/backups/be_fork_uploads_$(date +%Y%m%d_%H%M%S)}"
CONTAINER="${BACKEND_CONTAINER:-klip-backend}"

load_migration_env "$ROOT"

echo "=== Document upload sync since $CUTOFF ==="

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  echo "ERROR: $CONTAINER not running" >&2
  exit 1
fi

LIST_FILE="${BACKUP_DIR}.files.txt"
mkdir -p "$(dirname "$LIST_FILE")"

psql_remote -Atc "
SELECT file_path
FROM documents
WHERE created_at >= '${CUTOFF}'::timestamptz
  AND file_path <> ''
ORDER BY created_at;
" 2>/dev/null | while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  echo "$path"
done > "$LIST_FILE" || {
  echo "WARN: could not query documents on remote — listing from local fork instead"
  psql_local_fork -Atc "
    SELECT file_path
    FROM documents
    WHERE created_at >= '${CUTOFF}'::timestamptz
      AND file_path <> '';
  " > "$LIST_FILE" 2>/dev/null || true
}

count="$(wc -l < "$LIST_FILE" | tr -d ' ')"
echo "Files referenced since cutoff: $count"
echo "List: $LIST_FILE"

if [[ "$APPLY" != "true" ]]; then
  echo "Preview — first 20 paths:"
  head -20 "$LIST_FILE" || true
  echo "Re-run with --apply to archive copies under $BACKUP_DIR"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
ok=0
miss=0
while IFS= read -r rel; do
  [[ -z "$rel" ]] && continue
  # Normalize: paths may be relative to UPLOAD_DIR or absolute under /app/uploads
  base="${rel#/app/uploads/}"
  base="${base#uploads/}"
  if docker exec "$CONTAINER" test -f "/app/uploads/$base" 2>/dev/null; then
    docker cp "${CONTAINER}:/app/uploads/$base" "$BACKUP_DIR/" 2>/dev/null || docker cp "${CONTAINER}:/app/uploads/$rel" "$BACKUP_DIR/" 2>/dev/null
    ok=$((ok + 1))
  else
    echo "  MISSING: $rel"
    miss=$((miss + 1))
  fi
done < "$LIST_FILE"

echo "Archived: $ok  Missing: $miss  → $BACKUP_DIR"
echo "If uploads use Synology bind mount, rsync $BACKUP_DIR to the shared path manually."
