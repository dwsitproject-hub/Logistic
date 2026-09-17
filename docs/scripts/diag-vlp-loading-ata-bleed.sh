#!/usr/bin/env bash
#
# READ-ONLY: loading-port ATAs that look copied from a sibling STO's SAP row.
#
# Companion to diag-vlp-ata-bleed.sh, which covered the DISCHARGE port. Same underlying cause:
# the SAP port lookup once fell back to a PO-wide row, and mergeSapPortValue is fill-gaps-only,
# so anything written before that lookup was fixed is never corrected by a later import.
#
# Loading ports need a stricter rule than discharge, and that is the point of this script.
#
# Several STOs under one PO can legitimately share ONE vessel voyage. If SAP recorded the loading
# dates on only one of those STO rows, the others genuinely have no value of their own - and the
# date they show is correct, not bled. The discharge rule ("own STO has no such value in SAP")
# would delete those. On dev it flags 80 rows for ata_loading_completed alone, and 16 of them are
# siblings on the SAME vessel, i.e. plausibly legitimate.
#
# So this adds a third condition: a sibling shipment under the same contract holds the identical
# date on a DIFFERENT vessel. Two different ships cannot finish loading at the same moment, so
# combined with the other two conditions the copy explanation is the only sensible one. That is
# also the exact shape of the reported case - PO 1001029907's two shipments carry
# MT. GIAT ARMADA 02 and MT.ANGGRAINI SPIRIT.
#
# On dev the three tiers are 53 / 16 / 11 (different vessel / same vessel / no sibling shares it).
# Only the first tier is proposed for repair; the other two are reported so they can be judged.
#
# Note on the SAP keys, which are not what the code first suggests. For loading port 1 the service
# reads `ata_loading_completed_at_loading_port_1` before falling back to `ata_vessel_completed_loading`,
# but the per-port key exists on ZERO of 27,003 rows - the same dead-code pattern already found on
# the discharge side. The live keys are the ones used below. (Loading ports 2 and 3 read
# `ata_loading_completed_at_loading_port_2/3` with NO fallback, so they can never receive a
# completed-loading date at all. Recorded, not addressed here.)
#
#   bash /opt/klip/docs/scripts/diag-vlp-loading-ata-bleed.sh            # whole database
#   bash /opt/klip/docs/scripts/diag-vlp-loading-ata-bleed.sh 1006019867 # plus a specific STO
#
set -u
STO="${1:-}"

cd /opt/klip || exit 1
env_val() { sed -n "s/^$1=//p" .env | head -1 | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
export PGPASSWORD="$(env_val DB_PASSWORD)"
PSQL=(psql -P pager=off -h "$(env_val DB_HOST)" -p "$(env_val DB_PORT)" -U "$(env_val DB_USER)" -d "$(env_val DB_NAME)")

CTE="WITH base AS (
  SELECT vp.id AS vlp_id, s.id AS ship_uuid, s.contract_id AS contract_uuid, c.po_number,
         NULLIF(TRIM(s.shipment_id::text),'') AS own_sto,
         NULLIF(TRIM(s.operation_id::text),'') AS own_op,
         NULLIF(TRIM(s.vessel_name),'') AS vessel,
         vp.port_name, vp.port_sequence,
         vp.ata_vessel_arrival::date AS a_arr, vp.sap_ata_vessel_arrival AS m_arr,
         vp.ata_vessel_berthed::date AS a_brt, vp.sap_ata_vessel_berthed AS m_brt,
         vp.ata_loading_start::date AS a_str, vp.sap_ata_loading_start AS m_str,
         vp.ata_loading_completed::date AS a_cmp, vp.sap_ata_loading_completed AS m_cmp,
         vp.ata_vessel_sailed::date AS a_sld, vp.sap_ata_vessel_sailed AS m_sld
  FROM shipments s
  LEFT JOIN contracts c ON c.id = s.contract_id
  JOIN vessel_loading_ports vp ON vp.shipment_id = s.id
  WHERE COALESCE(vp.is_discharge_port,false) = false
    AND NULLIF(TRIM(s.shipment_id::text),'') IS NOT NULL
),
f(field, sap_key) AS (VALUES
  ('ata_vessel_arrival','ata_vessel_arrival_at_loading_port_1'),
  ('ata_vessel_berthed','ata_vessel_berthed_at_loading_port_1'),
  ('ata_loading_start','ata_vessel_start_loading'),
  ('ata_loading_completed','ata_vessel_completed_loading'),
  ('ata_vessel_sailed','ata_vessel_sailed_from_loading_port')
),
x AS (
  SELECT b.*, f.field, f.sap_key,
    CASE f.field WHEN 'ata_vessel_arrival' THEN a_arr WHEN 'ata_vessel_berthed' THEN a_brt
                 WHEN 'ata_loading_start' THEN a_str WHEN 'ata_loading_completed' THEN a_cmp
                 ELSE a_sld END AS val,
    CASE f.field WHEN 'ata_vessel_arrival' THEN m_arr WHEN 'ata_vessel_berthed' THEN m_brt
                 WHEN 'ata_loading_start' THEN m_str WHEN 'ata_loading_completed' THEN m_cmp
                 ELSE m_sld END AS mirror
  FROM base b CROSS JOIN f
),
cand AS (
  SELECT * FROM x
  WHERE val IS NOT NULL
    AND val IS NOT DISTINCT FROM mirror
    AND NOT EXISTS (
      SELECT 1 FROM sap_processed_data spd
      WHERE TRIM(COALESCE(spd.sto_number::text,'')) IN (x.own_sto, COALESCE(x.own_op,'~'))
        AND NULLIF(TRIM(spd.data->'shipment'->>x.sap_key),'') IS NOT NULL)
),
tiered AS (
  SELECT c.*,
    EXISTS (SELECT 1 FROM x sib WHERE sib.contract_uuid = c.contract_uuid
              AND sib.ship_uuid <> c.ship_uuid AND sib.field = c.field AND sib.val = c.val
              AND sib.vessel IS DISTINCT FROM c.vessel) AS sibling_other_vessel,
    EXISTS (SELECT 1 FROM x sib WHERE sib.contract_uuid = c.contract_uuid
              AND sib.ship_uuid <> c.ship_uuid AND sib.field = c.field AND sib.val = c.val) AS sibling_shares
  FROM cand c
)"

echo "=== A. per field: how many, and which tier ==="
"${PSQL[@]}" -c "$CTE
SELECT field,
  COUNT(*) AS candidates,
  COUNT(*) FILTER (WHERE sibling_other_vessel) AS repair_different_vessel,
  COUNT(*) FILTER (WHERE sibling_shares AND NOT sibling_other_vessel) AS same_vessel_probably_legit,
  COUNT(*) FILTER (WHERE NOT sibling_shares) AS no_sibling_shares_it
FROM tiered GROUP BY field ORDER BY field;"

echo
echo "=== B. proposed repair rows: sibling on a DIFFERENT vessel (first 40) ==="
"${PSQL[@]}" -c "$CTE
SELECT po_number, own_sto, port_name, port_sequence, field, val, vessel
FROM tiered WHERE sibling_other_vessel ORDER BY po_number, own_sto, field LIMIT 40;"

if [ -n "$STO" ]; then
  echo
  echo "=== C. rows for STO $STO, with the tier each falls in ==="
  "${PSQL[@]}" -c "$CTE
  SELECT po_number, own_sto, port_name, field, val, vessel,
         sibling_other_vessel AS would_be_repaired, sibling_shares
  FROM tiered WHERE own_sto = '${STO}' ORDER BY field;"
fi

echo
echo "DONE - read-only, nothing modified"
