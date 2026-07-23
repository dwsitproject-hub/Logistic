#!/usr/bin/env bash
# Spot-check FRC/LCO Delivery/Receive: Open+WB vs Cancelled inflate vs SAP Close.
# Usage (PuTTY .57 → app DB .60:5442):
#   export PGPASSWORD="$(docker exec klip-backend printenv DB_PASSWORD)"
#   bash docs/scripts/audit-trucking-wb-qty-open-close.sh
#   # or: PO=1001030830 bash docs/scripts/audit-trucking-wb-qty-open-close.sh
set -euo pipefail

PO="${PO:-}"
DB_HOST="${DB_HOST:-$(docker exec klip-backend printenv DB_HOST 2>/dev/null || true)}"
DB_PORT="${DB_PORT:-$(docker exec klip-backend printenv DB_PORT 2>/dev/null || true)}"
DB_NAME="${DB_NAME:-$(docker exec klip-backend printenv DB_NAME 2>/dev/null || echo klip_db)}"
DB_USER="${DB_USER:-$(docker exec klip-backend printenv DB_USER 2>/dev/null || echo postgres)}"
DB_HOST="${DB_HOST:-172.28.92.60}"
DB_PORT="${DB_PORT:-5442}"

if [[ -z "${PGPASSWORD:-}" ]]; then
  PGPASSWORD="$(docker exec klip-backend printenv DB_PASSWORD)"
  export PGPASSWORD
fi

psql_cmd=(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1)

echo "=== DB $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME ==="
echo "=== Confirm any-Open / row_open in running backend ==="
docker exec klip-backend sh -c 'grep -q BOOL_OR dist/utils/contractDeliveryStatus.js && echo OK_BOOL_OR || echo MISSING_BOOL_OR'
docker exec klip-backend sh -c 'grep -q row_open dist/utils/contractDeliveryStatus.js && echo OK_ROW_OPEN || echo MISSING_ROW_OPEN'
docker exec klip-backend sh -c 'grep -q sum_adj dist/utils/truckingQuantitySql.js && echo OK_SAP_DEDUP || echo MISSING_SAP_DEDUP'

if [[ -n "$PO" ]]; then
  echo "=== PO $PO ops + WB (op total) ==="
  "${psql_cmd[@]}" -c "
SELECT t.operation_id, t.status, c.incoterm, c.quantity_ordered,
       (SELECT SUM(COALESCE(da.quantity_delivery_kg, da.quantity_kg))
          FROM trucking_daily_actuals da WHERE da.trucking_operation_id = t.id) AS wb_del,
       (SELECT SUM(COALESCE(da.quantity_receive_kg, 0))
          FROM trucking_daily_actuals da WHERE da.trucking_operation_id = t.id) AS wb_recv
FROM trucking_operations t
JOIN contracts c ON c.id = t.contract_id
WHERE TRIM(c.po_number::text) = trim('$PO');
"

  echo "=== PO $PO WB per sto_number (split check) ==="
  "${psql_cmd[@]}" -c "
SELECT COALESCE(NULLIF(TRIM(da.sto_number), ''), '(empty)') AS sto_number,
       ROUND(SUM(COALESCE(da.quantity_delivery_kg, da.quantity_kg))/1000.0, 2) AS del_mt,
       ROUND(SUM(COALESCE(da.quantity_receive_kg, 0))/1000.0, 2) AS recv_mt,
       COUNT(*) AS row_count
FROM trucking_daily_actuals da
JOIN trucking_operations t ON t.id = da.trucking_operation_id
JOIN contracts c ON c.id = t.contract_id
WHERE TRIM(c.po_number::text) = trim('$PO')
GROUP BY COALESCE(NULLIF(TRIM(da.sto_number), ''), '(empty)')
ORDER BY 1;
"

  echo "=== PO $PO GR STO / SAP (latest-ish per row) ==="
  "${psql_cmd[@]}" -c "
SELECT spd.sto_number,
       spd.data->'raw'->>'GR STO Status' AS gr_sto_raw,
       spd.data->'contract'->>'gr_sto_status' AS gr_sto_contract,
       spd.data->'raw'->>'Quantity Delivery Trucking' AS del,
       spd.data->'raw'->>'Quantity Receive' AS recv,
       spd.created_at
FROM sap_processed_data spd
JOIN contracts c ON c.contract_id = spd.contract_number
WHERE TRIM(c.po_number::text) = trim('$PO')
ORDER BY spd.sto_number NULLS LAST, spd.created_at DESC NULLS LAST;
"
fi

echo "=== Sample: cancelled ops still holding WB (would inflate Contracts before fix) ==="
"${psql_cmd[@]}" -c "
SELECT c.po_number,
       COUNT(*) FILTER (
         WHERE UPPER(TRIM(COALESCE(t.status,''))) IN ('CANCELLED','CANCELED','CANCEL')
       ) AS cancelled_ops_with_join,
       COUNT(*) FILTER (
         WHERE UPPER(TRIM(COALESCE(t.status,''))) NOT IN ('CANCELLED','CANCELED','CANCEL')
       ) AS active_ops
FROM contracts c
JOIN trucking_operations t ON t.contract_id = c.id
WHERE UPPER(TRIM(COALESCE(c.incoterm,''))) IN ('FRC','LCO')
  AND EXISTS (SELECT 1 FROM trucking_daily_actuals da WHERE da.trucking_operation_id = t.id)
GROUP BY c.po_number
HAVING COUNT(*) FILTER (
         WHERE UPPER(TRIM(COALESCE(t.status,''))) IN ('CANCELLED','CANCELED','CANCEL')
       ) > 0
ORDER BY cancelled_ops_with_join DESC
LIMIT 20;
"

echo "Done."
