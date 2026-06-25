#!/usr/bin/env bash
# Run Tanjung Pura contract status bulk update on SIT backend (172.28.92.57).
# Usage:
#   cd /opt/klip
#   bash docs/scripts/run-update-contract-status-tanjung-pura.sh          # preview (ROLLBACK on exit)
#   bash docs/scripts/run-update-contract-status-tanjung-pura.sh --apply    # COMMIT
set -euo pipefail

APPLY=false
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=true
fi

SQL_FILE="docs/update_contract_status_tanjung_pura.sql"
if [[ ! -f "$SQL_FILE" ]]; then
  echo "Missing $SQL_FILE — git pull origin SIT first." >&2
  exit 1
fi

COMPOSE="docker compose -f docker-compose.backend.yml"
CONTAINER="klip-postgres"

docker cp "$SQL_FILE" "${CONTAINER}:/tmp/update_contract_status_tanjung_pura.sql"

if $APPLY; then
  echo "=== APPLY mode (will COMMIT) ==="
  $COMPOSE exec -T postgres psql -U "${DB_USER:-postgres}" -d "${DB_NAME:-klip_db}" \
    -v ON_ERROR_STOP=1 \
    -f /tmp/update_contract_status_tanjung_pura.sql \
    -c "COMMIT;"
  echo "Done. Changes committed."
else
  echo "=== DRY-RUN (transaction rolled back when psql exits) ==="
  $COMPOSE exec -T postgres psql -U "${DB_USER:-postgres}" -d "${DB_NAME:-klip_db}" \
    -v ON_ERROR_STOP=1 \
    -f /tmp/update_contract_status_tanjung_pura.sql
  echo ""
  echo "Review output above. To save: bash docs/scripts/run-update-contract-status-tanjung-pura.sh --apply"
fi
