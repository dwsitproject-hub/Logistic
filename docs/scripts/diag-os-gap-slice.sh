#!/usr/bin/env bash
#
# READ-ONLY: pin down an OS gap on ONE filtered slice between Contract Performance and Shipments.
#
# The rule learned the hard way in this investigation: reproduce the page's own number FIRST. Two
# hypotheses were tested on the dev copy and generalised to production without checking, and both
# were wrong there; a third looked plausible until the query turned out not to reproduce Contract
# Performance's figure at all (55,653 against 47,153 on screen), which made any diff on top of it
# meaningless. Step 1 is therefore a gate, not a formality.
#
# What the page applies, and what step 1 now mirrors:
#   - contract_date within the range (the UI defaults to year-to-date)
#   - B2B child contracts excluded (they are counted through their origin)
#   - PO-{po} placeholder rows excluded where a real contract exists for that PO
#   - blank Region/Site excluded from the total
#   - Close when nothing is outstanding, or an ATC exists AND the PO has a single STO
#
#   bash /opt/klip/docs/scripts/diag-os-gap-slice.sh [PRODUCT] [REGION] [INCOTERM] [FROM] [TO]
#   bash /opt/klip/docs/scripts/diag-os-gap-slice.sh CPO BONTANG FOB 2026-01-01 2026-12-31
#
set -u
PRODUCT="${1:-CPO}"
REGION="${2:-BONTANG}"
INCOTERM="${3:-FOB}"
DFROM="${4:-$(date +%Y)-01-01}"
DTO="${5:-$(date +%Y)-12-31}"

cd /opt/klip || exit 1
env_val() { sed -n "s/^$1=//p" .env | head -1 | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
export PGPASSWORD="$(env_val DB_PASSWORD)"
PSQL=(psql -P pager=off -h "$(env_val DB_HOST)" -p "$(env_val DB_PORT)" -U "$(env_val DB_USER)" -d "$(env_val DB_NAME)")

BASE="FROM contract_performance_snapshot base
LEFT JOIN contract_sto_agg_snapshot sa ON sa.contract_number = base.contract_id
WHERE COALESCE(base.sap_presence, 'PRESENT') <> 'WITHDRAWN'
  AND base.contract_date >= DATE '${DFROM}' AND base.contract_date <= DATE '${DTO}'
  AND NOT (
    UPPER(TRIM(COALESCE(base.latest_spd_data->'contract'->>'contract_type',
                        base.latest_spd_data->>'B2B Flag', ''))) = 'B2B'
    AND NULLIF(TRIM(COALESCE(base.latest_spd_data->'contract'->>'contract_reference_po',
                             base.latest_spd_data->>'CONTRACT REFF PO',
                             base.latest_spd_data->>'Contract Reff PO Ini',
                             base.latest_spd_data->'raw'->>'Contract Reff PO Ini',
                             base.latest_spd_data->'raw'->>'CONTRACT REFF PO')), '') IS NOT NULL
  )
  AND NOT (
    base.contract_id ~ '^PO-'
    AND EXISTS (SELECT 1 FROM contracts c_real
                WHERE NULLIF(TRIM(c_real.po_number::text), '') IS NOT NULL
                  AND TRIM(c_real.po_number::text) = TRIM(SUBSTRING(base.contract_id FROM 4))
                  AND c_real.contract_id !~ '^PO-')
  )
  AND UPPER(TRIM(COALESCE(base.plant_site, ''))) NOT IN ('', 'BLANK')
  AND COALESCE(base.outstanding_quantity, 0) > 499
  AND UPPER(TRIM(COALESCE(base.import_status, base.status, ''))) IN ('OPEN', 'ACTIVE')
  AND NOT (base.last_ata_vessel_complete_discharge IS NOT NULL AND COALESCE(sa.sto_count, 1) <= 1)"

SLICE="AND UPPER(TRIM(COALESCE(base.incoterm, ''))) = '${INCOTERM}'
  AND UPPER(TRIM(COALESCE(base.plant_site, ''))) LIKE '%${REGION}%'
  AND UPPER(TRIM(COALESCE(base.product, '')))    LIKE '%${PRODUCT}%'"

echo "== slice: product ~ ${PRODUCT} / Region-Site ~ ${REGION} / ${INCOTERM} / ${DFROM}..${DTO} =="
echo
echo "== 1. GATE: does this reproduce the Contract Performance figure on screen? =="
echo "   If it does not, stop - nothing built on top of it can be trusted."
"${PSQL[@]}" -c "SELECT COUNT(*) AS contracts, ROUND(SUM(COALESCE(base.outstanding_quantity,0))/1000) AS os_mt ${BASE} ${SLICE};"

echo
echo "== 2. the same total without the incoterm restriction, as a cross-check =="
"${PSQL[@]}" -c "SELECT UPPER(TRIM(COALESCE(base.incoterm,''))) AS incoterm,
       COUNT(*) AS contracts, ROUND(SUM(COALESCE(base.outstanding_quantity,0))/1000) AS os_mt
${BASE}
  AND UPPER(TRIM(COALESCE(base.plant_site,''))) LIKE '%${REGION}%'
  AND UPPER(TRIM(COALESCE(base.product,'')))    LIKE '%${PRODUCT}%'
GROUP BY 1 ORDER BY 3 DESC NULLS LAST;"

echo
echo "== 3. the slice, contract by contract (largest first) =="
echo "   Diff against the Shipments page filtered identically; the extra contracts there are the gap."
"${PSQL[@]}" -c "SELECT base.contract_id, base.product, base.plant_site,
       ROUND(COALESCE(base.outstanding_quantity,0)/1000) AS os_mt,
       COALESCE(sa.sto_count,1) AS stos, base.contract_date,
       COALESCE(base.import_status,'(null)') AS gr, base.status
${BASE} ${SLICE}
ORDER BY 4 DESC NULLS LAST;"
