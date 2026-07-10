-- LOGISTICS users (incl. Staff) need Contracts + Contract Performance in navigation.
-- Default seeds grant page.contracts only to TRADING; this enables read access for LOGISTICS.

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT r.id, p.id, true, false, false, false, NULL, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'LOGISTICS'
  AND p.permission_key IN ('page.contracts', 'data.contracts')
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.level IS NULL
      AND rp.transport_type IS NULL
  );

UPDATE role_permissions rp
SET can_view = true
FROM roles r
INNER JOIN permissions p ON p.permission_key IN ('page.contracts', 'data.contracts')
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.role_name = 'LOGISTICS';
