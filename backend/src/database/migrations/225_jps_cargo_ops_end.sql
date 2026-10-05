-- JPS API 5.5: schedule.cargo_ops_end_at, the end of the Cargo Operations window (KLIP Hose Off).
--
-- 5.5 settles the two KLIP discharge milestones that come from cargo operations:
--   cargo_ops_start_at  Hose On   (operation window START)  -> ATS Discharge
--   cargo_ops_end_at    Hose Off  (operation window END)    -> ATC Discharge
-- `cargo_ops_start_at` changed meaning between 5.4 (Cargo Operations Entry 1 start) and 5.5 (the window start); the column
-- keeps its name. `tc` (operations signed off) no longer feeds ATC, and cast_off_at / sailed_at are the vessel's departure,
-- not Hose Off. All of them are still stored.
--
-- jps_ata_discharge_complete (migration 224) now holds the Hose Off date instead of the sign-off date; it was never
-- filled on a database that had no JPS milestones yet.

ALTER TABLE jps_shipping_instructions
  ADD COLUMN IF NOT EXISTS schedule_cargo_ops_end_at TIMESTAMPTZ;
