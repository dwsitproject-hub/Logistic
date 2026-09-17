-- Region/Site alias: SAP's Discharge Destination `KIJING` is the port for the Tanjung Pura
-- plants, and master_plants already groups all eight of them under group_plant = 'Tanjung Pura'.
-- The two dimensions disagreed on the same place. Requested 2026-09-08.
--
-- The code normalises this at read time (utils/dischargeDestinationAlias.ts, applied inside
-- sapDischargeDestinationFromJson and wherever a stored copy is read), so this migration is only
-- about the *stored* copies. They matter because one of them is read straight through:
-- latePerformance's snapshot path selects contract_performance_snapshot.plant_site as-is, so
-- leaving 6,028 rows saying KIJING while the filter dropdown offers TANJUNG PURA would make that
-- filter return nothing at all on Contract Performance.
--
-- Written as a direct UPDATE rather than by marking the snapshot stale: the value set here is
-- exactly what a rebuild would compute, so this avoids sending the page back to the live query
-- (~100s) until someone rebuilds. The alias is idempotent, so a later rebuild agrees with it.
UPDATE contract_performance_snapshot
   SET plant_site = 'TANJUNG PURA'
 WHERE UPPER(TRIM(COALESCE(plant_site, ''))) = 'KIJING';

UPDATE b2b_ending_child_snapshot
   SET discharge_destination = 'TANJUNG PURA'
 WHERE UPPER(TRIM(COALESCE(discharge_destination, ''))) = 'KIJING';

-- trucking_operations.location is Plant/Site persisted by the SAP import from Discharge
-- Destination, so it is in scope for the same rule. The import write path normalises new rows;
-- this aligns the ones already written.
UPDATE trucking_operations
   SET location = 'TANJUNG PURA'
 WHERE UPPER(TRIM(COALESCE(location, ''))) = 'KIJING';

-- Deliberately NOT touched: trucking_operations.unloading_location. That column comes from SAP's
-- truck-unloading field, not from Discharge Destination - a different dimension that happens to
-- carry the same 219 place names. Renaming it here would be scope creep on a value nobody asked
-- about; if Region/Site and truck unloading should agree, that is its own decision.
