#!/usr/bin/env bash
# Compare row counts and delta-since-cutoff between BE local fork and remote DB server.
#
# Run on backend host (172.28.92.57), from /opt/klip:
#   bash docs/scripts/compare-be-fork-vs-remote.sh
#   BE_FORK_CUTOFF=2026-08-03 bash docs/scripts/compare-be-fork-vs-remote.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=docs/scripts/lib/be-fork-migration-common.sh
source "$ROOT/docs/scripts/lib/be-fork-migration-common.sh"

OUT_DIR="${OUT_DIR:-/opt/klip/backups}"
STAMP="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUT_DIR"

load_migration_env "$ROOT"
require_local_fork_postgres
verify_backend_points_remote

echo "=== Phase 0: inventory BE fork vs remote ==="
echo "Local fork : klip-postgres (docker)"
echo "Remote     : $DB_USER@$REMOTE_DB_HOST:$REMOTE_DB_PORT/$DB_NAME"
echo "Cutoff     : $BE_FORK_CUTOFF"
echo ""

if command -v nc >/dev/null 2>&1; then
  nc -vz "$REMOTE_DB_HOST" "$REMOTE_DB_PORT" || true
fi

REPORT="$OUT_DIR/be_fork_compare_${STAMP}.txt"
{
  printf '%s\n' "stamp=$STAMP cutoff=$BE_FORK_CUTOFF"
  printf '%s\n' "local=klip-postgres remote=$REMOTE_DB_HOST:$REMOTE_DB_PORT"
  printf '%s\n' ""
  printf '%-40s %12s %12s %12s\n' "table" "local_total" "remote_total" "local_delta"
  printf '%s\n' "--------------------------------------------------------------------------------"

  total_delta=0
  for t in "${BE_FORK_MERGE_TABLES[@]}"; do
    local_exists="$(table_exists_local "$t")"
    remote_exists="$(table_exists_remote "$t")"
    if [[ "$local_exists" != "1" ]]; then
      continue
    fi
    lc="$(row_count_local "$t")"
    if [[ "$remote_exists" == "1" ]]; then
      rc="$(row_count_remote "$t")"
    else
      rc="MISSING"
    fi
    delta="$(delta_count_local_since_cutoff "$t" "$BE_FORK_CUTOFF")"
    if [[ "$delta" =~ ^[0-9]+$ ]]; then
      total_delta=$((total_delta + delta))
    fi
    printf '%-40s %12s %12s %12s\n' "$t" "$lc" "$rc" "$delta"
  done

  printf '%s\n' ""
  printf 'approx_local_delta_rows=%s\n' "$total_delta"
} | tee "$REPORT"

echo ""
echo "=== SAP tri-key preview (local fork, since cutoff) ==="
psql_local_fork -c "
SELECT contract_number, po_number, sto_number, COUNT(*) AS cnt
FROM sap_processed_data
WHERE COALESCE(updated_at, created_at) >= '${BE_FORK_CUTOFF}'::timestamptz
GROUP BY 1, 2, 3
HAVING COUNT(*) > 1
ORDER BY cnt DESC
LIMIT 20;
" 2>/dev/null || echo "(sap_processed_data not available or no duplicates)"

echo ""
echo "Report: $REPORT"
