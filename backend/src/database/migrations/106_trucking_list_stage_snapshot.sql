-- Per-expanded-row pipeline stage snapshot for the Trucking list.
--
-- The Summary Trucking Status circles are computed by the daily refresh from the FULL
-- (SAP-joined) STO expansion, but the list's fast shell requests enumerate a different
-- (smaller) row set and derive stages from shell quantities — so circle counts and
-- status-filtered table totals disagreed (e.g. Completed 5,564 vs ~3,3xx). This table
-- stores each expanded row's identity, stage, toolbar dims and default-sort fields
-- from the same refresh run that feeds the circles. Status-filtered list requests page
-- row keys from here (total = circles by construction) and enrich only the visible
-- page via the full expansion. Stale snapshot -> legacy behaviour.
CREATE TABLE IF NOT EXISTS trucking_list_stage_snapshot (
  operation_id UUID NOT NULL,
  sto_line TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL,
  group_plant TEXT NOT NULL DEFAULT 'Blank',
  contract_date DATE NOT NULL DEFAULT DATE '1970-01-01',
  product TEXT NOT NULL DEFAULT 'Blank',
  incoterm TEXT NOT NULL DEFAULT 'Blank',
  supplier TEXT,
  created_at TIMESTAMPTZ,
  PRIMARY KEY (operation_id, sto_line)
);

CREATE INDEX IF NOT EXISTS idx_trucking_list_stage_snapshot_stage_order
  ON trucking_list_stage_snapshot (stage, supplier, created_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_trucking_list_stage_snapshot_dims
  ON trucking_list_stage_snapshot (contract_date, product, incoterm);

-- Populate on next backend start.
UPDATE pipeline_summary_refresh_meta SET is_stale = TRUE WHERE module = 'trucking';
