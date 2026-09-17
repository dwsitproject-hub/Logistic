#!/usr/bin/env bash
# Create be_fork staging schema on remote DB and copy data from local klip-postgres.
# Run on backend host (172.28.92.57) — has access to local fork + remote .60:5442.
#
#   bash docs/scripts/load-be-fork-to-remote-staging.sh
#   DRY_RUN=1 bash docs/scripts/load-be-fork-to-remote-staging.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=docs/scripts/lib/be-fork-migration-common.sh
source "$ROOT/docs/scripts/lib/be-fork-migration-common.sh"

DRY_RUN="${DRY_RUN:-0}"
STAGING_SCHEMA="${BE_FORK_STAGING_SCHEMA:-be_fork}"

load_migration_env "$ROOT"
require_local_fork_postgres

echo "=== Load local fork → remote staging schema $STAGING_SCHEMA ==="
echo "Remote: $REMOTE_DB_HOST:$REMOTE_DB_PORT/$DB_NAME"

if [[ "$DRY_RUN" != "1" ]]; then
  psql_remote -c "SELECT 1" >/dev/null
fi

echo "=== Create staging tables (LIKE public.*) ==="
for t in "${BE_FORK_MERGE_TABLES[@]}"; do
  if [[ "$(table_exists_local "$t")" != "1" ]]; then
    echo "  skip $t (not in local fork)"
    continue
  fi
  if [[ "$(table_exists_remote "$t")" != "1" ]]; then
    echo "  skip $t (not on remote public)"
    continue
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "  [dry-run] CREATE TABLE $STAGING_SCHEMA.$t (LIKE public.$t INCLUDING ALL)"
    continue
  fi
  psql_remote -v ON_ERROR_STOP=1 -c "
    CREATE SCHEMA IF NOT EXISTS ${STAGING_SCHEMA};
    DROP TABLE IF EXISTS ${STAGING_SCHEMA}.${t} CASCADE;
    CREATE TABLE ${STAGING_SCHEMA}.${t} (LIKE public.${t} INCLUDING ALL);
  " >/dev/null
  echo "  + ${STAGING_SCHEMA}.${t}"
done

echo "=== Copy data local → remote staging ==="
TMP_DIR="${TMPDIR:-/tmp}/be_fork_copy_$$"
mkdir -p "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT

for t in "${BE_FORK_MERGE_TABLES[@]}"; do
  if [[ "$(table_exists_local "$t")" != "1" ]]; then
    continue
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    lc="$(row_count_local "$t")"
    echo "  [dry-run] copy $t ($lc rows)"
    continue
  fi
  csv="$TMP_DIR/${t}.csv"
  docker exec klip-postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
    -c "COPY public.${t} TO STDOUT WITH (FORMAT csv, HEADER true)" > "$csv"
  rows="$(($(wc -l < "$csv") - 1))"
  if [[ "$rows" -le 0 ]]; then
    echo "  - $t (empty)"
    continue
  fi
  psql_remote -v ON_ERROR_STOP=1 -c "TRUNCATE ${STAGING_SCHEMA}.${t};"
  psql_remote -v ON_ERROR_STOP=1 -c "COPY ${STAGING_SCHEMA}.${t} FROM STDIN WITH (FORMAT csv, HEADER true)" < "$csv"
  echo "  + $t ($rows rows)"
done

if [[ "$DRY_RUN" != "1" ]]; then
  echo "=== Load merge functions on remote ==="
  psql_remote -v ON_ERROR_STOP=1 -f "$ROOT/docs/scripts/sql/be-fork-merge-functions.sql"
fi

echo "Staging load complete."
