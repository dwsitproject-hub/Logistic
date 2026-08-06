#!/usr/bin/env bash
# Apply delta merge from be_fork staging schema into public on remote DB server.
#
# Run on backend host (172.28.92.57) after load-be-fork-to-remote-staging.sh:
#   bash docs/scripts/apply-be-fork-merge.sh           # dry-run preview
#   bash docs/scripts/apply-be-fork-merge.sh --apply   # execute merge
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=docs/scripts/lib/be-fork-migration-common.sh
source "$ROOT/docs/scripts/lib/be-fork-migration-common.sh"

APPLY=false
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=true
elif [[ -n "${1:-}" && "${1:-}" != "-h" && "${1:-}" != "--help" ]]; then
  echo "Unknown arg: $1 (use --apply or no args for preview)" >&2
  exit 1
fi

STAGING_SCHEMA="${BE_FORK_STAGING_SCHEMA:-be_fork}"
CUTOFF="${BE_FORK_CUTOFF:-2026-08-03}"

load_migration_env "$ROOT"
verify_backend_points_remote

echo "=== BE fork merge ${APPLY:+APPLY}${APPLY:-PREVIEW} ==="
echo "Remote : $REMOTE_DB_HOST:$REMOTE_DB_PORT/$DB_NAME"
echo "Staging: $STAGING_SCHEMA"
echo "Cutoff : $CUTOFF"
echo ""

psql_remote -v ON_ERROR_STOP=1 -f "$ROOT/docs/scripts/sql/be-fork-merge-functions.sql" >/dev/null 2>&1 || true

TOTAL_INS=0
TOTAL_UPD=0

for t in "${BE_FORK_MERGE_TABLES[@]}"; do
  exists="$(psql_remote -Atc "
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='$STAGING_SCHEMA' AND table_name='$t' LIMIT 1
  " 2>/dev/null || true)"
  if [[ "$exists" != "1" ]]; then
    continue
  fi

  new_ids="$(psql_remote -Atc "SELECT be_fork.preview_new_ids('$t', '$CUTOFF'::timestamptz)" 2>/dev/null || echo "?")"

  if [[ "$APPLY" == "true" ]]; then
    result="$(psql_remote -Atc "SELECT * FROM be_fork.merge_table('$t', '$CUTOFF'::timestamptz)" 2>&1)" || {
      echo "ERROR merging $t: $result" >&2
      exit 1
    }
    ins="$(echo "$result" | cut -d'|' -f1)"
    upd="$(echo "$result" | cut -d'|' -f2)"
    TOTAL_INS=$((TOTAL_INS + ins))
    TOTAL_UPD=$((TOTAL_UPD + upd))
    echo "  $t: inserted=$ins updated=$upd new_ids_preview=$new_ids"
  else
    delta="$(psql_remote -Atc "
      SELECT COUNT(*) FROM ${STAGING_SCHEMA}.${t} b
      WHERE COALESCE(b.updated_at, b.created_at) >= '${CUTOFF}'::timestamptz
    " 2>/dev/null || echo "?")"
    echo "  $t: staging_delta=$delta new_ids=$new_ids"
  fi
done

echo ""
if [[ "$APPLY" == "true" ]]; then
  echo "Merge applied: total_inserted=$TOTAL_INS total_updated=$TOTAL_UPD"
else
  echo "Preview only. Re-run with --apply to execute merge."
fi
