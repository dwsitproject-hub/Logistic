-- Which fields on this row a KLIP user actually wrote.
--
-- The problem this closes. Most fields the UI labels "KLIP" live in the same column the SAP import
-- writes. The import merges fill-gaps-only (klipSapFieldMerge.ts, vesselLoadingPortsFromSap's
-- mergeSapPortValue), so a field nobody opened silently takes SAP's value - and afterwards nothing
-- distinguishes it from something typed by hand. The Edit Shipment modal then showed it with a
-- "KLIP" chip beside it, which is an assertion the data could not support.
--
-- Value equality is not a substitute. "Equals the SAP snapshot" cannot tell a user who typed the
-- same number apart from a value SAP supplied, and for `shipments` there is no snapshot at all.
-- Migration 130 made this permanent for older rows by copying effective ATA and quality INTO the
-- sap_* columns, so those two agree by construction.
--
-- So provenance is recorded at the moment of writing, by the only party who knows it: the save
-- path that handled a user's request. The SAP import never touches this column.
--
-- Deliberately additive and deliberately silent about the past: an empty array means "not known",
-- NOT "came from SAP". Every existing row starts empty because their provenance is genuinely
-- unknown, and claiming otherwise would repeat the mistake this migration exists to end.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS klip_edited_fields TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE vessel_loading_ports
  ADD COLUMN IF NOT EXISTS klip_edited_fields TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE trucking_operations
  ADD COLUMN IF NOT EXISTS klip_edited_fields TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN shipments.klip_edited_fields IS
  'Column names a KLIP user wrote on this row. Empty = unknown provenance, not SAP. Never written by the SAP import.';
COMMENT ON COLUMN vessel_loading_ports.klip_edited_fields IS
  'Column names a KLIP user wrote on this row. Empty = unknown provenance, not SAP. Never written by the SAP import.';
COMMENT ON COLUMN trucking_operations.klip_edited_fields IS
  'Column names a KLIP user wrote on this row. Empty = unknown provenance, not SAP. Never written by the SAP import.';

-- No index: the column is read per row on a detail screen, never filtered across the table. Add
-- one (GIN) only if a query ever needs "every row a user edited".
