-- Add ADMIN SUPPORT role (role_name ADMIN_SUPPORT).
-- Level / transport / permission scopes copy SUPPORT so Manage Roles stays consistent.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'ADMIN',
    'TRADING',
    'LOGISTICS',
    'FINANCE',
    'MANAGEMENT',
    'SUPPORT',
    'ADMIN_SUPPORT'
  ));

INSERT INTO roles (role_name, display_name, description)
VALUES (
  'ADMIN_SUPPORT',
  'Admin Support',
  'Admin support access mirroring Support: data validation, audit logs, and support functions'
)
ON CONFLICT (role_name) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  is_active = true,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO role_permissions (
  role_id,
  permission_id,
  can_view,
  can_create,
  can_edit,
  can_delete,
  level,
  transport_type
)
SELECT
  dest.id,
  rp.permission_id,
  rp.can_view,
  rp.can_create,
  rp.can_edit,
  rp.can_delete,
  rp.level,
  rp.transport_type
FROM roles dest
JOIN roles src ON src.role_name = 'SUPPORT'
JOIN role_permissions rp ON rp.role_id = src.id
WHERE dest.role_name = 'ADMIN_SUPPORT'
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions existing
    WHERE existing.role_id = dest.id
      AND existing.permission_id = rp.permission_id
      AND COALESCE(UPPER(TRIM(existing.level)), '') = COALESCE(UPPER(TRIM(rp.level)), '')
      AND COALESCE(UPPER(TRIM(existing.transport_type)), '') = COALESCE(UPPER(TRIM(rp.transport_type)), '')
  );
