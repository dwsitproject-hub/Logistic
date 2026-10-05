-- What happened the LAST time KLIP tried to push a master to DHM, for the rows where it did not go through.
--
-- A master is saved in KLIP first and pushed to DHM second, and a failed push never rolls the save back. The failure
-- used to be a line in the response the user glanced at; nothing remembered it, so the row stayed different from DHM
-- until somebody noticed and pressed Sync. This table remembers it: the master tables show it, and a retry job pushes the
-- row again with its CURRENT data.
--
--   FAILED    DHM was unreachable, rejected the row, or a parent it needs is not in DHM yet. Retried with backoff.
--   CONFLICT  DHM already holds a different record under that name or code (409). Needs a person to decide to overwrite,
--             so it is never retried automatically.
--
-- A row exists only while there is something to fix: a push that goes through deletes it. entity_kind is the DHM_SYNC_MASTERS
-- name (vessel, product, port, plant, site, company, ext_company, incoterm); entity_id is the id in that master's table.

CREATE TABLE IF NOT EXISTS dhm_push_state (
  entity_kind TEXT NOT NULL,
  entity_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('FAILED', 'CONFLICT')),
  error TEXT,
  attempts INT NOT NULL DEFAULT 1,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL once the automatic attempts are used up (or for a CONFLICT): from then on only a person retries it.
  next_attempt_at TIMESTAMPTZ,
  PRIMARY KEY (entity_kind, entity_id)
);

-- The retry job asks "which failed rows are due".
CREATE INDEX IF NOT EXISTS idx_dhm_push_state_due
  ON dhm_push_state (next_attempt_at)
  WHERE status = 'FAILED' AND next_attempt_at IS NOT NULL;
