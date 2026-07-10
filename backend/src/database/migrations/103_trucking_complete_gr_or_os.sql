-- Trucking COMPLETED = GR Close OR (GR Open + OS within tolerance).
UPDATE pipeline_summary_refresh_meta
SET is_stale = TRUE
WHERE module = 'trucking';
