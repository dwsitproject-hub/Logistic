#!/usr/bin/env bash
# Post-merge validation: compare counts, health check, mark snapshots stale.
#
# Run on backend host (172.28.92.57):
#   bash docs/scripts/validate-be-fork-merge.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=docs/scripts/lib/be-fork-migration-common.sh
source "$ROOT/docs/scripts/lib/be-fork-migration-common.sh"

load_migration_env "$ROOT"

echo "=== Post-merge validation ==="

# Re-run compare (local fork vs remote — remote should now include merged rows)
bash "$ROOT/docs/scripts/compare-be-fork-vs-remote.sh" || true

echo ""
echo "=== Backend health ==="
if curl -sf "http://localhost:5001/health" >/dev/null 2>&1; then
  curl -s "http://localhost:5001/health" | head -c 500
  echo ""
else
  echo "WARN: http://localhost:5001/health not reachable"
fi

echo ""
echo "=== Mark snapshot caches stale (remote) ==="
psql_remote -v ON_ERROR_STOP=0 <<'SQL' || true
UPDATE contract_sto_agg_snapshot_meta SET is_stale = true WHERE id = 1;
UPDATE contract_qty_move_snapshot_meta SET is_stale = true WHERE id = 1;
UPDATE contract_latest_spd_snapshot_meta SET is_stale = true WHERE id = 1;
SQL

echo ""
echo "=== SAP tri-key duplicates on remote (should be 0 or reviewed) ==="
psql_remote -c "
SELECT contract_number, po_number, sto_number, COUNT(*) AS cnt
FROM sap_processed_data
GROUP BY 1, 2, 3
HAVING COUNT(*) > 1
ORDER BY cnt DESC
LIMIT 10;
" 2>/dev/null || echo "(skip)"

echo ""
echo "Optional: POST /api/pre-planned/rebuild (requires auth token)"
echo "  curl -X POST http://localhost:5001/api/pre-planned/rebuild -H \"Authorization: Bearer <token>\""
echo ""
echo "Validation complete."
