-- 173 — clear discharge/loading ATAs copied from ANOTHER STO, across contracts.
--
-- Third in the line after 169 and 170, and it exists because their rule cannot reach this shape
-- for two independent reasons, both measured in production on 2026-09-16.
--
-- 1. THE MIRROR IS GONE. 169/170 proved a date came from SAP by testing `value = sap_* mirror`.
--    That proof does not survive an import. The two columns are maintained by opposite rules in
--    vesselLoadingPortsFromSap.service.ts:
--        value   mergeSapPortValue   fill-gaps-only - `if (hasCurrent) return current`
--        mirror  mergeSapSnapshot    no incoming value -> stores NULL
--    so one import in which SAP sends nothing for that STO nulls the mirror while the stale value
--    survives. The row then looks exactly like something a user typed, and is protected forever.
--    STO 1006019867 proves this happens after a repair: 170 cleared it, and its mirror is NULL
--    again today with the value back.
--
-- 2. THE SIBLING IS UNDER A DIFFERENT CONTRACT. 169/170 look for the copy's twin under the SAME
--    contract (`sib.contract_id = s.contract_id`). Here the copy landed on the shipment rows of
--    OTHER contracts on the same STO:
--
--        STO 1006019958 (Luminor 6)   contracts 1004029166, 1004030762, 1004030966,
--                                               1004031121, 1004031937   <- all carry 2026-07-22
--                                               1004030633               <- its own row is CLEAN
--        STO 1006019438 (SMS 3000)    same dates, and the only contract spanning both STOs is
--                                     1004030633, whose row on 1006019958 has no ATA at all
--
--    The one contract that would satisfy the same-contract test is the one that was never
--    contaminated, so that test can never fire for this shape.
--
-- Effect on the pages: contract 1004030633's own row is clean, yet its 97 MT vanishes from the
-- Shipments OS, because the execution arm works at STO-group grain and the group's completion
-- comes from those five contaminated sibling rows. 1004031937 (1 MT) is one of the five.
--
-- WHAT THIS DELETES, AND WHY IT IS REVERSIBLE. The evidence that these dates are copies is
-- circumstantial - two vessels cannot finish at the same moment - not conclusive, and this was
-- applied with that stated. Every value is therefore copied into vlp_ata_bleed_backup_173 before
-- being cleared, with enough to put it back:
--     INSERT is above the UPDATEs and keyed by vessel_loading_ports.id + field.
--     To undo:  UPDATE vessel_loading_ports v SET ata_loading_completed = b.old_value
--               FROM vlp_ata_bleed_backup_173 b
--               WHERE b.vlp_id = v.id AND b.field = 'ata_loading_completed';
--
-- SCOPE, deliberately narrow:
--   - only `ata_loading_completed`, the field that decides completion and therefore the OS. The
--     other ATAs on the same rows are copies too, but each needs its own SAP-key test and none of
--     them moves a number - left alone rather than deleted on the same circumstantial evidence.
--   - only rows whose mirror is already NULL. Rows with the mirror intact are 169/170's business.
--
-- Conditions, all four required:
--   1. the value is set and the mirror is NULL
--   2. the shipment's OWN STO has no such value in SAP
--   3. a shipment on a DIFFERENT STO holds the identical date on a DIFFERENT vessel
--   4. the two STOs are linked - some contract has a shipment row on both - so an unrelated STO
--      that happens to share a date is not touched
--
-- Idempotent: once cleared the column IS NULL and the row no longer matches. The backup insert
-- skips rows already recorded.

CREATE TABLE IF NOT EXISTS vlp_ata_bleed_backup_173 (
  vlp_id      uuid        NOT NULL,
  field       text        NOT NULL,
  old_value   timestamptz,
  old_mirror  timestamptz,
  own_sto     text,
  vessel_name text,
  cleared_at  timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (vlp_id, field)
);

WITH candidates AS (
  SELECT v.id AS vlp_id,
         v.ata_loading_completed,
         v.sap_ata_loading_completed,
         NULLIF(TRIM(s.shipment_id::text), '') AS own_sto,
         s.vessel_name
  FROM vessel_loading_ports v
  JOIN shipments s ON s.id = v.shipment_id
  WHERE v.ata_loading_completed IS NOT NULL
    AND v.sap_ata_loading_completed IS NULL
    AND NULLIF(TRIM(s.shipment_id::text), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM sap_processed_data spd
      WHERE TRIM(COALESCE(spd.sto_number::text, '')) IN (
              NULLIF(TRIM(s.shipment_id::text), ''),
              COALESCE(NULLIF(TRIM(s.operation_id::text), ''), '~'))
        AND NULLIF(TRIM(spd.data->'shipment'->>'ata_vessel_complete_discharge'), '') IS NOT NULL
    )
    AND EXISTS (
      SELECT 1
      FROM shipments other
      JOIN vessel_loading_ports vo ON vo.shipment_id = other.id
      WHERE NULLIF(TRIM(other.shipment_id::text), '') IS DISTINCT FROM NULLIF(TRIM(s.shipment_id::text), '')
        AND COALESCE(vo.is_discharge_port, false) = COALESCE(v.is_discharge_port, false)
        AND vo.ata_loading_completed::date = v.ata_loading_completed::date
        AND NULLIF(TRIM(other.vessel_name), '') IS DISTINCT FROM NULLIF(TRIM(s.vessel_name), '')
        AND EXISTS (
          SELECT 1
          FROM shipments link_a
          JOIN shipments link_b ON link_b.contract_id = link_a.contract_id
          WHERE TRIM(link_a.shipment_id::text) = TRIM(s.shipment_id::text)
            AND TRIM(link_b.shipment_id::text) = TRIM(other.shipment_id::text)
        )
    )
)
INSERT INTO vlp_ata_bleed_backup_173 (vlp_id, field, old_value, old_mirror, own_sto, vessel_name)
SELECT vlp_id, 'ata_loading_completed', ata_loading_completed, sap_ata_loading_completed,
       own_sto, vessel_name
FROM candidates
ON CONFLICT (vlp_id, field) DO NOTHING;

UPDATE vessel_loading_ports v
SET ata_loading_completed = NULL
FROM vlp_ata_bleed_backup_173 b
WHERE b.vlp_id = v.id
  AND b.field = 'ata_loading_completed'
  AND v.ata_loading_completed IS NOT NULL;
