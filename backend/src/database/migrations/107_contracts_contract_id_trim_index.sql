-- Shipments list / shipping performance: expression index for the per-row correlated
-- subqueries that resolve a contract by its trimmed contract_id.
--
-- The generated SQL joins / sub-selects contracts on a TRIM()'d key, e.g.:
--   (SELECT cc.quantity_ordered::numeric FROM contracts cc
--      WHERE TRIM(cc.contract_id) = TRIM(spd.contract_number) LIMIT 1)
--   ... INNER JOIN contracts cc ON TRIM(cc.contract_id) = TRIM(spd.contract_number)
-- The plain unique index on contracts.contract_id cannot serve a TRIM() predicate, so
-- Postgres sequentially scanned contracts (~5.9k rows) once PER sap_processed_data row
-- (~3.9k loops) inside the latest_spd_contract CTE — measured ~11s (four such subplans)
-- of the shipments full-hydrate query, and the dominant cost of its cold load (>100s).
--
-- Result-preserving: contracts.contract_id is UNIQUE (5892 rows, 5892 distinct, and
-- 5892 distinct after TRIM — no whitespace-only duplicates), so each LIMIT 1 subquery
-- resolves to exactly one deterministic row. An index scan returns the identical row a
-- seq scan does; only the access path changes, never the result. (Same guarantee and
-- pattern as migration 101_trucking_list_expression_indexes.)
CREATE INDEX IF NOT EXISTS idx_contracts_contract_id_trim
  ON contracts (btrim(contract_id::text));

-- Refresh planner stats so the new expression index is chosen immediately on deploy
-- (otherwise the first queries after migration may still pick the old seq-scan plan).
ANALYZE contracts;
