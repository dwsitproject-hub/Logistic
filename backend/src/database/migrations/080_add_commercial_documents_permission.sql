-- Commercial Documents page permission

UPDATE permissions
SET
  permission_name = COALESCE(permission_name, 'Commercial Documents'),
  description = COALESCE(description, 'Access Commercial Documents page'),
  category = COALESCE(category, 'page')
WHERE permission_key = 'page.commercial_documents';

INSERT INTO permissions (permission_key, permission_name, description, category)
SELECT
  'page.commercial_documents',
  'Commercial Documents',
  'Access Commercial Documents page',
  'page'
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p WHERE p.permission_key = 'page.commercial_documents'
);

-- ADMIN — full access
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, true, true, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'ADMIN'
  AND p.permission_key = 'page.commercial_documents'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.level IS NULL
      AND rp.transport_type IS NULL
  );

-- Business roles — view + upload/edit (no delete)
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, true, true, false
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('MANAGEMENT', 'TRADING', 'LOGISTICS', 'SUPPORT')
  AND p.permission_key = 'page.commercial_documents'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.level IS NULL
      AND rp.transport_type IS NULL
  );
