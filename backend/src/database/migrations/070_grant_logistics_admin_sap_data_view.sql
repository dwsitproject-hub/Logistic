-- LOGISTICS users with level Admin can open SAP Data (menu + read-only page scope).

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT r.id, p.id, true, false, false, false, 'Admin', NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'LOGISTICS'
  AND p.permission_key = 'page.sap'
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND UPPER(TRIM(COALESCE(rp.level, ''))) = 'ADMIN'
      AND rp.transport_type IS NULL
  );

UPDATE role_permissions rp
SET can_view = true,
    can_create = false,
    can_edit = false,
    can_delete = false
FROM roles r
INNER JOIN permissions p ON p.permission_key = 'page.sap'
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.role_name = 'LOGISTICS'
  AND UPPER(TRIM(COALESCE(rp.level, ''))) = 'ADMIN';
