-- Commercial Documents: page + data permissions for Role & User Management (roles UI catalog).
-- Idempotent — safe if 080/081 already applied.

INSERT INTO permissions (permission_key, permission_name, description, category)
SELECT v.permission_key, v.permission_name, v.description, v.category
FROM (VALUES
  (
    'page.commercial_documents',
    'Commercial Documents',
    'Access Commercial Documents page (contract payment document checklist and upload)',
    'page'
  ),
  (
    'data.commercial_documents',
    'Commercial Documents Data',
    'View, upload, and manage commercial document files linked to contracts',
    'data'
  )
) AS v(permission_key, permission_name, description, category)
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p WHERE p.permission_key = v.permission_key
);

UPDATE permissions
SET
  permission_name = 'Commercial Documents',
  description = 'Access Commercial Documents page (contract payment document checklist and upload)',
  category = 'page'
WHERE permission_key = 'page.commercial_documents';

UPDATE permissions
SET
  permission_name = 'Commercial Documents Data',
  description = 'View, upload, and manage commercial document files linked to contracts',
  category = 'data'
WHERE permission_key = 'data.commercial_documents';

-- ADMIN — full access (both keys)
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT r.id, p.id, true, true, true, true, NULL, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'ADMIN'
  AND p.permission_key IN ('page.commercial_documents', 'data.commercial_documents')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.level IS NULL
      AND rp.transport_type IS NULL
  );

-- MANAGEMENT — view + upload/edit (oversight; no delete)
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT r.id, p.id, true, true, true, false, NULL, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'MANAGEMENT'
  AND p.permission_key IN ('page.commercial_documents', 'data.commercial_documents')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.level IS NULL
      AND rp.transport_type IS NULL
  );

-- FINANCE — primary owner of commercial/payment documents
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT r.id, p.id, true, true, true, false, NULL, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'FINANCE'
  AND p.permission_key IN ('page.commercial_documents', 'data.commercial_documents')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.level IS NULL
      AND rp.transport_type IS NULL
  );

-- TRADING, LOGISTICS (unscoped), SUPPORT — view + upload/edit
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT r.id, p.id, true, true, true, false, NULL, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('TRADING', 'LOGISTICS', 'SUPPORT')
  AND p.permission_key IN ('page.commercial_documents', 'data.commercial_documents')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.level IS NULL
      AND rp.transport_type IS NULL
  );

-- LOGISTICS Staff — explicit deny (extends 081 for page key; also covers data key)
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT r.id, p.id, false, false, false, false, 'Staff', NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'LOGISTICS'
  AND p.permission_key IN ('page.commercial_documents', 'data.commercial_documents')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND UPPER(TRIM(COALESCE(rp.level, ''))) = 'STAFF'
      AND rp.transport_type IS NULL
  );
