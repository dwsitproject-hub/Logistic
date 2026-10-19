-- Vessels KLIP registers itself from a SAP vessel name (services/registerVesselFromSap.service.ts).
--
-- A SAP import that brings a vessel KLIP does not know used to create a master from the raw SAP text: a tug + barge name became ONE vessel,
-- with no clean name, no pair and no review. It now splits the name into its tug (TB.) and barge (BG.), cleans the names like the Master Vessel
-- sheet, creates the pair, and marks what it is not sure of for a person (the "Perlu review" tab of Master Vessel).
--
-- registered_from   'sap_auto' for a vessel created this way; NULL for every other vessel. The DHM cron pushes the 'sap_auto' ones that DHM has
--                   not linked yet (dhm/pushSapVessels.ts) - DHM refuses a second vessel with the same name, and KLIP then links the record DHM holds.
-- review_status     NULL = nothing to look at; PENDING = a person should check it; APPROVED = checked.
-- review_reason     why, as the flags of sapVesselNameParse joined by commas (truncated, no_prefix, tug_inferred, code_held_by_other ...).
-- review_sap_name   the SAP text the vessel was created from.
--
-- Additive and idempotent. Existing vessels keep every new column NULL.

ALTER TABLE master_vessels ADD COLUMN IF NOT EXISTS registered_from VARCHAR(20);
ALTER TABLE master_vessels ADD COLUMN IF NOT EXISTS review_status VARCHAR(10);
ALTER TABLE master_vessels ADD COLUMN IF NOT EXISTS review_reason TEXT;
ALTER TABLE master_vessels ADD COLUMN IF NOT EXISTS review_sap_name TEXT;

ALTER TABLE master_vessels DROP CONSTRAINT IF EXISTS chk_master_vessels_review_status;
ALTER TABLE master_vessels
  ADD CONSTRAINT chk_master_vessels_review_status CHECK (review_status IS NULL OR review_status IN ('PENDING', 'APPROVED'));

CREATE INDEX IF NOT EXISTS idx_master_vessels_review_pending
  ON master_vessels (updated_at DESC)
  WHERE review_status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_master_vessels_sap_auto_unlinked
  ON master_vessels (created_at)
  WHERE registered_from = 'sap_auto' AND dhm_id IS NULL;
