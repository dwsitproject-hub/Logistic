-- DHM site code returned when Master Site syncs. Port Master site_id uses this code.

ALTER TABLE master_sites
  ADD COLUMN IF NOT EXISTS code_dhm VARCHAR(40),
  ADD COLUMN IF NOT EXISTS dhm_id UUID,
  ADD COLUMN IF NOT EXISTS dhm_version INT,
  ADD COLUMN IF NOT EXISTS dhm_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dhm_is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dhm_payload JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS uq_master_sites_code_dhm
  ON master_sites (code_dhm) WHERE code_dhm IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_master_sites_dhm_id
  ON master_sites (dhm_id) WHERE dhm_id IS NOT NULL;
