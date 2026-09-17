-- Operations whose stage-snapshot row was refreshed on write, so a full rebuild cannot undo it.
--
-- The problem this solves. The trucking rebuild reads its source, spends 227s (dev) to 27min
-- (SIT) building, then swaps the result in wholesale. A WB upload that lands *during* a build
-- gets a targeted delta applied immediately - and then the swap replaces that row with the
-- version the build read before the upload existed. The row silently regresses to its pre-upload
-- quantities, which is worse than never having refreshed it.
--
-- So every targeted refresh records what it touched. After a swap, the refresh re-applies the
-- deltas recorded since it started reading, and prunes the rest. One row per operation: only the
-- latest touch matters, because the delta rebuilds the row from current data rather than
-- applying an increment.
CREATE TABLE IF NOT EXISTS trucking_stage_snapshot_delta_log (
  operation_id UUID PRIMARY KEY,
  touched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The catch-up reads "everything touched since this instant", and the prune deletes by the same
-- predicate. Both are range scans on touched_at.
CREATE INDEX IF NOT EXISTS idx_trucking_stage_snapshot_delta_log_touched_at
  ON trucking_stage_snapshot_delta_log (touched_at);

-- No FK to trucking_operations on purpose: this is a bookkeeping log, and an operation deleted
-- between the touch and the catch-up must not fail the refresh. The delta's own DELETE+INSERT
-- resolves such a row to "absent", which is correct.
