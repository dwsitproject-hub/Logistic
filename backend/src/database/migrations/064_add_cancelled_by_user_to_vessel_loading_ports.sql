-- Track which user cancelled a vessel loading port activity
ALTER TABLE vessel_loading_ports
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vessel_loading_ports_cancelled_by_user_id_fkey'
  ) THEN
    ALTER TABLE vessel_loading_ports
      ADD CONSTRAINT vessel_loading_ports_cancelled_by_user_id_fkey
      FOREIGN KEY (cancelled_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vessel_loading_ports_cancelled_by_user_id
  ON vessel_loading_ports (cancelled_by_user_id);
