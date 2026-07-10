-- Backfill unscoped (global) ADMIN grants for permissions added after migration 006.
-- Without level IS NULL rows, users with level NULL (e.g. local admin) cannot see sidebar items
-- that only have Staff-scoped role_permissions rows.

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT r.id, p.id, true, true, true, true, NULL, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'ADMIN'
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.level IS NULL
      AND rp.transport_type IS NULL
  );
