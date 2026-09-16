#!/usr/bin/env bash
#
# READ-ONLY: why an OS Qty gap between Contract Performance and Shipments can survive a deploy.
#
# The multi-STO fix (one discharged STO must not close a PO whose other STO is still Open) reads
# `sto_count` from contract_sto_agg_snapshot. If that snapshot is stale or missing rows, sto_count
# arrives NULL, is treated as 1, and the fix silently does nothing - the deploy looks applied and
# the numbers do not move. That is the first thing to rule out, before any data explanation.
#
#   bash /opt/klip/docs/scripts/diag-os-gap-after-deploy.sh
#
set -u

cd /opt/klip || exit 1
env_val() { sed -n "s/^$1=//p" .env | head -1 | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
export PGPASSWORD="$(env_val DB_PASSWORD)"
PSQL=(psql -P pager=off -h "$(env_val DB_HOST)" -p "$(env_val DB_PORT)" -U "$(env_val DB_USER)" -d "$(env_val DB_NAME)")

echo "== 1. is the STO aggregate the fix depends on actually populated? =="
"${PSQL[@]}" -c "
SELECT COUNT(*)                                   AS rows,
       COUNT(*) FILTER (WHERE sto_count > 1)      AS multi_sto_contracts,
       MAX(refreshed_at)                          AS last_refreshed
FROM contract_sto_agg_snapshot;"

echo
echo "== 2. how many contracts does the multi-STO rule actually change here? =="
echo "   (PO with >1 STO, an ATC recorded, and quantity still outstanding - these should read Open)"
"${PSQL[@]}" -c "
SELECT COUNT(*)                                             AS contracts,
       ROUND(SUM(cps.outstanding_quantity) / 1000)          AS os_mt
FROM contract_performance_snapshot cps
JOIN contract_sto_agg_snapshot sa ON sa.contract_number = cps.contract_id
WHERE sa.sto_count > 1
  AND cps.last_ata_vessel_complete_discharge IS NOT NULL
  AND COALESCE(cps.outstanding_quantity, 0) > 499;"

echo
echo "== 3. snapshot freshness (a stale CP snapshot serves yesterday's numbers) =="
"${PSQL[@]}" -c "
SELECT 'contract_performance' AS snapshot, is_stale::text AS stale FROM contract_performance_snapshot_meta WHERE id = 'global'
UNION ALL SELECT 'contract_latest_spd', is_stale::text FROM contract_latest_spd_snapshot_meta WHERE id = 'global'
UNION ALL SELECT 'contract_qty_move',   is_stale::text FROM contract_qty_move_snapshot_meta   WHERE id = 'global'
UNION ALL SELECT 'contract_sto_agg',    is_stale::text FROM contract_sto_agg_snapshot_meta    WHERE id = 'global';"

echo
echo "== 4. is the deployed backend actually carrying the fix? =="
echo "   (the built file must mention sto_count; if it does not, the build did not include it)"
grep -c "sto_count" /opt/klip/backend/dist/utils/contractDeliveryStatus.js 2>/dev/null \
  || echo "   dist/utils/contractDeliveryStatus.js not found - check the build output path"

echo
echo "== 5. Contract Performance open OS per sea incoterm, computed here =="
echo "   Mirrors what the page applies: blank Region/Site excluded from the total; a contract is"
echo "   Close when nothing is outstanding, or when an ATC exists AND the PO has a single STO."
echo "   NOTE: reads contract_performance_snapshot - refresh it first if step 3 said stale."
"${PSQL[@]}" -c "
WITH rows AS (
  SELECT cps.contract_id,
         UPPER(TRIM(COALESCE(cps.incoterm, ''))) AS incoterm,
         COALESCE(cps.outstanding_quantity, 0)   AS os_kg,
         UPPER(TRIM(COALESCE(cps.import_status, cps.status, ''))) AS raw_status,
         cps.last_ata_vessel_complete_discharge  AS atc,
         COALESCE(sa.sto_count, 1)               AS sto_count,
         COALESCE(NULLIF(TRIM(cps.plant_site), ''), 'Blank') AS plant_site
  FROM contract_performance_snapshot cps
  LEFT JOIN contract_sto_agg_snapshot sa ON sa.contract_number = cps.contract_id
  WHERE COALESCE(cps.sap_presence, 'PRESENT') <> 'WITHDRAWN'
), classified AS (
  SELECT *,
         (raw_status IN ('CANCELLED', 'CANCELED', 'CANCEL'))                       AS is_cancelled,
         (os_kg <= 499 OR (atc IS NOT NULL AND sto_count <= 1))                    AS effectively_done
  FROM rows
)
SELECT incoterm,
       COUNT(*)                        AS open_contracts,
       ROUND(SUM(os_kg) / 1000)        AS open_os_mt
FROM classified
WHERE incoterm IN ('FOB', 'CIF', 'CFR')
  AND NOT is_cancelled
  AND NOT effectively_done
  AND raw_status IN ('OPEN', 'ACTIVE')
  AND UPPER(plant_site) <> 'BLANK'
GROUP BY incoterm
ORDER BY incoterm;"

echo
echo "   Compare those three numbers with the Shipments OS Qty card (FOB / CIF / CFR)."
echo "   Equal      -> the pages agree and any on-screen difference is a stale browser cache."
echo "   Different  -> send both sets of numbers; the gap is then diagnosed per contract."
