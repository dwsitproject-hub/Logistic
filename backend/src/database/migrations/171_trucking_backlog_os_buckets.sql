-- 171 — store the Unplanned backlog's outstanding qty in the daily summary.
--
-- The cold Trucking page spends almost all of its time in one query. Measured on dev
-- 2026-09-15: 35,078ms of a 39,226ms load - 89% - in a single 150KB statement that returns one
-- row. It aggregates outstanding qty over the contract backlog, and it is expensive because per
-- contract it expands both the 26KB GR-status expression (through the backlog predicate) and the
-- cancelled check inside the outstanding expression.
--
-- The row COUNT for the same backlog is already stored here as `unplanned_contract_backlog` and
-- read back by loadTruckingBacklogCountFromSnapshot, which is why the count is instant and the
-- quantity is not. These two columns give the quantity the same treatment.
--
-- Only a source_type split is needed. The summary already keys on `incoterm`, so the FRC/LCO
-- halves of the card come from the existing dimension; only Interco vs 3rd Party has no column.
--
-- Cost moves rather than disappears: the daily refresh does this work once (production's trucking
-- rebuild is 27-29s) instead of every cold page load paying 35s.

ALTER TABLE trucking_pipeline_daily_summary
  ADD COLUMN IF NOT EXISTS backlog_os_third_party_kg NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backlog_os_interco_kg NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backlog_contract_qty_kg NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN trucking_pipeline_daily_summary.backlog_os_third_party_kg IS
  'Unplanned contract backlog outstanding qty (kg), 3rd Party source. Written by buildTruckingUnplannedBacklogDailySummarySql.';
COMMENT ON COLUMN trucking_pipeline_daily_summary.backlog_os_interco_kg IS
  'Unplanned contract backlog outstanding qty (kg), Interco/In-house source. Written by the same builder.';
COMMENT ON COLUMN trucking_pipeline_daily_summary.backlog_contract_qty_kg IS
  'Unplanned contract backlog Contract Qty (kg). Stored so the card can be served without the live aggregate.';
