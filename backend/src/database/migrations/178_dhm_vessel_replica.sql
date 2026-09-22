-- DHM local replica fields for Master Vessel + sync/webhook bookkeeping.
-- Does not change shipment display SQL (masterVesselDisplaySql).

ALTER TABLE master_vessels
  ADD COLUMN IF NOT EXISTS dhm_id UUID,
  ADD COLUMN IF NOT EXISTS dhm_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS dhm_version INT,
  ADD COLUMN IF NOT EXISTS dhm_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dhm_is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dhm_payload JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS uq_master_vessels_dhm_id
  ON master_vessels (dhm_id)
  WHERE dhm_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_master_vessels_dhm_code
  ON master_vessels (dhm_code)
  WHERE dhm_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS dhm_sync_state (
  entity VARCHAR(64) PRIMARY KEY,
  cursor TEXT,
  last_updated_at TIMESTAMPTZ,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dhm_webhook_deliveries (
  delivery_id UUID PRIMARY KEY,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
