-- Pre-computed contract qty_move (SAP + WB overlay) for fast OS Quantity reads.

CREATE TABLE IF NOT EXISTS contract_qty_move_snapshot (
  contract_number TEXT PRIMARY KEY,
  quantity_delivery_trucking NUMERIC NOT NULL DEFAULT 0,
  quantity_delivery_vessel NUMERIC NOT NULL DEFAULT 0,
  quantity_receive NUMERIC NOT NULL DEFAULT 0,
  quantity_delivery NUMERIC NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_qty_move_snapshot_refreshed
  ON contract_qty_move_snapshot (refreshed_at DESC);

CREATE TABLE IF NOT EXISTS contract_qty_move_snapshot_meta (
  id TEXT PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_stale BOOLEAN NOT NULL DEFAULT TRUE,
  row_count BIGINT NOT NULL DEFAULT 0,
  duration_ms BIGINT
);

INSERT INTO contract_qty_move_snapshot_meta (id, is_stale)
VALUES ('global', TRUE)
ON CONFLICT (id) DO NOTHING;
