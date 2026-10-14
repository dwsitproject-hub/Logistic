-- Shipments list: index the three per-row STO-key lookups the list statements spend most of their time in.
--
-- Asked by Ryan on 2026-10-14 (the Shipments page feels slow). Measured on a migrated copy of the dev database (2,639 shipments, 27,003 SAP rows,
-- jit off as the app runs it), each list statement repeats a lookup once per candidate row (998 rows), and each lookup was a sequential scan
-- because its expression is not a column, so no index served it:
--
-- 1-2. "which shipments carry this STO key" (stoLinkedContractSql.ts), two UNION arms that match a key against a shipment's operation id or
--      shipment id. Ten Seq Scans of shipments, ~8.5 s of the Unplanned list statement's 15.6 s:
--        WHERE COALESCE(sh_op.status, '') <> 'CANCELLED' AND NULLIF(TRIM(sh_op.operation_id::text), '') = <key>
--        WHERE COALESCE(sh_id.status, '') <> 'CANCELLED' AND NULLIF(TRIM(sh_id.shipment_id::text), '') = <key>
--      The index WHERE is the queries' own status condition.
--
--   3. the row's Contract Ext No by STO (the newest SAP row of the STO), 9.4 s of the default list statement's 13.2 s:
--        WHERE TRIM(spd.sto_number::text) = <key> ORDER BY spd.created_at DESC NULLS LAST LIMIT 1
--      idx_spd_sto_number_trim is TRIM(COALESCE(sto_number::text, '')): the same rows for a non-empty key, but a different expression, so the
--      planner cannot use it (migration 179's lesson). This one is spelled as the query spells it, with the ORDER BY.
--
-- ACCESS PATH ONLY: which rows match does not change. On the dev copy every statement's result is byte-identical with and without the indexes,
-- and ten API responses (list, Unplanned, page 2, SAP sort, summary, Shipping Performance, four edit payloads) are identical to the code before.
-- Unplanned list statement 15.6 s -> 5.3-6.3 s (3.4 s with the Master Vessel lateral fix of the same commit); default list statement
-- 13.2 s -> 3.5 s. Build time on the dev copy: 81 ms for the SAP index; the shipments ones are smaller. No CONCURRENTLY needed inside the
-- migration runner's transaction.

CREATE INDEX IF NOT EXISTS idx_shipments_operation_id_key_active
  ON shipments ((NULLIF(TRIM(operation_id::text), '')))
  WHERE COALESCE(status, '') <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS idx_shipments_shipment_id_key_active
  ON shipments ((NULLIF(TRIM(shipment_id::text), '')))
  WHERE COALESCE(status, '') <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS idx_spd_sto_number_trimmed_created
  ON sap_processed_data ((TRIM(sto_number::text)), created_at DESC NULLS LAST);
