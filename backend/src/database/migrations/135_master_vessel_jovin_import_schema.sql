-- Master Vessel: vessel_type rename, SAP vendor code, provisional code status
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'master_vessels'
      AND column_name = 'hull_type'
  ) THEN
    ALTER TABLE master_vessels RENAME COLUMN hull_type TO vessel_type;
  END IF;
END $$;

ALTER TABLE master_vessels
  ADD COLUMN IF NOT EXISTS sap_vendor_code VARCHAR(50);

ALTER TABLE master_vessels
  ADD COLUMN IF NOT EXISTS code_status VARCHAR(20) NOT NULL DEFAULT 'OFFICIAL';

ALTER TABLE master_vessels
  DROP CONSTRAINT IF EXISTS chk_master_vessels_code_status;

ALTER TABLE master_vessels
  ADD CONSTRAINT chk_master_vessels_code_status
  CHECK (code_status IN ('OFFICIAL', 'PROVISIONAL'));

CREATE INDEX IF NOT EXISTS idx_master_vessels_sap_vendor_code
  ON master_vessels (sap_vendor_code);

CREATE INDEX IF NOT EXISTS idx_master_vessels_code_status
  ON master_vessels (code_status);

CREATE INDEX IF NOT EXISTS idx_master_vessels_vessel_name_upper
  ON master_vessels (upper(trim(vessel_name)));

UPDATE master_vessels
SET code_status = 'PROVISIONAL'
WHERE upper(trim(vessel_code)) LIKE 'TMP-%';
