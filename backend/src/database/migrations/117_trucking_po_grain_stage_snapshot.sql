-- Trucking list stage snapshot: one row per operation (PO grain), not per STO line.
-- Multi-STO POs collapse to a single list/summary row; sto_line keeps aggregated display text.
TRUNCATE trucking_list_stage_snapshot;

ALTER TABLE trucking_list_stage_snapshot
  DROP CONSTRAINT IF EXISTS trucking_list_stage_snapshot_pkey;

ALTER TABLE trucking_list_stage_snapshot
  ADD PRIMARY KEY (operation_id);

-- Force pipeline refresh so circles + snapshot rebuild at PO grain.
UPDATE pipeline_summary_refresh_meta
SET is_stale = TRUE
WHERE module = 'trucking';
