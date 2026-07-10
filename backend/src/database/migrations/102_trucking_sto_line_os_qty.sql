-- STO-expanded trucking OS Qty uses per-STO SAP qty (not full PO contract qty).
UPDATE pipeline_summary_refresh_meta
SET is_stale = TRUE
WHERE module = 'trucking';
