-- Trucking COMPLETED when |OS Qty| displays as 0 MT (≤499 kg) even if GR PO/STO still Open.
-- Bumps pipeline logic so stage snapshot + summary circles refresh with the new rule.
UPDATE pipeline_summary_refresh_meta
SET is_stale = TRUE
WHERE module = 'trucking';
