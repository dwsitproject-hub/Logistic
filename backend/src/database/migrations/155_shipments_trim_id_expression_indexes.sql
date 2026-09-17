-- The sibling-STO check in the shipment/trucking contract-backlog predicate joins shipments on
-- TRIM(shipment_id::text) and TRIM(operation_id::text) (seaStoSiblingSql, branch 3). Plain btree
-- indexes on those columns cannot serve the TRIM expression, so every contract in scope drove a
-- sequential scan of shipments. EXPLAIN (ANALYZE) on the Unplanned backlog count showed
-- `Seq Scan on shipments s_link_2 rows=2255 loops=7898` costing 41.8s of a 94.1s execution -
-- shipments is only ~2,600 rows, so ~5ms per scan, 7,898 times.
--
-- Access-path only: an index changes how rows are found, never which rows come back. Measured on
-- the dev DB with the same query and scope, 94,538ms -> 4,246ms (22x), with the seq-scan node
-- gone from the plan entirely and the remaining cost shifted to latest_spd (~1.9s).
--
-- Deliberately NOT CONCURRENTLY: applySqlFile wraps every migration in BEGIN/COMMIT, and
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block - it would fail the migration
-- and, with it, backend startup. shipments is ~2,600 rows, so the plain build is brief. On the
-- dev database these were created concurrently by hand, which IF NOT EXISTS makes harmless here.
CREATE INDEX IF NOT EXISTS idx_shipments_trim_shipment_id
  ON shipments (TRIM(shipment_id::text));

CREATE INDEX IF NOT EXISTS idx_shipments_trim_operation_id
  ON shipments (TRIM(operation_id::text));
