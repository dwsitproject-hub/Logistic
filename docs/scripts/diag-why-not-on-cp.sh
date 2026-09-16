#!/usr/bin/env bash
#
# READ-ONLY: for named contracts, show which Contract Performance gate each one fails.
#
# Used when the Shipments OS counts a contract that Contract Performance does not. Rather than
# guessing which rule differs, this prints every gate CP applies, per contract, with a verdict
# column - so the reason is read off the row instead of inferred.
#
#   bash /opt/klip/docs/scripts/diag-why-not-on-cp.sh 1004031291 1004031853 9174100048 ...
#
set -u
[ "$#" -gt 0 ] || { echo "usage: $0 <contract_id> [contract_id ...]"; exit 1; }
LIST="'$(printf "%s','" "$@" | sed "s/,'$//")'"

cd /opt/klip || exit 1
env_val() { sed -n "s/^$1=//p" .env | head -1 | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
export PGPASSWORD="$(env_val DB_PASSWORD)"
PSQL=(psql -P pager=off -h "$(env_val DB_HOST)" -p "$(env_val DB_PORT)" -U "$(env_val DB_USER)" -d "$(env_val DB_NAME)")

"${PSQL[@]}" -c "
SELECT base.contract_id,
       base.product,
       base.plant_site,
       base.contract_date,
       ROUND(COALESCE(base.outstanding_quantity,0)/1000) AS os_mt,
       COALESCE(base.import_status,'(null)')             AS gr,
       base.status,
       COALESCE(sa.sto_count,1)                          AS stos,
       (base.last_ata_vessel_complete_discharge IS NOT NULL) AS has_atc,
       COALESCE(base.sap_presence,'PRESENT')             AS sap,
       CASE
         WHEN base.contract_id IS NULL THEN 'absent from the CP snapshot entirely'
         WHEN COALESCE(base.sap_presence,'PRESENT') = 'WITHDRAWN' THEN 'SAP withdrawn'
         WHEN UPPER(TRIM(COALESCE(base.plant_site,''))) IN ('','BLANK') THEN 'blank Region/Site'
         WHEN UPPER(TRIM(COALESCE(
                base.latest_spd_data->'contract'->>'contract_type',
                base.latest_spd_data->>'B2B Flag',''))) = 'B2B'
              AND NULLIF(TRIM(COALESCE(
                base.latest_spd_data->'contract'->>'contract_reference_po',
                base.latest_spd_data->>'CONTRACT REFF PO',
                base.latest_spd_data->>'Contract Reff PO Ini',
                base.latest_spd_data->'raw'->>'Contract Reff PO Ini',
                base.latest_spd_data->'raw'->>'CONTRACT REFF PO')),'') IS NOT NULL
           THEN 'B2B child (counted through its origin)'
         WHEN COALESCE(base.outstanding_quantity,0) <= 499 THEN 'nothing outstanding'
         WHEN UPPER(TRIM(COALESCE(base.import_status, base.status,''))) NOT IN ('OPEN','ACTIVE')
           THEN 'status is not Open'
         WHEN base.last_ata_vessel_complete_discharge IS NOT NULL AND COALESCE(sa.sto_count,1) <= 1
           THEN 'ATC recorded on a single-STO PO'
         ELSE 'passes every CP gate - check the date range and the product/region filter values'
       END AS why_not_on_cp
FROM contract_performance_snapshot base
LEFT JOIN contract_sto_agg_snapshot sa ON sa.contract_number = base.contract_id
WHERE base.contract_id IN (${LIST})
ORDER BY 5 DESC NULLS LAST;"

echo
echo "Contracts listed above with a verdict of 'passes every CP gate' are on Contract Performance"
echo "and the difference is in the slice filters, not the OS rules. Any id that does not appear at"
echo "all is missing from the CP snapshot - refresh it, then re-run."
