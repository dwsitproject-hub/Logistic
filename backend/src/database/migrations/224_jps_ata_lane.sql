-- JPS as a third lane of discharge ATA, next to SAP and KLIP.
--
-- KLIP already reads an ATA as COALESCE(shipment_ata_overrides.<col>, shipments.<col>, port row): the KLIP edit first,
-- then the stored value that SAP filled. JPS reports the same moments from its berthing log (v5.4 schedule), and for a
-- shipment that is not COMPLETED yet it is read FIRST: JPS, else KLIP, else SAP.
--
--   KLIP ATA at DP       <- schedule.ta
--   KLIP ATB             <- schedule.tb
--   KLIP ATS Discharge   <- schedule.cargo_ops_start_at   (new in v5.4: Cargo Operations, Entry 1 start)
--   KLIP ATC Discharge   <- schedule.tc                   (operations signed off)
--
-- The values live on the existing override row so every query that already joins it reads the JPS lane without a new
-- join. They are DATEs in Asia/Jakarta (the other ATA columns are dates and JPS sends UTC); JPS's own timestamps stay in
-- jps_shipping_instructions.schedule_*. A row that holds only JPS values is not a KLIP edit: every reader takes its
-- columns one by one, none treats the row's existence as "a user edited this".

ALTER TABLE shipment_ata_overrides
  ADD COLUMN IF NOT EXISTS jps_ata_discharge_arrival DATE,
  ADD COLUMN IF NOT EXISTS jps_ata_discharge_berthed DATE,
  ADD COLUMN IF NOT EXISTS jps_ata_discharge_start DATE,
  ADD COLUMN IF NOT EXISTS jps_ata_discharge_complete DATE,
  ADD COLUMN IF NOT EXISTS jps_synced_at TIMESTAMPTZ;

-- v5.4: JPS's own record of the cargo-operations start (partner ATS), next to schedule_ta / schedule_tb / schedule_sailed_at.
ALTER TABLE jps_shipping_instructions
  ADD COLUMN IF NOT EXISTS schedule_cargo_ops_start_at TIMESTAMPTZ;
