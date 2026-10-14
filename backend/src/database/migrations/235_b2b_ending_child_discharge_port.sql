-- B2B origin (parent) discharge port overlay: the ending child's SAP Vessel Discharge Port.
--
-- A B2B parent is the company in the middle; the cargo is discharged where the ENDING child says (migration 152 does the same for the Region/Site, 140 for the plant,
-- buyer and unload location). On the dev copy, where both have a port the parent's is a Master Port in 3 of 77 pairs (the rest are plant names such as
-- TSB TRADING PLANT 1) and the child's in 99 of 159. Until now every page read the parent's port.
--
-- Same rules as the other overlay columns: the latest child of the origin PO, rebuilt on SAP import / startup; readers ignore the snapshot while is_stale is true.
-- The column holds the port only when it is a human name (no blank, no numeric SAP code); when the latest child has none, the newest child that has one supplies it.
--
-- Additive. The snapshot is marked stale so the next refresh fills the new column; until then readers fall back to the contract's own port, as before.

ALTER TABLE b2b_ending_child_snapshot
  ADD COLUMN IF NOT EXISTS discharge_port TEXT;

COMMENT ON COLUMN b2b_ending_child_snapshot.discharge_port IS
  'Latest B2B child SAP Vessel Discharge Port with a human name (discharge port overlay for origin POs).';

UPDATE b2b_ending_child_snapshot_meta
SET is_stale = TRUE
WHERE id = 'global';
