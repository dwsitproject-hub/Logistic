-- Re-key jps_shipping_instructions onto the STO key the Shipments page uses.
--
-- THE BUG THIS REPAIRS. KLIP submitted an instruction under
-- COALESCE(shipment_id, operation_id), while the Shipments list groups by shipmentListStoKeyExpr().
-- For a manual shipment the two never agree: `shipment_id` is `MNL-…`, which is not numeric, so the
-- list falls through to the contract's sto_number, then effective_sto, then operation_id. The join
-- found nothing and every instruction JPS had already accepted still read "Not Sent" on the page.
--
-- The code now submits under the list's key, so these stored rows have to move with it - otherwise
-- the sweep would see no instruction for those STOs and submit a SECOND one to JPS for the same
-- vessel call.
--
-- external_reference is deliberately NOT touched. That is JPS's identity for an instruction we
-- have already sent; sto_key is only KLIP's own bookkeeping.
--
-- The expression below must stay identical to shipmentListStoKeyExpr() in
-- backend/src/utils/shipmentStoTypeSql.ts. It is spelled out here because a migration cannot call
-- TypeScript; if that helper changes, this file is history and the code is the source of truth.

DO $$
DECLARE
  moved INT := 0;
  ambiguous INT := 0;
  blocked INT := 0;
  dupes INT := 0;
BEGIN
  CREATE TEMP TABLE jps_key_map ON COMMIT DROP AS
  WITH new_keys AS (
    SELECT j.id AS tracker_id,
           j.revision,
           COALESCE(
             CASE
               WHEN NULLIF(TRIM(s.shipment_id::text), '') ~ '^[0-9]+$'
                 AND (
                   NULLIF(TRIM(c.sto_number::text), '') IS NULL
                   OR NULLIF(TRIM(s.shipment_id::text), '') <> NULLIF(TRIM(c.sto_number::text), '')
                 )
               THEN NULLIF(TRIM(s.shipment_id::text), '')
               ELSE NULL
             END,
             NULLIF(TRIM(c.sto_number::text), ''),
             NULLIF(TRIM(l.effective_sto), ''),
             NULLIF(TRIM(s.operation_id::text), ''),
             NULLIF(TRIM(s.shipment_id::text), ''),
             s.id::text
           ) AS new_key
    FROM jps_shipping_instructions j
    INNER JOIN shipments s
      ON COALESCE(NULLIF(TRIM(s.shipment_id), ''), NULLIF(TRIM(s.operation_id), '')) = j.sto_key
    INNER JOIN contracts c ON c.id = s.contract_id
    LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
  )
  SELECT tracker_id,
         revision,
         MIN(new_key) AS new_key,
         COUNT(DISTINCT new_key) AS distinct_keys
  FROM new_keys
  GROUP BY tracker_id, revision;

  /*
   * Two instructions can map to ONE new key, and that is not a migration accident - it is KLIP
   * having submitted twice for what the Shipments page counts as a single STO. Seen in the data:
   * MNL-31278714-1004031226 and MNL-31278714-1004031592 both resolve to OP-1004031226-31163715.
   *
   * (sto_key, revision) is unique, so only the first can move. The rest keep their old key and are
   * reported, because silently dropping one would hide a duplicate JPS already holds - and the
   * whole point of re-keying is to stop creating more of them.
   */
  CREATE TEMP TABLE jps_key_dupes ON COMMIT DROP AS
  SELECT tracker_id
  FROM (
    -- The one JPS actually accepted keeps the key: SUBMITTED first, then the highest revision.
    -- Ordering by id would decide it by UUID, which is no decision at all.
    SELECT m.tracker_id,
           ROW_NUMBER() OVER (
             PARTITION BY m.new_key, m.revision
             ORDER BY (j.state = 'SUBMITTED') DESC, j.revision DESC, j.submitted_at DESC NULLS LAST, m.tracker_id
           ) AS rn
    FROM jps_key_map m
    JOIN jps_shipping_instructions j ON j.id = m.tracker_id
    WHERE m.distinct_keys = 1 AND m.new_key IS NOT NULL
  ) ranked
  WHERE rn > 1;

  -- An instruction whose shipments disagree about the new key is left alone: guessing one would
  -- attach it to the wrong STO, and a stale "Not Sent" is the safer failure.
  SELECT COUNT(*) INTO ambiguous FROM jps_key_map WHERE distinct_keys > 1;

  -- (sto_key, revision) is unique. If the target is already taken, moving would violate it.
  SELECT COUNT(*) INTO blocked
  FROM jps_key_map m
  JOIN jps_shipping_instructions j ON j.id = m.tracker_id
  WHERE m.distinct_keys = 1
    AND m.new_key <> j.sto_key
    AND EXISTS (
      SELECT 1 FROM jps_shipping_instructions o
      WHERE o.sto_key = m.new_key AND o.revision = m.revision AND o.id <> j.id
    );

  WITH moved_rows AS (
    UPDATE jps_shipping_instructions j
    SET sto_key = m.new_key,
        updated_at = CURRENT_TIMESTAMP
    FROM jps_key_map m
    WHERE m.tracker_id = j.id
      AND m.distinct_keys = 1
      AND m.new_key IS NOT NULL
      AND m.new_key <> j.sto_key
      AND NOT EXISTS (SELECT 1 FROM jps_key_dupes d WHERE d.tracker_id = m.tracker_id)
      AND NOT EXISTS (
        SELECT 1 FROM jps_shipping_instructions o
        WHERE o.sto_key = m.new_key AND o.revision = m.revision AND o.id <> j.id
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO moved FROM moved_rows;

  SELECT COUNT(*) INTO dupes FROM jps_key_dupes;

  RAISE NOTICE 'JPS sto_key re-keyed: % moved, % ambiguous, % blocked, % duplicate instructions for one STO',
    moved, ambiguous, blocked, dupes;
  IF dupes > 0 THEN
    RAISE NOTICE 'Those % are instructions JPS already holds twice for the same vessel call - review them.', dupes;
  END IF;
END $$;
