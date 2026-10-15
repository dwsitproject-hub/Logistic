-- Master Vessel: Vessel Draft and Vessel LOA, the vessel sheet's columns L and M.
--
-- Migration 240 took these two as already stored, because the dev database has them - but no migration ever created them on
-- master_vessels (005 added vessel_draft / vessel_loa to shipments only), so SIT does not: after commit a68daafe the Master Vessel list
-- (which selects them) and the sheet replacement failed there with `column "vessel_draft" does not exist` (2026-10-15). Created here with
-- the types the dev database has, IF NOT EXISTS so a database that has them is left as it is.

ALTER TABLE master_vessels ADD COLUMN IF NOT EXISTS vessel_draft NUMERIC;
ALTER TABLE master_vessels ADD COLUMN IF NOT EXISTS vessel_length_overall VARCHAR(40);
