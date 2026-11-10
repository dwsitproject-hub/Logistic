-- SAP "Phase 3" template (2026-11): SFAL / SFBD figures and the material of a contract.
--
-- 1. sap_sfal_qty / sap_sfbd_qty on shipments: SAP's own figure for this PO x STO row, written by every import (> 0 only), like sap_ata_* and sap_quality_*.
--    The working figure, sfal_qty / sfbd_qty, is filled from it only where no user wrote one (SapDataDistributionService.fillSapFigures), and
--    only on an STO with a single shipment row: SAP sends SFAL per PO line, and on a multi-PO STO it is sometimes each PO's own share and sometimes the whole
--    voyage figure repeated on every PO (28 of the 56 STOs with an SFAL in the test pull have several POs), so a sum would double count and "last row wins"
--    would be wrong. Those stay as a reference next to the user's figure.
--
-- 2. contracts.material_code / material_description: the material of the PO line, the key other applications (DHM) use. contracts.product stays the commercial
--    name SAP sends and the ~47 places that group by it do not change. SAP is the only writer, so a later import simply replaces an earlier value.
--
-- 3. Backfill of klip_edited_fields for the figures that already exist. Migration 167 refused to infer provenance, and that rule still holds for every other
--    column. For these two the past is known: SAP never sent SFAL / SFBD (0 of 27,003 sap_processed_data rows; on production 2026-11-06, 97 SFAL and 59 SFBD on
--    2,692 shipments and no SAP row mentioning SFAL), so each existing figure was typed by a user. Without the marker the first template import would treat them
--    as SAP's to replace. Additive (a union into the array) and idempotent.

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS sap_sfal_qty NUMERIC;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS sap_sfbd_qty NUMERIC;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS material_code VARCHAR(40);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS material_description VARCHAR(255);

-- Plain (not an expression): the lookups that follow match material_code as stored.
CREATE INDEX IF NOT EXISTS idx_contracts_material_code
  ON contracts (material_code)
  WHERE material_code IS NOT NULL;

UPDATE shipments
   SET klip_edited_fields = (
         SELECT COALESCE(ARRAY(SELECT DISTINCT unnest(COALESCE(klip_edited_fields, '{}') || ARRAY['sfal_qty']::text[]) ORDER BY 1), '{}')
       )
 WHERE sfal_qty IS NOT NULL
   AND NOT ('sfal_qty' = ANY(COALESCE(klip_edited_fields, '{}')));

UPDATE shipments
   SET klip_edited_fields = (
         SELECT COALESCE(ARRAY(SELECT DISTINCT unnest(COALESCE(klip_edited_fields, '{}') || ARRAY['sfbd_qty']::text[]) ORDER BY 1), '{}')
       )
 WHERE sfbd_qty IS NOT NULL
   AND NOT ('sfbd_qty' = ANY(COALESCE(klip_edited_fields, '{}')));
