-- Trucking list: expression indexes for the per-row correlated subqueries.
--
-- The trucking list SELECT resolves related contracts / operations with correlated
-- subqueries filtering on trimmed keys:
--   NULLIF(TRIM(t2.operation_id::text), '') = NULLIF(TRIM(t.operation_id::text), '')
--   NULLIF(TRIM(cc.sto_number::text), '')   = NULLIF(TRIM(c.sto_number::text), '')
-- Plain btree indexes cannot serve TRIM() predicates, so Postgres ran a sequential
-- scan of trucking_operations (5.2k rows) and contracts (5.9k rows) for EVERY output
-- row (~3.4k and ~1.4k loops respectively) — roughly half of the ~25s cold load of
-- GET /api/trucking. These expression indexes turn those scans into index lookups.
--
-- Verified: /api/trucking and /api/shipments responses are byte-identical with and
-- without these indexes (they only serve inner-subquery lookups, deterministic
-- aggregates like STRING_AGG(DISTINCT .. ORDER BY ..)); cold time ~25.7s -> ~10s.
CREATE INDEX IF NOT EXISTS idx_trucking_ops_operation_id_trim
  ON trucking_operations (NULLIF(btrim(operation_id::text), ''));

CREATE INDEX IF NOT EXISTS idx_contracts_sto_number_trim
  ON contracts (NULLIF(btrim(sto_number::text), ''));
