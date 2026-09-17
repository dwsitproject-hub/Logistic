-- Lessons apply team-wide, not per user.
--
-- 127 scoped a learned lesson to the user who taught it (NULL meaning everyone). In practice a
-- lesson is an operating standard for the whole logistics/commercial team: if one person teaches
-- the agent that an area name means Group Plant, or that quantities are reported in MT, everyone
-- should get that answer. Per-user scoping meant each colleague had to re-teach the same thing.
--
-- user_id therefore becomes attribution only - who taught it, for audit and review - and is
-- renamed so nobody mistakes it for a visibility filter again.

-- Collapse any (kind, lesson) taught independently by several people into one row, keeping the
-- earliest and preserving the highest usage count. Must run before the new unique index.
WITH ranked AS (
  SELECT
    id,
    kind,
    lower(btrim(lesson)) AS norm,
    ROW_NUMBER() OVER (PARTITION BY kind, lower(btrim(lesson)) ORDER BY created_at ASC) AS rn,
    SUM(times_applied) OVER (PARTITION BY kind, lower(btrim(lesson))) AS total_applied
  FROM agent_ai_lessons
)
UPDATE agent_ai_lessons l
SET times_applied = r.total_applied
FROM ranked r
WHERE l.id = r.id AND r.rn = 1;

DELETE FROM agent_ai_lessons l
USING (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY kind, lower(btrim(lesson)) ORDER BY created_at ASC) AS rn
  FROM agent_ai_lessons
) d
WHERE l.id = d.id AND d.rn > 1;

-- Uniqueness is now team-wide: one row per (kind, lesson), whoever taught it.
DROP INDEX IF EXISTS idx_agent_ai_lessons_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_ai_lessons_unique
  ON agent_ai_lessons (kind, lower(btrim(lesson)));

-- Rename for honesty: this column no longer controls who sees the lesson.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_ai_lessons' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE agent_ai_lessons RENAME COLUMN user_id TO learned_from_user_id;
  END IF;
END $$;

-- Retrieval no longer filters by user, so the lookup index does not need it.
DROP INDEX IF EXISTS idx_agent_ai_lessons_lookup;
CREATE INDEX IF NOT EXISTS idx_agent_ai_lessons_lookup
  ON agent_ai_lessons (is_active, updated_at DESC);

COMMENT ON COLUMN agent_ai_lessons.learned_from_user_id IS
  'Attribution only: which user taught this lesson. Lessons apply team-wide regardless of this value. Retire a bad lesson with is_active = false.';
