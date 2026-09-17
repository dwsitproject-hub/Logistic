-- SAP snapshot columns on vessel_loading_ports (KLIP effective vs SAP reference for comparison UI).
-- sap_* is populated from SAP import; KLIP modal saves only touch effective columns.

ALTER TABLE vessel_loading_ports
  ADD COLUMN IF NOT EXISTS sap_quality_ffa DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS sap_quality_mi DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS sap_quality_dobi DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS sap_quality_red DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS sap_quality_ds DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS sap_quality_stone DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS sap_ata_vessel_arrival DATE,
  ADD COLUMN IF NOT EXISTS sap_ata_vessel_berthed DATE,
  ADD COLUMN IF NOT EXISTS sap_ata_loading_start DATE,
  ADD COLUMN IF NOT EXISTS sap_ata_loading_completed DATE,
  ADD COLUMN IF NOT EXISTS sap_ata_vessel_sailed DATE;

-- One-time backfill: treat current effective values as SAP baseline where snapshot is missing.
UPDATE vessel_loading_ports
SET
  sap_quality_ffa = COALESCE(sap_quality_ffa, quality_ffa),
  sap_quality_mi = COALESCE(sap_quality_mi, quality_mi),
  sap_quality_dobi = COALESCE(sap_quality_dobi, quality_dobi),
  sap_quality_red = COALESCE(sap_quality_red, quality_red),
  sap_quality_ds = COALESCE(sap_quality_ds, quality_ds),
  sap_quality_stone = COALESCE(sap_quality_stone, quality_stone),
  sap_ata_vessel_arrival = COALESCE(sap_ata_vessel_arrival, ata_vessel_arrival::date),
  sap_ata_vessel_berthed = COALESCE(sap_ata_vessel_berthed, ata_vessel_berthed::date),
  sap_ata_loading_start = COALESCE(sap_ata_loading_start, ata_loading_start::date),
  sap_ata_loading_completed = COALESCE(sap_ata_loading_completed, ata_loading_completed::date),
  sap_ata_vessel_sailed = COALESCE(sap_ata_vessel_sailed, ata_vessel_sailed::date)
WHERE
  sap_quality_ffa IS NULL
  OR sap_quality_mi IS NULL
  OR sap_quality_dobi IS NULL
  OR sap_quality_red IS NULL
  OR sap_quality_ds IS NULL
  OR sap_quality_stone IS NULL
  OR sap_ata_vessel_arrival IS NULL
  OR sap_ata_vessel_berthed IS NULL
  OR sap_ata_loading_start IS NULL
  OR sap_ata_loading_completed IS NULL
  OR sap_ata_vessel_sailed IS NULL;
