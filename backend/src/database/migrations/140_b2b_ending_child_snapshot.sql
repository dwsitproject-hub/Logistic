-- Pre-computed B2B origin → latest child plant/buyer/unload for list overlays.
-- List queries LEFT JOIN this table (PK lookup) instead of scanning sap_processed_data JSON.

CREATE TABLE IF NOT EXISTS b2b_ending_child_snapshot (
  origin_po TEXT PRIMARY KEY,
  plant_code TEXT,
  company_name TEXT,
  buyer TEXT,
  unload_location TEXT,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS b2b_ending_child_snapshot_meta (
  id TEXT PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_stale BOOLEAN NOT NULL DEFAULT TRUE,
  row_count BIGINT NOT NULL DEFAULT 0,
  duration_ms BIGINT
);

INSERT INTO b2b_ending_child_snapshot_meta (id, is_stale)
VALUES ('global', TRUE)
ON CONFLICT (id) DO NOTHING;
