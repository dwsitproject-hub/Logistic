-- Shipping Performance / shipment-info load: index the effective-STO expression.
--
-- The Shipping Performance query resolves an STO's type with correlated subqueries whose join
-- predicate is a TRIM-wrapped COALESCE over the STO sources on sap_processed_data. With no index
-- on that expression, Postgres sequentially scanned all ~9,800 sap_processed_data rows ONCE PER
-- OUTER ROW - 914 and 658 loops in the measured plan, ~5ms each, about 8 seconds of the total.
--
-- Measured on the local staging copy:
--   Shipping Performance query   13.4s -> 2.5s   (EXPLAIN ANALYZE execution time)
--   /performance/summary          32.4s -> 0.5s   (served warm)
--   /performance/tree              1.1s -> 0.5s
--   ship-icon /edit-payload        3.9s -> 1.9s   (shares the same STO subqueries)
--   ship-icon /loading-ports       1.2s -> 0.6s
--
-- This is purely additive: an index cannot change what the query returns. Verified by capturing
-- /performance/summary and /performance/tree with and without the index - both byte-identical.
--
-- The expression must match the query's text exactly or the planner will ignore the index. It is
-- the same shape as the effective-STO COALESCE used by shippingPerformance.service.ts and the
-- shipment list. If that expression changes, this index must change with it.
--
-- Fourth TRIM-expression index on this table (see 121/122/123): TRIM()-wrapped join predicates on
-- sap_processed_data are a recurring cause of per-row sequential scans here.

CREATE INDEX IF NOT EXISTS idx_spd_effective_sto_trim
  ON sap_processed_data ((
    TRIM(
      NULLIF(TRIM(COALESCE(
        sto_number::text,
        data->'raw'->>'STO No.',
        data->'raw'->>'STO Number',
        data->'raw'->>'STO No',
        data->'shipment'->>'sto_no',
        data->'contract'->>'sto_no'
      )), '')
    )
  ));

-- Fresh statistics so the planner actually picks the new index.
ANALYZE sap_processed_data;
