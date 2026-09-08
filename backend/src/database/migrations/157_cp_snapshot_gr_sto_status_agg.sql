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
-- Nullable, no backfill - and that is exactly why the snapshot has to be marked stale here.
--
-- Adding a column does not invalidate the snapshot, so without the UPDATE below the read path
-- would find a *fresh* snapshot whose gr_sto_status_agg is NULL for every row, and the view
-- table's GR STO Status column would render blank on every deploy until someone rebuilt it. The
-- stale flag sends reads back to the live computation - slower, but correct - until the rebuild
-- lands and clears it.
--
-- Rebuild with `npx ts-node src/scripts/rebuildCpSnapshotBatched.ts`, not refreshAll(): on a 1 GiB
-- container refreshAll reached 985 MiB of 1024 before being cancelled, and an OOM there restarts
-- the whole cluster. The SAP import path refreshes it too, so an import also clears this.
ALTER TABLE contract_performance_snapshot
  ADD COLUMN IF NOT EXISTS gr_sto_status_agg TEXT;

UPDATE contract_performance_snapshot_meta SET is_stale = TRUE WHERE id = 'global';
