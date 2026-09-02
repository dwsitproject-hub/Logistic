-- Distinguish manually created Preplanned groups (user-selected via Shipments
-- View Table "Select" column) from auto-generated grouping suggestions.
ALTER TABLE pre_planned_groups
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'AUTO',
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID NULL REFERENCES users(id);

ALTER TABLE pre_planned_groups
  DROP CONSTRAINT IF EXISTS pre_planned_groups_source_check;

ALTER TABLE pre_planned_groups
  ADD CONSTRAINT pre_planned_groups_source_check CHECK (source IN ('AUTO', 'MANUAL'));

COMMENT ON COLUMN pre_planned_groups.source IS 'AUTO = clustering rebuild suggestion; MANUAL = user-selected via Shipments Select column';
COMMENT ON COLUMN pre_planned_groups.created_by_user_id IS 'User who manually created the group (NULL for AUTO groups)';
