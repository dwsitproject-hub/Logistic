-- Operation ID for the SEA shipments the SAP import created without one, and the marker that says who gave it.
--
-- Operation ID is KLIP's own identifier of a shipment / trucking transaction (STO is SAP's): trucking_operations always get an OP-LAND-... id when they are created, from a SAP row
-- or not, but the SEA shipments the SAP import creates were left with operation_id NULL (the import's INSERT never wrote it). A row that has an STO is Planned from the moment it
-- exists, so it should carry its KLIP id from then on.
--
-- operation_id_source = 'SAP_IMPORT' marks an id that KLIP gave a SAP-imported row by itself. It exists because a non-empty operation_id also means "a user planned this row" to
-- hasKlipShipmentActivity(), which switches the SAP re-import's field protection on (vessel, ports, delivered / receive qty): without the marker, every shell given an id here would
-- stop being refreshed from SAP. NULL = the id came from a user (createShipment, PO assignment) or from before this migration, and keeps meaning "KLIP touched it".
--
-- ONE id per STO: an STO can span several contracts and so several shipment rows (shipment_id is the STO), and the rows of one operation share an id. Shipping Performance and the
-- missing-ETA alerts take operation_id before shipment_id for a row with KLIP planning, so ids that differed inside one STO would split it into several groups.
--
--   adopted   a row whose STO already has a sibling carrying an id takes that id - an OP-... one that no OTHER STO carries (an id shared by several STOs is a multi-STO operation:
--             borrowing it would pull this row into that operation, e.g. into a cancelled one), or the plain number that equals the STO itself.
--   allocated otherwise the STO gets a new OP-SEA-DDMMYYYYnnnn, dated by the day its first row was created, with the daily sequence continuing after the ids that day already has
--             (utils/operationId.ts format: four digits at least).
--
-- Only rows whose shipment_id is a SAP STO (digits) are filled: KLIP manual rows (MNL-/MSEA-) get theirs when they are created and are not SAP-imported.
-- Values that are already there are never touched. updated_at is kept: the trigger is switched off for the update, because the list picks the value of a multi-contract STO from the
-- most recently updated row and an identifier backfill is not an edit.
--
-- Additive and idempotent: a second run finds no empty operation_id and does nothing. Every change is written to cleanup_audit_236.

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS operation_id_source VARCHAR(20);

COMMENT ON COLUMN shipments.operation_id_source IS
  'SAP_IMPORT = operation_id was assigned by KLIP to a SAP-imported row (not a user plan; ignored by hasKlipShipmentActivity). NULL = given by a user or older.';

CREATE TABLE IF NOT EXISTS cleanup_audit_236 (
  id SERIAL PRIMARY KEY,
  shipment_uuid UUID NOT NULL,
  shipment_business_id TEXT,
  contract_number TEXT,
  old_operation_id TEXT,
  new_operation_id TEXT NOT NULL,
  action TEXT NOT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT cleanup_audit_236_shipment_uuid_action_key UNIQUE (shipment_uuid, action)
);

DO $$
DECLARE
  trigger_was_on BOOLEAN := FALSE;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_shipments_updated_at' AND tgrelid = 'shipments'::regclass AND tgenabled <> 'D'
  ) THEN
    ALTER TABLE shipments DISABLE TRIGGER update_shipments_updated_at;
    trigger_was_on := TRUE;
  END IF;

  CREATE TEMP TABLE _op_assign ON COMMIT DROP AS
  WITH todo AS (
    SELECT s.id, s.shipment_id, s.created_at
    FROM shipments s
    WHERE NULLIF(BTRIM(s.operation_id), '') IS NULL
      AND BTRIM(s.shipment_id) ~ '^[0-9]+$'
  ),
  adopted AS (
    SELECT DISTINCT ON (g.shipment_id) g.shipment_id, sib.operation_id AS op
    FROM (SELECT DISTINCT shipment_id FROM todo) g
    JOIN shipments sib
      ON sib.shipment_id = g.shipment_id
     AND NULLIF(BTRIM(sib.operation_id), '') IS NOT NULL
     AND (
       sib.operation_id = sib.shipment_id
       OR (
         sib.operation_id ~ '^OP-'
         AND NOT EXISTS (
           SELECT 1 FROM shipments other
           WHERE other.operation_id = sib.operation_id AND other.shipment_id IS DISTINCT FROM sib.shipment_id
         )
       )
     )
    ORDER BY g.shipment_id, (sib.operation_id ~ '^OP-') DESC, sib.operation_id
  ),
  new_groups AS (
    SELECT t.shipment_id, MIN(t.created_at) AS first_created
    FROM todo t
    WHERE NOT EXISTS (SELECT 1 FROM adopted a WHERE a.shipment_id = t.shipment_id)
    GROUP BY t.shipment_id
  ),
  numbered AS (
    SELECT g.shipment_id,
           TO_CHAR(g.first_created, 'DDMMYYYY') AS dmy,
           ROW_NUMBER() OVER (PARTITION BY TO_CHAR(g.first_created, 'DDMMYYYY') ORDER BY g.first_created, g.shipment_id) AS rn
    FROM new_groups g
  ),
  day_base AS (
    SELECT SUBSTRING(operation_id FROM '^OP-SEA-([0-9]{8})[0-9]+$') AS dmy,
           MAX(SUBSTRING(operation_id FROM '^OP-SEA-[0-9]{8}([0-9]+)$')::bigint) AS max_seq
    FROM shipments
    WHERE operation_id ~ '^OP-SEA-[0-9]{8}[0-9]+$'
    GROUP BY 1
  )
  SELECT t.id,
         t.shipment_id,
         COALESCE(
           a.op,
           'OP-SEA-' || n.dmy ||
             CASE WHEN COALESCE(b.max_seq, 0) + n.rn < 10000
                  THEN LPAD((COALESCE(b.max_seq, 0) + n.rn)::text, 4, '0')
                  ELSE (COALESCE(b.max_seq, 0) + n.rn)::text END
         ) AS new_op,
         CASE WHEN a.op IS NOT NULL THEN 'adopted' ELSE 'allocated' END AS action
  FROM todo t
  LEFT JOIN adopted a ON a.shipment_id = t.shipment_id
  LEFT JOIN numbered n ON n.shipment_id = t.shipment_id
  LEFT JOIN day_base b ON b.dmy = n.dmy;

  INSERT INTO cleanup_audit_236 (shipment_uuid, shipment_business_id, contract_number, old_operation_id, new_operation_id, action)
  SELECT x.id, x.shipment_id, c.contract_id, s.operation_id, x.new_op, x.action
  FROM _op_assign x
  JOIN shipments s ON s.id = x.id
  LEFT JOIN contracts c ON c.id = s.contract_id
  WHERE x.new_op IS NOT NULL
  ON CONFLICT (shipment_uuid, action) DO NOTHING;

  UPDATE shipments s
  SET operation_id = x.new_op,
      operation_id_source = 'SAP_IMPORT'
  FROM _op_assign x
  WHERE s.id = x.id
    AND x.new_op IS NOT NULL
    AND NULLIF(BTRIM(s.operation_id), '') IS NULL;

  IF trigger_was_on THEN
    ALTER TABLE shipments ENABLE TRIGGER update_shipments_updated_at;
  END IF;
END $$;
