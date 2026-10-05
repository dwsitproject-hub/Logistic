-- First weighbridge entry and last weighbridge exit of a WB day, shown next to the date in the trucking modal
-- (Section 4 > Daily Actuals (WB)), e.g. "05/09/2026 09.00-17.00".
--
-- The WB rekap files carry these as clock-time columns under different names per site (Jam Masuk / Jam Keluar,
-- Jam Datang Di EUP / Jam Keluar Dari EUP, Jam 1st / Jam 2nd). Until now the import read only the date and the
-- two nettos, so the times were dropped. They are aggregated per PO + date like the quantities: the earliest
-- entry and the latest exit of the day's tickets.
--
-- Additive and nullable: rows written before this migration, rows from the manual daily-actuals template, and WB
-- files without a time column simply have no times and show the date alone. Re-uploading a WB file fills them in.

ALTER TABLE trucking_daily_actuals
  ADD COLUMN IF NOT EXISTS first_time_in TIME,
  ADD COLUMN IF NOT EXISTS last_time_out TIME;
