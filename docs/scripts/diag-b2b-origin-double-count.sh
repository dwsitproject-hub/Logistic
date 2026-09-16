#!/usr/bin/env bash
#
# READ-ONLY: the B2B-origin contracts the Shipments OS counts twice.
#
# The Shipments OS is the union of two arms that are supposed to be disjoint:
#
#   EXECUTION arm  attributes a shipment to contracts through shipment_base.contract_numbers,
#                  which is built over `LEFT JOIN contracts c ON c.id = COALESCE(c_origin.id,
#                  c_link.id)` (shipmentB2bOriginSql.ts:29). A shipment attached to a B2B CHILD is
#                  therefore re-attributed to the child's ORIGIN contract.
#
#   BACKLOG arm    excludes a contract only when it has a non-cancelled shipment of its own
#                  (shipments.contract_id) or shares an STO with an active sea shipment
#                  (sqlContractSharesNumericStoWithActiveSeaShipmentExpr).
#
# An origin contract has neither: no shipment row points at it, and it carries no STO. So it is
# counted by the execution arm AND by the backlog arm - the OS is added twice. That breaks the
# disjointness the backlog core documents at shipmentUnplannedHybridSql.ts:203 ("Exactly once,
# either way"), so it is a defect, not a modelling choice.
#
# Measured on the dev copy 2026-09-16: 4 FOB origins, 9,500 MT counted twice - 9,500 of the
# 8,319 MT by which the Shipments FOB OS card exceeded Contract Performance.
#
#   bash /opt/klip/docs/scripts/diag-b2b-origin-double-count.sh
#
set -u

cd /opt/klip || exit 1
env_val() { sed -n "s/^$1=//p" .env | head -1 | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
export PGPASSWORD="$(env_val DB_PASSWORD)"
PSQL=(psql -P pager=off -h "$(env_val DB_HOST)" -p "$(env_val DB_PORT)" -U "$(env_val DB_USER)" -d "$(env_val DB_NAME)")

SQL="
WITH origin_double AS (
  SELECT DISTINCT o.id, o.contract_id, o.incoterm, o.quantity_ordered
  FROM contracts o
  JOIN contract_latest_spd_snapshot l
    ON TRIM(l.contract_reference_po_raw) = TRIM(o.po_number::text)
  JOIN contracts child ON child.contract_id = l.contract_number
  WHERE NULLIF(TRIM(o.po_number::text), '') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM shipments s
      WHERE s.contract_id = child.id
        AND UPPER(TRIM(COALESCE(s.status, ''))) <> 'CANCELLED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM shipments s2
      WHERE s2.contract_id = o.id
        AND UPPER(TRIM(COALESCE(s2.status, ''))) <> 'CANCELLED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM contract_stos cs WHERE cs.contract_id = o.id
    )
)
SELECT
  UPPER(TRIM(COALESCE(incoterm, '(none)'))) AS incoterm,
  COUNT(*)                                  AS origin_contracts,
  ROUND(SUM(COALESCE(quantity_ordered, 0)) / 1000) AS contract_qty_mt
FROM origin_double
GROUP BY 1
ORDER BY 1;
"

echo "== B2B-origin contracts at risk of being counted by both Shipments OS arms =="
"${PSQL[@]}" -c "$SQL"

echo
echo "== the sea-incoterm ones, named =="
"${PSQL[@]}" -c "
SELECT o.contract_id AS origin, o.incoterm,
       ROUND(COALESCE(o.quantity_ordered, 0) / 1000) AS qty_mt,
       child.contract_id AS b2b_child
FROM contracts o
JOIN contract_latest_spd_snapshot l
  ON TRIM(l.contract_reference_po_raw) = TRIM(o.po_number::text)
JOIN contracts child ON child.contract_id = l.contract_number
WHERE UPPER(TRIM(COALESCE(o.incoterm, ''))) IN ('FOB', 'CIF', 'CFR')
  AND NULLIF(TRIM(o.po_number::text), '') IS NOT NULL
  AND EXISTS (SELECT 1 FROM shipments s WHERE s.contract_id = child.id
              AND UPPER(TRIM(COALESCE(s.status, ''))) <> 'CANCELLED')
  AND NOT EXISTS (SELECT 1 FROM shipments s2 WHERE s2.contract_id = o.id
              AND UPPER(TRIM(COALESCE(s2.status, ''))) <> 'CANCELLED')
  AND NOT EXISTS (SELECT 1 FROM contract_stos cs WHERE cs.contract_id = o.id)
ORDER BY o.incoterm, o.contract_id;
"
