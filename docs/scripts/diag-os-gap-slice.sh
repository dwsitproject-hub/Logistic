#!/usr/bin/env bash
#
# READ-ONLY: pin down an OS gap on ONE filtered slice (default: product CPO, Region/Site BONTANG,
# incoterm FOB) between Contract Performance and Shipments.
#
# Written after two hypotheses were tested on the dev copy and generalised to production without
# checking - both were wrong there. This runs every check against production data directly:
#
#   1. reproduce the Contract Performance figure for the slice
#   2. do the two pages even agree on which contracts are in this Region/Site?
#   3. do they agree on which are in this product?
#   4. list the contracts, so the remainder can be diffed against the Shipments drilldown
#
#   bash /opt/klip/docs/scripts/diag-os-gap-slice.sh [PRODUCT] [REGION] [INCOTERM]
#   bash /opt/klip/docs/scripts/diag-os-gap-slice.sh CPO BONTANG FOB
#
set -u
PRODUCT="${1:-CPO}"
REGION="${2:-BONTANG}"
INCOTERM="${3:-FOB}"

cd /opt/klip || exit 1
env_val() { sed -n "s/^$1=//p" .env | head -1 | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
export PGPASSWORD="$(env_val DB_PASSWORD)"
PSQL=(psql -P pager=off -h "$(env_val DB_HOST)" -p "$(env_val DB_PORT)" -U "$(env_val DB_USER)" -d "$(env_val DB_NAME)")

OPEN_PRED="COALESCE(cps.outstanding_quantity,0) > 499
  AND UPPER(TRIM(COALESCE(cps.import_status, cps.status, ''))) IN ('OPEN','ACTIVE')
  AND NOT (cps.last_ata_vessel_complete_discharge IS NOT NULL AND COALESCE(sa.sto_count,1) <= 1)"

echo "== slice: product ~ ${PRODUCT} / Region-Site ~ ${REGION} / incoterm ${INCOTERM} =="
echo
echo "== 1. Contract Performance figure for this slice =="
"${PSQL[@]}" -c "
SELECT COUNT(*) AS contracts, ROUND(SUM(COALESCE(cps.outstanding_quantity,0))/1000) AS os_mt
FROM contract_performance_snapshot cps
LEFT JOIN contract_sto_agg_snapshot sa ON sa.contract_number = cps.contract_id
WHERE UPPER(TRIM(COALESCE(cps.incoterm,''))) = '${INCOTERM}'
  AND UPPER(TRIM(COALESCE(cps.plant_site,''))) LIKE '%${REGION}%'
  AND UPPER(TRIM(COALESCE(cps.product,'')))   LIKE '%${PRODUCT}%'
  AND ${OPEN_PRED};"

echo
echo "== 2. Region/Site: does the SAP discharge destination agree with cps.plant_site? =="
echo "   Rows here are contracts one page puts in ${REGION} and the other does not."
"${PSQL[@]}" -c "
SELECT COALESCE(NULLIF(TRIM(cps.plant_site),''),'Blank')          AS cp_site,
       COALESCE(NULLIF(TRIM(l.discharge_destination),''),'Blank') AS shipments_dest,
       COUNT(*) AS contracts,
       ROUND(SUM(COALESCE(cps.outstanding_quantity,0))/1000) AS os_mt
FROM contract_performance_snapshot cps
LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = cps.contract_id
LEFT JOIN contract_sto_agg_snapshot sa ON sa.contract_number = cps.contract_id
WHERE UPPER(TRIM(COALESCE(cps.incoterm,''))) = '${INCOTERM}'
  AND ${OPEN_PRED}
  AND (UPPER(TRIM(COALESCE(cps.plant_site,''))) LIKE '%${REGION}%'
       OR UPPER(TRIM(COALESCE(l.discharge_destination,''))) LIKE '%${REGION}%')
  AND UPPER(TRIM(COALESCE(cps.plant_site,'')))
      IS DISTINCT FROM UPPER(TRIM(COALESCE(l.discharge_destination,'')))
GROUP BY 1,2 ORDER BY 4 DESC NULLS LAST;"

echo
echo "== 3. Product: STO groups mixing ${PRODUCT} with something else =="
echo "   The Shipments product filter matches the whole STO group's product list."
"${PSQL[@]}" -c "
WITH sto AS (
  SELECT DISTINCT cs.sto_number, c.contract_id, UPPER(TRIM(COALESCE(c.product,''))) AS product
  FROM contract_stos cs JOIN contracts c ON c.id = cs.contract_id
  WHERE NULLIF(TRIM(cs.sto_number::text),'') IS NOT NULL
)
SELECT COUNT(DISTINCT a.contract_id) AS non_${PRODUCT}_contracts_in_a_${PRODUCT}_group,
       ROUND(SUM(DISTINCT COALESCE(cps.outstanding_quantity,0))/1000) AS os_mt
FROM sto a
JOIN sto b ON b.sto_number = a.sto_number AND b.contract_id <> a.contract_id
JOIN contract_performance_snapshot cps ON cps.contract_id = a.contract_id
LEFT JOIN contract_sto_agg_snapshot sa ON sa.contract_number = cps.contract_id
WHERE a.product NOT LIKE '%${PRODUCT}%' AND b.product LIKE '%${PRODUCT}%'
  AND UPPER(TRIM(COALESCE(cps.incoterm,''))) = '${INCOTERM}'
  AND UPPER(TRIM(COALESCE(cps.plant_site,''))) LIKE '%${REGION}%'
  AND ${OPEN_PRED};"

echo
echo "== 4. the slice, contract by contract (largest first) =="
echo "   Diff this against the Shipments page filtered the same way - the extra contracts there"
echo "   are the gap, and naming them ends the guessing."
"${PSQL[@]}" -c "
SELECT cps.contract_id, cps.product, cps.plant_site,
       ROUND(COALESCE(cps.outstanding_quantity,0)/1000) AS os_mt,
       COALESCE(sa.sto_count,1) AS stos,
       cps.import_status, cps.status
FROM contract_performance_snapshot cps
LEFT JOIN contract_sto_agg_snapshot sa ON sa.contract_number = cps.contract_id
WHERE UPPER(TRIM(COALESCE(cps.incoterm,''))) = '${INCOTERM}'
  AND UPPER(TRIM(COALESCE(cps.plant_site,''))) LIKE '%${REGION}%'
  AND UPPER(TRIM(COALESCE(cps.product,'')))   LIKE '%${PRODUCT}%'
  AND ${OPEN_PRED}
ORDER BY 4 DESC NULLS LAST LIMIT 40;"
