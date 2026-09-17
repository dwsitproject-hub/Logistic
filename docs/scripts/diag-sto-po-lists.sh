#!/usr/bin/env bash
#
# READ-ONLY: why the Shipments view table and the edit modal show different PO counts for one STO.
#
# They are not two renderings of one list. They answer different questions, from different sources:
#
#   VIEW TABLE  reads SAP. shipmentListStoPaging.ts takes
#               COALESCE(sla.po_numbers, g.po_numbers_from_join), and sla.po_numbers comes from
#               shipmentListSapAggSql's po_numbers_agg over `data->'raw'->>'PO No'` grouped by the
#               page's sto_key. spd_keyed feeds that from TWO branches: SAP rows whose STO equals
#               the page key, plus - for rows carrying no STO at all - the header rows of every
#               contract linked to the page row. Those header rows bring their own PO numbers,
#               which is how the list can show more POs than the STO itself has.
#
#   EDIT MODAL  reads KLIP. shipmentEditContext.service.ts unions five sources: contract_stos,
#               shipments.shipment_id, shipments.operation_id, user_sto_contract_assignments, and
#               the shipment's own contract. No SAP header rows.
#
# So "which is more valid" depends on the question. SAP is the source of truth for which POs a STO
# belongs to, which is the view table's answer; the modal answers which contracts KLIP has linked.
# This script prints both lists so the difference can be named rather than counted.
#
#   bash /opt/klip/docs/scripts/diag-sto-po-lists.sh 1006019867
#
set -u
STO="${1:?usage: diag-sto-po-lists.sh <STO number>}"

cd /opt/klip || exit 1
env_val() { sed -n "s/^$1=//p" .env | head -1 | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
export PGPASSWORD="$(env_val DB_PASSWORD)"
PSQL=(psql -P pager=off -h "$(env_val DB_HOST)" -p "$(env_val DB_PORT)" -U "$(env_val DB_USER)" -d "$(env_val DB_NAME)")

SQL="
WITH modal AS (
  SELECT DISTINCT c.po_number AS po FROM contract_stos cs JOIN contracts c ON c.id=cs.contract_id
   WHERE TRIM(cs.sto_number::text)='${STO}'
  UNION
  SELECT DISTINCT c.po_number FROM shipments s JOIN contracts c ON c.id=s.contract_id
   WHERE TRIM(COALESCE(s.shipment_id::text,''))='${STO}' AND COALESCE(s.status,'')<>'CANCELLED'
  UNION
  SELECT DISTINCT c.po_number FROM shipments s JOIN contracts c ON c.id=s.contract_id
   WHERE TRIM(COALESCE(s.operation_id::text,''))='${STO}' AND COALESCE(s.status,'')<>'CANCELLED'
  UNION
  SELECT DISTINCT COALESCE(NULLIF(TRIM(u.po_number),''), c.po_number)
    FROM user_sto_contract_assignments u JOIN contracts c ON TRIM(c.contract_id)=TRIM(u.contract_number)
   WHERE TRIM(u.sto_number::text)='${STO}'
),
linked AS (SELECT DISTINCT c.contract_id FROM contract_stos cs JOIN contracts c ON c.id=cs.contract_id
             WHERE TRIM(cs.sto_number::text)='${STO}'),
view_sto AS (
  SELECT DISTINCT NULLIF(TRIM(COALESCE(spd.data->'raw'->>'PO No', spd.data->'raw'->>'PO Number',
                                       spd.data->'raw'->>'PO No.', spd.po_number::text)),'') AS po
    FROM sap_processed_data spd WHERE TRIM(COALESCE(spd.sto_number::text,''))='${STO}'
),
view_header AS (
  SELECT DISTINCT NULLIF(TRIM(COALESCE(spd.data->'raw'->>'PO No', spd.data->'raw'->>'PO Number',
                                       spd.data->'raw'->>'PO No.', spd.po_number::text)),'') AS po
    FROM sap_processed_data spd JOIN linked l ON TRIM(spd.contract_number)=TRIM(l.contract_id)
   WHERE NULLIF(TRIM(COALESCE(spd.sto_number::text,'')),'') IS NULL
),
vt AS (SELECT po FROM view_sto WHERE po IS NOT NULL UNION SELECT po FROM view_header WHERE po IS NOT NULL),
md AS (SELECT po FROM modal WHERE po IS NOT NULL AND TRIM(po)<>'')
SELECT COALESCE(vt.po, md.po) AS po_number,
       (vt.po IS NOT NULL) AS in_view_table,
       (md.po IS NOT NULL) AS in_edit_modal,
       CASE WHEN vt.po IS NOT NULL AND md.po IS NULL THEN 'view table only'
            WHEN md.po IS NOT NULL AND vt.po IS NULL THEN 'edit modal only'
            ELSE 'both' END AS where_it_appears
FROM vt FULL OUTER JOIN md ON md.po = vt.po
ORDER BY 1;"

echo "=== PO by PO: which list each appears in (STO ${STO}) ==="
"${PSQL[@]}" -c "$SQL"

echo
echo "=== totals ==="
"${PSQL[@]}" -c "$SQL" | awk '/\|/{print}' | grep -c "both\|only" | xargs -I{} echo "rows printed: {}"

echo
echo "=== where the view table's extra POs come from (SAP header rows, no STO) ==="
"${PSQL[@]}" -c "
SELECT spd.contract_number, NULLIF(TRIM(spd.po_number::text),'') AS po_column,
       NULLIF(TRIM(spd.data->'raw'->>'PO No'),'') AS po_raw, spd.created_at
FROM sap_processed_data spd
JOIN (SELECT DISTINCT c.contract_id FROM contract_stos cs JOIN contracts c ON c.id=cs.contract_id
       WHERE TRIM(cs.sto_number::text)='${STO}') l ON TRIM(spd.contract_number)=TRIM(l.contract_id)
WHERE NULLIF(TRIM(COALESCE(spd.sto_number::text,'')),'') IS NULL
ORDER BY 1 LIMIT 30;"

echo
echo "DONE - read-only, nothing modified"
