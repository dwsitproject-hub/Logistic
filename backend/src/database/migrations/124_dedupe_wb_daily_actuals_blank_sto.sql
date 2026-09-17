-- WB daily actuals: legacy PO-level rows (blank sto_number, uploaded before the
-- multi-STO feature) were left in place when a re-upload wrote STO-stamped rows for
-- the same (operation, progress_date) — the upsert key (op, date, sto_number) treats
-- them as different rows, so every quantity sum counted the same physical weighbridge
-- day twice (bug reports: Trucking OS "gain" for PO 1001030830, Contract Performance
-- OS for PO 1001030675 at exactly 2x contract).
-- Rule restored here and enforced by the importer: a given (operation, progress_date)
-- holds EITHER one PO-level row OR per-STO rows, never both. STO-stamped rows are the
-- newer, more granular truth, so the superseded blank rows are removed.
DELETE FROM trucking_daily_actuals da
WHERE NULLIF(TRIM(COALESCE(da.sto_number::text, '')), '') IS NULL
  AND EXISTS (
    SELECT 1 FROM trucking_daily_actuals s
    WHERE s.trucking_operation_id = da.trucking_operation_id
      AND s.progress_date = da.progress_date
      AND NULLIF(TRIM(COALESCE(s.sto_number::text, '')), '') IS NOT NULL
  );
