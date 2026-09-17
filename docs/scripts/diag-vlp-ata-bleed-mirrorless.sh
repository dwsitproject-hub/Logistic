#!/usr/bin/env bash
#
# READ-ONLY: find copied vessel_loading_ports ATAs that the 169/170 rule can no longer recognise.
#
# Those migrations keyed on `value = sap_* mirror` to prove a date came from SAP rather than from a
# user. That proof does not survive: the two columns are maintained by opposite rules in
# vesselLoadingPortsFromSap.service.ts -
#
#   value   mergeSapPortValue   fill-gaps-only: `if (hasCurrent) return current`
#   mirror  mergeSapSnapshot    no incoming value -> stores NULL
#
# so one import in which SAP sends nothing for that STO nulls the mirror while the stale value
# survives. The row is then indistinguishable, to the old rule, from something a user typed - and is
# left alone forever. STO 1006019958 (Luminor 6) is exactly that: ata_loading_completed 2026-07-22
# with a NULL mirror, the same date as STO 1006019438 (SMS 3000) under the same contract.
#
# This drops the mirror test and leans on the physical one instead: two ships cannot finish at the
# same moment. A row is reported only when ALL of these hold -
#
#   1. the value is set
#   2. the shipment's OWN STO has no such value in SAP        (it cannot have come from there)
#   3. a sibling under the SAME contract holds the identical date on a DIFFERENT vessel
#
# Tier A is the subset the old rule already catches (value = mirror). Tier B is what it misses -
# the mirrorless rows. Nothing is written; read the counts before any cleanup is considered.
#
#   bash /opt/klip/docs/scripts/diag-vlp-ata-bleed-mirrorless.sh
#
set -u

cd /opt/klip || exit 1
env_val() { sed -n "s/^$1=//p" .env | head -1 | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
export PGPASSWORD="$(env_val DB_PASSWORD)"
PSQL=(psql -P pager=off -h "$(env_val DB_HOST)" -p "$(env_val DB_PORT)" -U "$(env_val DB_USER)" -d "$(env_val DB_NAME)")

CANDIDATES="
  SELECT v.id, s.shipment_id AS own_sto, s.vessel_name, s.status,
         COALESCE(v.is_discharge_port, false) AS is_discharge,
         v.ata_loading_completed::date        AS val,
         v.sap_ata_loading_completed::date    AS mirror,
         sib.vessel_name                      AS sibling_vessel,
         sib.shipment_id                      AS sibling_sto
  FROM vessel_loading_ports v
  JOIN shipments s ON s.id = v.shipment_id
  JOIN LATERAL (
    SELECT s2.vessel_name, s2.shipment_id
    FROM shipments s2
    JOIN vessel_loading_ports v2 ON v2.shipment_id = s2.id
    WHERE s2.contract_id = s.contract_id
      AND s2.id <> s.id
      AND COALESCE(v2.is_discharge_port, false) = COALESCE(v.is_discharge_port, false)
      AND v2.ata_loading_completed::date = v.ata_loading_completed::date
      AND NULLIF(TRIM(s2.vessel_name), '') IS DISTINCT FROM NULLIF(TRIM(s.vessel_name), '')
    LIMIT 1
  ) sib ON TRUE
  WHERE v.ata_loading_completed IS NOT NULL
    AND NULLIF(TRIM(s.shipment_id::text), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM sap_processed_data spd
      WHERE TRIM(COALESCE(spd.sto_number::text, '')) IN (
              NULLIF(TRIM(s.shipment_id::text), ''),
              COALESCE(NULLIF(TRIM(s.operation_id::text), ''), '~'))
        AND NULLIF(TRIM(spd.data->'shipment'->>'ata_vessel_complete_discharge'), '') IS NOT NULL
    )
"

echo "== A. how many rows match, split by whether the old rule can still see them =="
"${PSQL[@]}" -c "
WITH c AS (${CANDIDATES})
SELECT CASE WHEN mirror IS NOT NULL AND mirror = val
            THEN 'tier A - mirror intact, old rule catches it'
            ELSE 'tier B - mirror gone, old rule misses it' END AS tier,
       CASE WHEN is_discharge THEN 'discharge' ELSE 'loading' END AS port,
       COUNT(*) AS rows,
       COUNT(DISTINCT own_sto) AS stos
FROM c GROUP BY 1, 2 ORDER BY 1, 2;"

echo
echo "== B. the rows themselves (first 40) =="
"${PSQL[@]}" -c "
WITH c AS (${CANDIDATES})
SELECT own_sto, vessel_name, status,
       CASE WHEN is_discharge THEN 'discharge' ELSE 'loading' END AS port,
       val, COALESCE(mirror::text, '(null)') AS mirror,
       sibling_sto, sibling_vessel
FROM c ORDER BY own_sto, is_discharge LIMIT 40;"

echo
echo "== C. sanity check: are any of these plausibly real user entries? =="
echo "   A user typing the exact date of a DIFFERENT vessel under the same contract is the"
echo "   explanation this rule rejects. Rows where the shipment is already COMPLETED or SAILED"
echo "   deserve a second look before any cleanup - the voyage may genuinely have happened."
"${PSQL[@]}" -c "
WITH c AS (${CANDIDATES})
SELECT status, COUNT(*) AS rows FROM c GROUP BY 1 ORDER BY 2 DESC;"
