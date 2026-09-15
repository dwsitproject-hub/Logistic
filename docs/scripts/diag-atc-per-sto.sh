#!/usr/bin/env bash
#
# READ-ONLY: why does one STO show an ATC that SAP says is NULL?
#
# Run on the BACKEND host (172.28.80.51), which holds the production DB credentials.
# Reads them from /opt/klip/.env - nothing is typed, printed, or left in shell history.
# Every statement is a SELECT.
#
#   bash /opt/klip/docs/scripts/diag-atc-per-sto.sh 1001029907 1006019867
#
set -u
PO="${1:?usage: diag-atc-per-sto.sh <PO number>}"

cd /opt/klip || exit 1

# Read ONLY the DB_* keys, without sourcing the file.
# `. ./.env` executes it, so any value containing spaces or backslashes - the SAP share path
# (\172.30.1.94\APPs\...\IMPORT DATA\...) and the notification e-mail list both do - is parsed
# as commands and produces "command not found" noise, and can leave variables half-set.
env_val() {
  sed -n "s/^$1=//p" .env | head -1 | sed -e 's/^[\"'"'"']//' -e 's/[\"'"'"']$//'
}
DB_HOST_V="$(env_val DB_HOST)"
DB_PORT_V="$(env_val DB_PORT)"
DB_USER_V="$(env_val DB_USER)"
DB_NAME_V="$(env_val DB_NAME)"
export PGPASSWORD="$(env_val DB_PASSWORD)"

if [ -z "$DB_HOST_V" ] || [ -z "$DB_USER_V" ] || [ -z "$DB_NAME_V" ]; then
  echo "Could not read DB_HOST / DB_USER / DB_NAME from /opt/klip/.env - check the key names:"
  grep -oE '^DB_[A-Z_]+' .env
  exit 1
fi

# -P pager=off: psql otherwise pipes into `less`, which stops the script when it is
# backgrounded or piped - the cause of the runs that appeared to die after section 1.
PSQL=(psql -P pager=off -h "$DB_HOST_V" -p "${DB_PORT_V:-5432}" -U "$DB_USER_V" -d "$DB_NAME_V" -v ON_ERROR_STOP=1)

echo "=== 1. KLIP side: one row per shipment under this PO ==="
# If ATC is already wrong HERE, the write path is at fault. If it is correct here,
# the bleed is in how the list reads/groups these rows.
"${PSQL[@]}" -c "
SELECT c.contract_id, c.sto_number AS contract_sto, c.incoterm,
       s.shipment_id AS sto, s.operation_id,
       s.ata_discharge_complete AS atc, s.ata_arrival, s.vessel_name, s.created_at
FROM contracts c
LEFT JOIN shipments s ON s.contract_id = c.id
WHERE TRIM(c.po_number::text) = '${PO}'
ORDER BY c.sto_number, s.created_at;"

echo
echo "=== 2. SAP side: what the import actually carries, per STO ==="
"${PSQL[@]}" -c "
SELECT spd.sto_number AS sto,
       spd.data->'raw'->>'ATA Vessel Complete Discharge' AS atc_a,
       spd.data->'raw'->>'ATA Discharging Completed at Discharge Port' AS atc_b,
       spd.created_at
FROM sap_processed_data spd
WHERE TRIM(COALESCE(spd.po_number::text,'')) = '${PO}'
ORDER BY spd.sto_number, spd.created_at DESC;"

echo
echo "=== 3. Discharge-port rows, which also feed the effective ATC ==="
# Effective ATC = override -> shipments.ata_discharge_complete -> VLP discharge port.
"${PSQL[@]}" -c "
SELECT s.shipment_id AS sto, vlp.port_name, vlp.port_sequence,
       vlp.is_discharge_port, vlp.is_cancelled, vlp.ata_loading_completed
FROM contracts c
JOIN shipments s ON s.contract_id = c.id
LEFT JOIN vessel_loading_ports vlp ON vlp.shipment_id = s.id
WHERE TRIM(c.po_number::text) = '${PO}'
ORDER BY s.shipment_id, vlp.port_sequence;"

echo
echo "=== 4. Manual ATA overrides, the highest-priority source ==="
"${PSQL[@]}" -c "
SELECT s.shipment_id AS sto, sao.*
FROM contracts c
JOIN shipments s ON s.contract_id = c.id
JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
WHERE TRIM(c.po_number::text) = '${PO}';"

echo
echo "DONE - read-only, nothing modified"

echo
echo "=== 5. PO sets per source for one STO (view table vs edit modal mismatch) ==="
# The edit modal builds its PO list from contract_stos / shipments.shipment_id /
# shipments.operation_id / user assignments; the view table aggregates its own STO group. On dev
# all four sources agreed (5 POs, identical), so a 6-vs-4 split in production means these sources
# disagree THERE. This prints each one separately so the extra/missing POs are named, not counted.
STO="${2:-}"
if [ -n "$STO" ]; then
  "${PSQL[@]}" -c "
  SELECT 'contract_stos' AS source, COUNT(DISTINCT c.po_number) AS n,
         STRING_AGG(DISTINCT c.po_number, ', ' ORDER BY c.po_number) AS pos
  FROM contract_stos cs JOIN contracts c ON c.id = cs.contract_id
  WHERE TRIM(cs.sto_number::text) = '${STO}'
  UNION ALL
  SELECT 'shipments.shipment_id', COUNT(DISTINCT c.po_number),
         STRING_AGG(DISTINCT c.po_number, ', ' ORDER BY c.po_number)
  FROM shipments s JOIN contracts c ON c.id = s.contract_id
  WHERE TRIM(COALESCE(s.shipment_id::text,'')) = '${STO}' AND COALESCE(s.status,'') <> 'CANCELLED'
  UNION ALL
  SELECT 'shipments.operation_id', COUNT(DISTINCT c.po_number),
         STRING_AGG(DISTINCT c.po_number, ', ' ORDER BY c.po_number)
  FROM shipments s JOIN contracts c ON c.id = s.contract_id
  WHERE TRIM(COALESCE(s.operation_id::text,'')) = '${STO}' AND COALESCE(s.status,'') <> 'CANCELLED'
  UNION ALL
  SELECT 'user_sto_assignments', COUNT(DISTINCT COALESCE(NULLIF(TRIM(u.po_number),''), c.po_number)),
         STRING_AGG(DISTINCT COALESCE(NULLIF(TRIM(u.po_number),''), c.po_number), ', ')
  FROM user_sto_contract_assignments u JOIN contracts c ON TRIM(c.contract_id)=TRIM(u.contract_number)
  WHERE TRIM(u.sto_number::text) = '${STO}'
  UNION ALL
  SELECT 'SAP spd (po per sto)', COUNT(DISTINCT TRIM(spd.po_number::text)),
         STRING_AGG(DISTINCT TRIM(spd.po_number::text), ', ' ORDER BY TRIM(spd.po_number::text))
  FROM sap_processed_data spd
  WHERE TRIM(COALESCE(spd.sto_number::text,'')) = '${STO}';"
else
  echo "(pass a STO as the 2nd argument to run this section)"
fi
