-- Trucking Section 1 - status-card quantities and the Outstanding Qty strip - is computed live on
-- every cold request. Measured 2026-09-10: that one query is ~23-37s and ~3.0M root buffers, and
-- `SELECT count(*) FROM filtered` costs the same as the whole summary, so producing the expanded
-- rows *is* the cost; aggregating them is free.
--
-- Four tunings were measured and all four ruled out: the SAP qty jsonb families are 17% of the
-- buffers, `enable_nestloop=off` made it 3x worse, `grOpenOnly` is worth 2%, and the 7s planning
-- time was a cold-run artefact. Only precomputation moves it.
--
-- WHY AT ROW GRAIN, AND NOT AS AGGREGATES
--
-- The obvious move - store the aggregates per (group_plant, contract_date, product, incoterm) next
-- to the counts already there - was built, measured, and thrown away. It is unsound: the live
-- query dedups with `GROUP BY status, contract_number`, and `contract_number` in the trucking
-- expansion is not a contract id but
-- `STRING_AGG(DISTINCT cc.contract_id, ', ')` over every LAND contract sharing the STO
-- (truckingListSelectSql.ts). One group can therefore span several real contracts with different
-- plants, products and incoterms, and `MAX(contract_qty)` is taken once for the whole group.
-- Splitting that group by dimension breaks it apart and the per-part MAXes sum to more than the
-- whole. Measured against live on identical data, with all six status counts matching exactly so
-- the row scope was the same: 7 of 13 figures wrong, completed_contract_qty by +2,018,490 kg.
-- Counts survived that split only because counting rows is additive at any grain.
--
-- So the expensive part is stored at the grain it is produced at - one row per operation - and the
-- cheap aggregation stays at read time, over the same shared CTEs the live path uses. Verified
-- before building: `trucking_list_stage_snapshot` already holds exactly 6,496 rows for the default
-- YTD window, the same count as the live `filtered` CTE. Same grain, so nothing has to be
-- re-derived, and dimension filters keep working because filtering still happens *before* the
-- grouping, exactly as live.
--
-- The refresh already runs this expansion to populate `stage`; these columns come from the same
-- rows it is already reading, so the build does not get another pass. (The rejected aggregate
-- version added its own CTE chain and took the trucking build from 234s to 469s.)
--
-- `incoterm_eff` is deliberately not called `incoterm`: that name is taken by the dimension key,
-- which is bucketed via sqlPipelineIncotermKey. The strip reads the expanded row's own incoterm.

ALTER TABLE trucking_list_stage_snapshot
  /*
   * The dedup key, and the reason this table is the right place: it is a comma-joined list of
   * contract ids, so it has to be stored verbatim and grouped on as-is.
   */
  ADD COLUMN IF NOT EXISTS contract_number text,
  ADD COLUMN IF NOT EXISTS contract_qty numeric,
  ADD COLUMN IF NOT EXISTS outstanding_quantity numeric,
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS incoterm_eff text,
  /*
   * The live `filtered` CTE keeps only rows whose expanded `sap_presence` is PRESENT - a
   * cancelled or deleted PO must not count towards the cards even though the list still shows it.
   * Stored so the read path can apply the identical predicate rather than approximate it from the
   * contract.
   */
  ADD COLUMN IF NOT EXISTS sap_presence text,
  /* Loading / In Transit / Unloading counts are keyed off status_db, not status. */
  ADD COLUMN IF NOT EXISTS status_db text;

/*
 * Section 1 reads this table filtered by dimension and grouped by (stage, contract_number), so the
 * dimension index already present is the access path; this one serves the grouping.
 */
CREATE INDEX IF NOT EXISTS idx_trucking_list_stage_snapshot_section1
  ON trucking_list_stage_snapshot (contract_date, stage, contract_number);

COMMENT ON COLUMN trucking_list_stage_snapshot.contract_number IS
  'Comma-joined list of LAND contract ids sharing this STO, as the trucking expansion produces it. Section 1 dedups on this exact string - grouping on anything finer inflates the quantity totals (measured: +2,018,490 kg on completed contract qty).';
