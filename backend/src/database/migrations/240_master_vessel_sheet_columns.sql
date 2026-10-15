-- Master Vessel: the columns of the final vessel sheet that KLIP did not have yet, and an archive for the vessels the sheet replaces.
--
-- Asked by Ryan on 2026-10-15: KLIP's Master Vessel is to be cleaned up and replaced by the sheet "Vessel - Klip (Final Validation)" of
-- "Master Data - CPO 28 Sep 2026" (columns A-P), the way the Master Port was. Of its columns, Pair ID is vessel_pairs, Nama Vessel is
-- vessel_name, Company Code is sap_vendor_code, Owner / Capacity / Vessel Type / Heating / Type Lambung / Charter Type are vessel_owner /
-- vessel_capacity_mt / vessel_type / heating / lambung_type / terms, Vessel Draft and Vessel LOA are vessel_draft and vessel_length_overall
-- (stored already, not yet on screen), Vessel Code SAP is master_vessel_code_aliases. Transaksi Klip is a count, not an attribute. Two are new:
--
--   vessel_hull_type          N "Vessel Hull Type" (BAJA, DECK BARGE, DOUBLE HULL ...). Not lambung_type (DHDB / SHDB) and not the API's
--                             legacy `hull_type`, which is a synonym of vessel_type - hence the shipments' column name.
--   vessel_registration_year  O "Vessel Registration Year", as SAP and shipments.vessel_registration_year call it. year_of_creation stays.
--
-- master_vessels_archive keeps a vessel the replacement removes (the row, its codes and pairs as JSON), so a removal can be undone by hand.

ALTER TABLE master_vessels ADD COLUMN IF NOT EXISTS vessel_hull_type VARCHAR(100);
ALTER TABLE master_vessels ADD COLUMN IF NOT EXISTS vessel_registration_year INTEGER;

CREATE TABLE IF NOT EXISTS master_vessels_archive (
  id UUID PRIMARY KEY,
  vessel_name VARCHAR(255),
  reason TEXT NOT NULL,
  vessel_row JSONB NOT NULL,
  code_aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  pairs JSONB NOT NULL DEFAULT '[]'::jsonb,
  archived_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
