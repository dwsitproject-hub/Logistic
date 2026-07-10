-- Pre-computed latest sap_processed_data row per contract for fast Contracts list reads.

CREATE TABLE IF NOT EXISTS contract_latest_spd_snapshot (
  contract_number TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  spd_created_at TIMESTAMPTZ,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_latest_spd_snapshot_refreshed
  ON contract_latest_spd_snapshot (refreshed_at DESC);

CREATE TABLE IF NOT EXISTS contract_latest_spd_snapshot_meta (
  id TEXT PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_stale BOOLEAN NOT NULL DEFAULT TRUE,
  row_count BIGINT NOT NULL DEFAULT 0,
  duration_ms BIGINT
);

INSERT INTO contract_latest_spd_snapshot_meta (id, is_stale)
VALUES ('global', TRUE)
ON CONFLICT (id) DO NOTHING;
