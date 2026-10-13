-- master_vessels.klip_origin: the vessel was added in KLIP itself, not brought in by the SAP import, the Jovin sheet or the vessel loader.
--
-- Why a column and not a rule computed on the fly: a vessel typed into KLIP often does not exist in SAP yet, so nothing else about it says where it came
-- from. Creation of a master vessel is not written to audit_logs, and master_vessels has no created_by. When the master is cleaned up and aligned with
-- DHM, the vessels that are only known to KLIP are exactly the ones a cleanup built from SAP + Jovin would drop. services/masterVesselProtection.service.ts
-- reads this flag, together with "used by a shipment" and "linked to DHM", before anything is deleted.
--
-- Set at creation by POST /master-vessels (createMasterVessel) from now on - only when that call CREATES the row, not when it reuses an existing vessel.
ALTER TABLE master_vessels
  ADD COLUMN IF NOT EXISTS klip_origin BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN master_vessels.klip_origin IS
  'TRUE when the vessel was created through KLIP (Add Vessel). Protected from deletion in the master cleanup. Never set by the SAP import, Jovin import or vessel loader.';

-- Backfill for what existed before the column: the 17 vessels found on production on 2026-10-12, created outside the bulk loads (2026-04-21, 2026-08-07,
-- 2026-08-13) and present in no SAP data, no Jovin / KLIP master sheet and no cleaned list. Matched by code AND creation date so a vessel that merely shares
-- a code elsewhere (SIT, a restore) is left alone. 13 of the 17 are not yet used by any shipment; 10 of those carry TMP- codes created within 14 minutes on
-- 2026-10-09 - whether they were added by hand or by an SAP import is not provable from the data, and protecting them costs nothing.
-- Idempotent: rows already flagged are not touched.
UPDATE master_vessels
   SET klip_origin = TRUE
 WHERE klip_origin = FALSE
   AND created_at >= TIMESTAMP '2026-09-14'
   AND vessel_code IN (
     'KKAP', 'KEIHO', 'KALKE', 'KDAH', 'CAHREZIII',
     'TMP-METRO0535', 'TMP-HIKMAHINDAH', 'TMP-AGENA', 'TMP-ALORINDA2706', 'TMP-LSC',
     'TMP-MARINEPOWER3089', 'TMP-NAUTILUS301', 'TMP-PKPJ47', 'TMP-SAMUDRA6',
     'TMP-KMCAMRY', 'TMP-KMPELANGI09', 'TMP-KMPETATUNGKE'
   );
