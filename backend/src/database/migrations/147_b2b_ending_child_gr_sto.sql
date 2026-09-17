-- B2B origin overlay: aggregate GR STO from all children (any Open / all Close).
-- Plant/buyer/unload stay latest-child; this column is PO-wide across children.

ALTER TABLE b2b_ending_child_snapshot
  ADD COLUMN IF NOT EXISTS child_gr_sto_status TEXT;

ALTER TABLE b2b_ending_child_snapshot
  ADD COLUMN IF NOT EXISTS child_count INTEGER;

COMMENT ON COLUMN b2b_ending_child_snapshot.child_gr_sto_status IS
  'Aggregate GR STO from all B2B children: Open if any child is Open; Close only if every child is Close.';

COMMENT ON COLUMN b2b_ending_child_snapshot.child_count IS
  'Number of child POs (Contract Reff PO Ini = origin PO) included in child_gr_sto_status.';

UPDATE b2b_ending_child_snapshot_meta
SET is_stale = TRUE
WHERE id = 'global';

UPDATE contract_qty_move_snapshot_meta
SET is_stale = TRUE
WHERE id = 'global';
