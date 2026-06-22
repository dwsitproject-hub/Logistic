-- Migration 089: AI Klip Agent activity logs + page permission

CREATE TABLE IF NOT EXISTS ai_klip_agent_activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_name VARCHAR(120) NOT NULL,
  api_key_name VARCHAR(160) NOT NULL,
  activity TEXT NOT NULL,
  activity_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'success'
    CHECK (status IN ('success', 'error')),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_ai_klip_agent_activity_at
  ON ai_klip_agent_activity_logs (activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_klip_agent_activity_agent
  ON ai_klip_agent_activity_logs (agent_name);

-- Backfill chat history from agent_ai_memory (read-only archive)
INSERT INTO ai_klip_agent_activity_logs (
  agent_name, api_key_name, activity, activity_at, created_by, status
)
SELECT
  'AI Klip Agent — Chat',
  'Google Gemini (gemini-2.5-flash)',
  'Answered question: ' || LEFT(question, 500),
  created_at,
  created_by,
  'success'
FROM agent_ai_memory;

INSERT INTO permissions (permission_key, permission_name, description, category)
SELECT
  'page.ai_klip_agent_activity',
  'AI Klip Agent Activity Log',
  'View AI Klip Agent activity log page',
  'page'
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p WHERE p.permission_key = 'page.ai_klip_agent_activity'
);

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, false, false, false
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('SUPPORT', 'MANAGEMENT', 'LOGISTICS')
  AND p.permission_key = 'page.ai_klip_agent_activity'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.level IS NULL
      AND rp.transport_type IS NULL
  );

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, true, true, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'ADMIN'
  AND p.permission_key = 'page.ai_klip_agent_activity'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.level IS NULL
      AND rp.transport_type IS NULL
  );
