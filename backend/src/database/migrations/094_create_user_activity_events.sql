-- User Activity Log: granular UI/API events for daily usage summaries (Admin-only report page).

CREATE TABLE IF NOT EXISTS user_activity_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('CLICK', 'CREATE', 'UPDATE', 'EDIT', 'VIEW')),
  page_path VARCHAR(500),
  action_label VARCHAR(500),
  entity_type VARCHAR(100),
  entity_id VARCHAR(255),
  metadata JSONB,
  event_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_activity_events_user_event_at
  ON user_activity_events (user_id, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_activity_events_event_at
  ON user_activity_events (event_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_activity_events_user_date
  ON user_activity_events (user_id, ((event_at AT TIME ZONE 'UTC')::date));
