-- Section 3's view table renders GR STO Status from `gr_sto_status_agg`, which
-- sqlContractListGrStoStatusAggExpr computes per contract: 7.4KB of SQL carrying 4 correlated
-- sap_processed_data subqueries, evaluated for every contract row inside the base GROUP BY -
-- alongside import_status (25.8KB, 13 subqueries). Those two are what make the view table's LIST
-- and COUNT queries cost ~65s each (measured 2026-09-08, 104s wall for 20 rows).
--
-- Both answers are per contract and change only on SAP import, which is exactly when this
-- snapshot is refreshed, so the table can read them instead of recomputing them per request.
-- import_status is already a column here; this adds the other one.
--
-- Nullable, no backfill: populated by the next full snapshot rebuild. Until then the read path
-- keeps computing it live (it is gated on the snapshot being fresh, and a rebuild is what clears
-- the stale flag), so no request can see a NULL where a status belongs.
ALTER TABLE contract_performance_snapshot
  ADD COLUMN IF NOT EXISTS gr_sto_status_agg TEXT;
