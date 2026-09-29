-- DHM replica fields for masters other than vessel.
-- Vessel keeps master_vessels.dhm_code. These tables store the hub code in code_dhm.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS dhm_id UUID,
  ADD COLUMN IF NOT EXISTS dhm_version INT,
  ADD COLUMN IF NOT EXISTS dhm_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dhm_is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dhm_payload JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_dhm_id
  ON products (dhm_id) WHERE dhm_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_code_dhm
  ON products (code_dhm) WHERE code_dhm IS NOT NULL;

ALTER TABLE master_loading_ports
  ADD COLUMN IF NOT EXISTS dhm_id UUID,
  ADD COLUMN IF NOT EXISTS dhm_version INT,
  ADD COLUMN IF NOT EXISTS dhm_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dhm_is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dhm_payload JSONB,
  ADD COLUMN IF NOT EXISTS dhm_site_code VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS uq_master_loading_ports_dhm_id
  ON master_loading_ports (dhm_id) WHERE dhm_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_master_loading_ports_code_dhm
  ON master_loading_ports (code_dhm) WHERE code_dhm IS NOT NULL;

ALTER TABLE master_plants
  ADD COLUMN IF NOT EXISTS dhm_id UUID,
  ADD COLUMN IF NOT EXISTS dhm_version INT,
  ADD COLUMN IF NOT EXISTS dhm_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dhm_is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dhm_payload JSONB,
  ADD COLUMN IF NOT EXISTS dhm_org_code VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS uq_master_plants_dhm_id
  ON master_plants (dhm_id) WHERE dhm_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_master_plants_code_dhm
  ON master_plants (code_dhm) WHERE code_dhm IS NOT NULL;

ALTER TABLE master_reference_items
  ADD COLUMN IF NOT EXISTS dhm_id UUID,
  ADD COLUMN IF NOT EXISTS dhm_version INT,
  ADD COLUMN IF NOT EXISTS dhm_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dhm_is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dhm_payload JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS uq_master_reference_items_dhm_id
  ON master_reference_items (dhm_id) WHERE dhm_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_master_reference_items_code_dhm
  ON master_reference_items (kind, code_dhm) WHERE code_dhm IS NOT NULL;

-- Organizations are shared by plants and may arrive before any plant row matches.
CREATE TABLE IF NOT EXISTS dhm_organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dhm_id UUID,
  dhm_code VARCHAR(50),
  name TEXT NOT NULL,
  dhm_version INT,
  dhm_updated_at TIMESTAMPTZ,
  dhm_is_deleted BOOLEAN NOT NULL DEFAULT false,
  dhm_payload JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dhm_organizations_dhm_id
  ON dhm_organizations (dhm_id) WHERE dhm_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_dhm_organizations_dhm_code
  ON dhm_organizations (dhm_code) WHERE dhm_code IS NOT NULL;
