-- Pre-computed contract STO aggregation (STO numbers, qty, count) for fast Contracts list reads.

CREATE TABLE IF NOT EXISTS contract_sto_agg_snapshot (
  contract_number TEXT PRIMARY KEY,
  sto_numbers TEXT,
  total_sto_quantity NUMERIC NOT NULL DEFAULT 0,
  sto_count INTEGER NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_sto_agg_snapshot_refreshed
  ON contract_sto_agg_snapshot (refreshed_at DESC);

CREATE TABLE IF NOT EXISTS contract_sto_agg_snapshot_meta (
  id TEXT PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_stale BOOLEAN NOT NULL DEFAULT TRUE,
  row_count BIGINT NOT NULL DEFAULT 0,
  duration_ms BIGINT
);

INSERT INTO contract_sto_agg_snapshot_meta (id, is_stale)
VALUES ('global', TRUE)
ON CONFLICT (id) DO NOTHING;
