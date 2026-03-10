-- Align contracts.status with sap_processed_data.data->...->'Status'
-- Keep backward compatibility with legacy values ('ACTIVE','COMPLETED','CANCELLED').

-- 1) Relax/replace the check constraint and default
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_status_check;
ALTER TABLE contracts ALTER COLUMN status SET DEFAULT 'Open';
ALTER TABLE contracts
  ADD CONSTRAINT contracts_status_check
  CHECK (status IN ('Open','Close','Cancelled','ACTIVE','COMPLETED','CANCELLED'));

-- 2) Backfill contracts.status from the latest SAP processed status per contract
WITH latest_status AS (
  SELECT DISTINCT ON (spd.contract_number)
    spd.contract_number,
    COALESCE(
      NULLIF(TRIM(spd.data->'raw'->>'Status'), ''),
      NULLIF(TRIM(spd.data->>'Status'), ''),
      NULLIF(TRIM(spd.data->'contract'->>'status'), ''),
      NULLIF(TRIM(spd.data->'contract'->>'Status'), '')
    ) AS sap_status
  FROM sap_processed_data spd
  WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
  ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
)
UPDATE contracts c
SET
  status = CASE
    WHEN UPPER(TRIM(ls.sap_status)) IN ('OPEN','ACTIVE') THEN 'Open'
    WHEN UPPER(TRIM(ls.sap_status)) IN ('CLOSE','CLOSED','COMPLETED','COMPLETE') THEN 'Close'
    WHEN UPPER(TRIM(ls.sap_status)) IN ('CANCELLED','CANCELED','CANCEL') THEN 'Cancelled'
    ELSE c.status
  END,
  updated_at = CURRENT_TIMESTAMP
FROM latest_status ls
WHERE ls.contract_number = c.contract_id
  AND ls.sap_status IS NOT NULL;

-- 3) If still legacy ACTIVE and no SAP status, treat as Open
UPDATE contracts
SET status = 'Open', updated_at = CURRENT_TIMESTAMP
WHERE status = 'ACTIVE';

