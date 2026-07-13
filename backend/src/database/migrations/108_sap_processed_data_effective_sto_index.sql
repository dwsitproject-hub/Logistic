-- Shipments list / shipping performance: expression index for the per-row SAP metric
-- subqueries that match sap_processed_data by "effective STO" (the SPD_EFFECTIVE_STO
-- expression: contracts.sto_number falling back through several JSONB paths).
--
-- The shipments full-hydrate SELECT contains ~5 correlated aggregate subqueries that
-- sum SAP trucking/vessel quantities per output row, each filtering:
--   NULLIF(TRIM(COALESCE(spd.sto_number::text,
--     spd.data->'raw'->>'STO No.', spd.data->'raw'->>'STO Number',
--     spd.data->'shipment'->>'sto_no', spd.data->'contract'->>'sto_no')), '')
--     = NULLIF(TRIM(g.sto_key), '')
-- No index matched that JSONB/COALESCE expression, so each subquery sequentially
-- scanned sap_processed_data (~8.7k rows) once per page row (20 loops) — measured
-- ~10s each, ~52s total, the dominant cost of the >80s full-hydrate query.
--
-- Result-preserving: the subqueries are aggregates (SUM/MAX over the matched set), so
-- an index changes only the access path, never which rows match or the aggregate value.
-- Verified: the full page query returns a byte-identical result set with and without
-- this index. Same pattern/guarantee as migrations 101 and 107.
CREATE INDEX IF NOT EXISTS idx_spd_effective_sto
  ON sap_processed_data (
    (NULLIF(TRIM(COALESCE(
      sto_number::text,
      data->'raw'->>'STO No.',
      data->'raw'->>'STO Number',
      data->'shipment'->>'sto_no',
      data->'contract'->>'sto_no'
    )), ''))
  );

-- The per-row SAP quantity subqueries use the BARE trimmed form (no outer NULLIF), a
-- syntactically distinct expression the NULLIF index above cannot serve. This second
-- index matches that form and is what removes the ~52s of sequential scans.
CREATE INDEX IF NOT EXISTS idx_spd_effective_sto_bare
  ON sap_processed_data (
    (TRIM(COALESCE(
      sto_number::text,
      data->'raw'->>'STO No.',
      data->'raw'->>'STO Number',
      data->'shipment'->>'sto_no',
      data->'contract'->>'sto_no'
    )))
  );

-- Refresh planner stats so the new expression indexes are chosen immediately on deploy.
ANALYZE sap_processed_data;
