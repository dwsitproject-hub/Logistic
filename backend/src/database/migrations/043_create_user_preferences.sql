-- 043_create_user_preferences.sql
-- Store per-user UI preferences (e.g., visible columns) as JSON.

CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pref_key VARCHAR(150) NOT NULL,
  pref_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, pref_key)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user_key
  ON user_preferences (user_id, pref_key);

