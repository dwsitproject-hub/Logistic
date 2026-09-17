-- The Contract Performance snapshot was built with withdrawn contracts excluded, so it could
-- never serve Section 3's view table: that table deliberately still lists them (their history has
-- to stay reachable behind ?presence=). Absence no longer withdraws anything - cancellation comes
-- from SAP's Delete PO / Delete STO flags - so the snapshot can now cover every contract, and the
-- read paths that must not count withdrawn ones filter on this column instead.
--
-- Nullable with no default and no backfill: the snapshot is fully rebuilt by
-- ContractPerformanceSnapshotService (or rebuildCpSnapshotBatched.ts), which populates it. Until
-- that rebuild runs the column is NULL, and NULL is neither 'PRESENT' nor 'WITHDRAWN' - so the
-- read filter is written as `<> 'WITHDRAWN'` (not `= 'PRESENT'`) to keep pre-rebuild rows visible
-- rather than silently dropping every row of a snapshot built by the previous version.
ALTER TABLE contract_performance_snapshot
  ADD COLUMN IF NOT EXISTS sap_presence TEXT;
