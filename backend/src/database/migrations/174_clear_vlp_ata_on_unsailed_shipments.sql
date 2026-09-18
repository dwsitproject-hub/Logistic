-- 174 — clear loading-completion ATAs that sit on shipments which have not sailed.
--
-- Fourth after 169, 170 and 173, and the last of that line. Those three each went and cleared one
-- shape by hand because the import could not correct itself; the same commit that adds this lets
-- SAP correct and retract the values it provably wrote, so this migration cleans up what is
-- already there rather than holding a line.
--
-- MEASURED FIRST, on production 2026-09-18 (docs/scripts/diag-sap-mirror-asymmetry.js):
--
--     vessel_loading_ports, values set          10,684
--       provably SAP   (value = sap mirror)     10,325   96.6%
--       provably KLIP  (klip_edited_fields)          5
--       AMBIGUOUS      (value set, mirror gone)    119    1.1%
--
-- Of the ambiguous ata_loading_completed rows, FOUR sit on shipments whose status is neither
-- SAILED nor COMPLETED nor CANCELLED. That is the whole scope of this migration.
--
-- WHY THESE FOUR AND NOT THE OTHER 115. A vessel that has not sailed cannot have finished
-- loading — the date is impossible rather than merely doubtful. The remaining ambiguous rows are
-- only unexplained, and clearing those would mean treating "we no longer know where this came
-- from" as "it is wrong", which is precisely the inference migration 167 exists to forbid. They
-- are left alone deliberately, and the diagnostic counts them so their number can be watched.
--
-- Condition 5 of migration 173 is the same test, and it was added there after its dry run selected
-- both halves of a pair of identical dates without being able to say which was the copy. A PLANNED
-- shipment settles that; a COMPLETED one does not.
--
-- REVERSIBLE. Every value is copied into vlp_ata_unsailed_backup_174 before being cleared.
--   To undo:  UPDATE vessel_loading_ports v SET ata_loading_completed = b.old_value
--             FROM vlp_ata_unsailed_backup_174 b
--             WHERE b.vlp_id = v.id AND b.field = 'ata_loading_completed';
--
-- Idempotent: once cleared the column IS NULL and the row no longer matches; the backup insert
-- skips rows already recorded.

CREATE TABLE IF NOT EXISTS vlp_ata_unsailed_backup_174 (
  vlp_id          uuid        NOT NULL,
  field           text        NOT NULL,
  old_value       timestamptz,
  own_sto         text,
  vessel_name     text,
  shipment_status text,
  cleared_at      timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (vlp_id, field)
);

WITH candidates AS (
  SELECT v.id AS vlp_id,
         v.ata_loading_completed,
         NULLIF(TRIM(s.shipment_id::text), '') AS own_sto,
         s.vessel_name,
         s.status AS shipment_status
  FROM vessel_loading_ports v
  JOIN shipments s ON s.id = v.shipment_id
  WHERE v.ata_loading_completed IS NOT NULL
    -- the mirror is gone, so nothing can say where this came from
    AND v.sap_ata_loading_completed IS NULL
    -- and the KLIP edit path has not claimed it either
    AND NOT ('ata_loading_completed' = ANY(v.klip_edited_fields))
    -- and the vessel has not sailed, which is what makes the date impossible
    AND UPPER(TRIM(COALESCE(s.status, ''))) NOT IN ('SAILED', 'COMPLETED', 'CANCELLED')
)
INSERT INTO vlp_ata_unsailed_backup_174 (vlp_id, field, old_value, own_sto, vessel_name, shipment_status)
SELECT vlp_id, 'ata_loading_completed', ata_loading_completed, own_sto, vessel_name, shipment_status
FROM candidates
ON CONFLICT (vlp_id, field) DO NOTHING;

UPDATE vessel_loading_ports v
SET ata_loading_completed = NULL
FROM vlp_ata_unsailed_backup_174 b
WHERE b.vlp_id = v.id
  AND b.field = 'ata_loading_completed'
  AND v.ata_loading_completed IS NOT NULL;
