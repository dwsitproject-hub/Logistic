-- B2B origin Region/Site overlay: child's SAP Discharge Destination.
-- Without this, origin POs with empty dest stay Blank even when the ending child has a destinasi.

ALTER TABLE b2b_ending_child_snapshot
  ADD COLUMN IF NOT EXISTS discharge_destination TEXT;

COMMENT ON COLUMN b2b_ending_child_snapshot.discharge_destination IS
  'Latest B2B child SAP Discharge Destination (Region/Site overlay for origin POs).';

UPDATE b2b_ending_child_snapshot_meta
SET is_stale = TRUE
WHERE id = 'global';
