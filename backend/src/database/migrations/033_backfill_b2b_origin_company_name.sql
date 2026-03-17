-- Backfill company_name for B2B "origin" contracts:
-- Origin contract: contract_type is B2B and contract_reference_po is empty.
-- Logic: find child contracts where child.contract_reference_po = origin.contract_id,
-- take the latest contract_date among children, and copy that child's company_name into origin.
-- Safe to re-run.

WITH latest_spd AS (
  SELECT DISTINCT ON (contract_number)
    contract_number,
    data,
    created_at
  FROM sap_processed_data
  WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''
  ORDER BY contract_number, created_at DESC NULLS LAST
),
origin AS (
  SELECT
    c.id AS origin_id,
    c.contract_id AS origin_contract_id
  FROM contracts c
  LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
  WHERE
    UPPER(COALESCE(l.data->'contract'->>'contract_type', l.data->>'B2B Flag', c.contract_type::text, '')) = 'B2B'
    AND COALESCE(NULLIF(TRIM(COALESCE(l.data->'contract'->>'contract_reference_po', l.data->>'CONTRACT REFF PO', '')), ''), '') = ''
),
children AS (
  SELECT
    o.origin_id,
    c2.id AS child_id,
    c2.contract_date
  FROM origin o
  JOIN contracts c2 ON 1=1
  LEFT JOIN latest_spd l2 ON l2.contract_number = c2.contract_id
  WHERE NULLIF(TRIM(COALESCE(l2.data->'contract'->>'contract_reference_po', l2.data->>'CONTRACT REFF PO')), '') = o.origin_contract_id
),
latest_child AS (
  SELECT DISTINCT ON (origin_id)
    origin_id,
    child_id
  FROM children
  ORDER BY origin_id, contract_date DESC NULLS LAST
)
UPDATE contracts o
SET company_name = COALESCE(NULLIF(TRIM(c.company_name), ''), o.company_name)
FROM latest_child lc
JOIN contracts c ON c.id = lc.child_id
WHERE o.id = lc.origin_id
  AND COALESCE(NULLIF(TRIM(o.company_name), ''), '') = '';

