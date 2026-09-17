-- Planner's Excel Group bundle code (e.g. WILMAR-1), distinct from KLIP group_code (PPM-…).
ALTER TABLE pre_planned_groups
  ADD COLUMN IF NOT EXISTS excel_group_label TEXT NULL;

COMMENT ON COLUMN pre_planned_groups.excel_group_label IS
  'Optional bundle code typed in the Unplanned grouping Excel (Select=Y + Group). Not the vessel name.';
