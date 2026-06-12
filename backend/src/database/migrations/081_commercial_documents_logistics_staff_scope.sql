-- LOGISTICS Staff must not inherit unscoped Commercial Documents access added after migration 072.

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT r.id, p.id, false, false, false, false, 'Staff', NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'LOGISTICS'
  AND p.permission_key = 'page.commercial_documents'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND UPPER(TRIM(COALESCE(rp.level, ''))) = 'STAFF'
      AND rp.transport_type IS NULL
  );
