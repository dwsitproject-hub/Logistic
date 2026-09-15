#!/usr/bin/env bash
#
# READ-ONLY: find vessel_loading_ports ATA values that came from another STO's SAP row.
#
# Background. The discharge-port row's `ata_loading_completed` is what supplies the ATC a user
# sees when shipments.ata_discharge_complete and the manual override are both empty
# (sqlKlipStoredAtaCompleteDischarge = COALESCE(s.ata_discharge_complete, vlpd.ata_loading_completed)).
#
# The SAP port lookup used to fall back to a PO-wide row, so a shipment could be written with its
# SIBLING STO's dates. That lookup has since been fixed (sto_match_rank prefers a direct STO hit),
# but mergeSapPortValue is fill-gaps-only - `if (hasCurrent) return current` - so a value written
# back then is never corrected by a later import. Dev is clean; production still carries the
# legacy rows.
#
# Detection rule, and why each clause is there:
#   - discharge port rows only, with an ATA set                 (that is what feeds the ATC)
#   - ata_loading_completed EQUALS sap_ata_loading_completed    (SAP-sourced, not typed by a user)
#   - the shipment's OWN STO has no such value in SAP           (so it cannot have come from there)
#
# `own STO` deliberately means shipments.shipment_id, NOT contracts.sto_number. One contract row
# can carry two STOs, and using the contract's value is precisely the conflation that caused the
# bug - including it here hid every case (0 found) until it was removed.
#
# The SAP field is data->'shipment'->>'ata_vessel_completed_discharge'. Its sibling key
# 'ata_discharging_completed_at_discharge_port' is read first by the service but does not exist on
# a single one of the 27,003 dev rows, so it is dead and not tested here.
#
#   bash /opt/klip/docs/scripts/diag-vlp-ata-bleed.sh            # whole database
#   bash /opt/klip/docs/scripts/diag-vlp-ata-bleed.sh 1006019867 # plus a specific STO
#
set -u
STO="${1:-}"

cd /opt/klip || exit 1
env_val() { sed -n "s/^$1=//p" .env | head -1 | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
export PGPASSWORD="$(env_val DB_PASSWORD)"
PSQL=(psql -h "$(env_val DB_HOST)" -p "$(env_val DB_PORT)" -U "$(env_val DB_USER)" -d "$(env_val DB_NAME)")

CTE="WITH v AS (
  SELECT vp.id AS vlp_id, s.id AS ship_uuid, c.contract_id, c.po_number,
         NULLIF(TRIM(s.shipment_id::text),'') AS own_sto,
         NULLIF(TRIM(s.operation_id::text),'') AS own_op,
         vp.port_name, vp.ata_loading_completed::date AS ata,
         vp.sap_ata_loading_completed AS sap_mirror
  FROM shipments s
  LEFT JOIN contracts c ON c.id = s.contract_id
  JOIN vessel_loading_ports vp ON vp.shipment_id = s.id
  WHERE COALESCE(vp.is_discharge_port,false) = true
    AND vp.ata_loading_completed IS NOT NULL
),
bleed AS (
  SELECT * FROM v
  WHERE ata IS NOT DISTINCT FROM sap_mirror
    AND own_sto IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM sap_processed_data spd
      WHERE TRIM(COALESCE(spd.sto_number::text,'')) IN (v.own_sto, COALESCE(v.own_op,'~'))
        AND NULLIF(TRIM(spd.data->'shipment'->>'ata_vessel_completed_discharge'),'') IS NOT NULL
    )
)"

echo "=== A. scale: how many discharge ATAs are affected ==="
"${PSQL[@]}" -c "$CTE
SELECT (SELECT COUNT(*) FROM v) AS discharge_rows_with_ata,
       (SELECT COUNT(*) FROM v WHERE ata IS NOT DISTINCT FROM sap_mirror) AS sap_sourced,
       (SELECT COUNT(*) FROM v WHERE ata IS DISTINCT FROM sap_mirror) AS user_typed_untouched,
       (SELECT COUNT(*) FROM bleed) AS repair_candidates;"

echo
echo "=== B. the affected rows (first 40) ==="
"${PSQL[@]}" -c "$CTE SELECT po_number, own_sto, port_name, ata FROM bleed ORDER BY po_number LIMIT 40;"

if [ -n "$STO" ]; then
  echo
  echo "=== C. is the reported STO $STO detected? (expect 1 row) ==="
  "${PSQL[@]}" -c "$CTE SELECT po_number, own_sto, port_name, ata FROM bleed WHERE own_sto = '${STO}';"
fi

echo
echo "DONE - read-only, nothing modified"
