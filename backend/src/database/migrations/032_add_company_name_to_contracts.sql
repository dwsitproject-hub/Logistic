-- Add company_name to contracts and backfill from latest SAP processed data Buyer
-- Safe to re-run.

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS company_name TEXT;

-- Backfill using latest sap_processed_data per contract_number.
WITH latest_spd AS (
  SELECT DISTINCT ON (contract_number)
    contract_number,
    data,
    created_at
  FROM sap_processed_data
  WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''
  ORDER BY contract_number, created_at DESC NULLS LAST
)
UPDATE contracts c
SET company_name = COALESCE(
  NULLIF(TRIM(latest_spd.data->'raw'->>'Buyer'), ''),
  NULLIF(TRIM(latest_spd.data->>'Buyer'), '')
)
FROM latest_spd
WHERE c.contract_id = latest_spd.contract_number
  AND COALESCE(NULLIF(TRIM(c.company_name), ''), '') = '';

