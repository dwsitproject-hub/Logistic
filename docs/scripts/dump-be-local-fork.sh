#!/usr/bin/env bash
# Dump the co-located BE fork Postgres (klip-postgres on 172.28.92.57).
# Always targets local docker postgres — never the remote DB server.
#
# Run on backend host (PuTTY → 172.28.92.57), from /opt/klip:
#   bash docs/scripts/dump-be-local-fork.sh
#   FORMAT=plain bash docs/scripts/dump-be-local-fork.sh   # .sql instead of .dump
#   FULL=1 bash docs/scripts/dump-be-local-fork.sh         # entire DB (schema+data)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=docs/scripts/lib/be-fork-migration-common.sh
source "$ROOT/docs/scripts/lib/be-fork-migration-common.sh"

OUT_DIR="${OUT_DIR:-/opt/klip/backups}"
FORMAT="${FORMAT:-custom}"
FULL="${FULL:-0}"
STAMP="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUT_DIR"

load_migration_env "$ROOT"
require_local_fork_postgres

echo "=== BE local fork dump (klip-postgres container) ==="
echo "    DB: $DB_USER@klip-postgres/$DB_NAME"

if [[ "$FULL" == "1" ]]; then
  if [[ "$FORMAT" == "plain" ]]; then
    OUT_FILE="$OUT_DIR/be_fork_full_${STAMP}.sql"
    echo "=== Full pg_dump (plain) → $OUT_FILE ==="
    pg_dump_local_fork --no-owner --no-acl > "$OUT_FILE"
  else
    OUT_FILE="$OUT_DIR/be_fork_full_${STAMP}.dump"
    echo "=== Full pg_dump -Fc → $OUT_FILE ==="
    pg_dump_local_fork -Fc --no-owner --no-acl > "$OUT_FILE"
  fi
else
  EXISTING=()
  for t in "${BE_FORK_MERGE_TABLES[@]}"; do
    exists="$(table_exists_local "$t")"
    if [[ "$exists" == "1" ]]; then
      EXISTING+=("$t")
      echo "  + $t"
    else
      echo "  - $t (skip, not found)"
    fi
  done
  if [[ ${#EXISTING[@]} -eq 0 ]]; then
    echo "ERROR: no transactional tables found in local fork" >&2
    exit 1
  fi
  TABLE_ARGS=()
  for t in "${EXISTING[@]}"; do
    TABLE_ARGS+=(--table="public.$t")
  done
  if [[ "$FORMAT" == "plain" ]]; then
    OUT_FILE="$OUT_DIR/be_fork_txn_${STAMP}.sql"
    echo "=== Transactional data-only pg_dump → $OUT_FILE ==="
    pg_dump_local_fork --data-only --no-owner --no-acl "${TABLE_ARGS[@]}" > "$OUT_FILE"
  else
    OUT_FILE="$OUT_DIR/be_fork_txn_${STAMP}.dump"
    echo "=== Transactional data-only pg_dump -Fc → $OUT_FILE ==="
    pg_dump_local_fork -Fc --data-only --no-owner --no-acl "${TABLE_ARGS[@]}" > "$OUT_FILE"
  fi
fi

COUNT_FILE="$OUT_DIR/be_fork_${STAMP}_counts.txt"
{
  echo "stamp=$STAMP source=klip-postgres(local)"
  echo "file=$OUT_FILE"
  echo "cutoff=$BE_FORK_CUTOFF"
  echo "--- row counts (local fork) ---"
  for t in "${BE_FORK_MERGE_TABLES[@]}"; do
    if [[ "$(table_exists_local "$t")" == "1" ]]; then
      n="$(row_count_local "$t")"
      d="$(delta_count_local_since_cutoff "$t" "$BE_FORK_CUTOFF")"
      printf '%s\t%s\tdelta_since_%s=%s\n' "$n" "$t" "$BE_FORK_CUTOFF" "$d"
    fi
  done
} | tee "$COUNT_FILE"

ls -lh "$OUT_FILE" "$COUNT_FILE"
echo ""
echo "Copy to DB server for staging restore:"
echo "  scp $OUT_FILE ubuntu@${REMOTE_DB_HOST}:/opt/klip-db/backups/"
echo "Done."
