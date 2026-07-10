-- Separate performance pages from operational list pages.
-- Restrict LOGISTICS level Staff to Contracts, Shipments, and Trucking only.

INSERT INTO permissions (permission_key, permission_name, description, category)
SELECT v.permission_key, v.permission_name, v.description, v.category
FROM (VALUES
  ('page.contract_performance', 'Contract Performance', 'Access to Contract Performance page', 'page'),
  ('page.shipping_performance', 'Shipping Performance', 'Access to Shipping Performance page', 'page')
) AS v(permission_key, permission_name, description, category)
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p WHERE p.permission_key = v.permission_key
);

-- ADMIN already has all permissions via global grant.

-- MANAGEMENT — view performance pages
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT r.id, p.id, true, false, false, false, NULL, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'MANAGEMENT'
  AND p.permission_key IN ('page.contract_performance', 'page.shipping_performance')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.level IS NULL AND rp.transport_type IS NULL
  );

-- TRADING — Contract Performance (operational contracts list uses page.contracts)
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT r.id, p.id, true, false, false, false, NULL, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'TRADING'
  AND p.permission_key = 'page.contract_performance'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.level IS NULL AND rp.transport_type IS NULL
  );

-- LOGISTICS (unscoped) — performance + master remain for Dept Head / Section Head / Admin / users without Staff scope
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT r.id, p.id, true, false, false, false, NULL, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'LOGISTICS'
  AND p.permission_key IN ('page.contract_performance', 'page.shipping_performance')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.level IS NULL AND rp.transport_type IS NULL
  );

-- LOGISTICS Staff — only Contracts, Shipments, Trucking (+ related data/actions)
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT
  r.id,
  p.id,
  CASE
    WHEN p.permission_key IN (
      'page.contracts', 'page.shipments', 'page.trucking',
      'data.contracts', 'data.shipments', 'data.trucking',
      'action.import_excel', 'action.export_data'
    ) THEN true
    ELSE false
  END,
  CASE
    WHEN p.permission_key IN ('data.contracts', 'data.shipments', 'data.trucking', 'action.import_excel', 'action.export_data') THEN true
    ELSE false
  END,
  CASE
    WHEN p.permission_key IN ('data.contracts', 'data.shipments', 'data.trucking') THEN true
    ELSE false
  END,
  false,
  'Staff',
  NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'LOGISTICS'
  AND (
    p.category IN ('page', 'data', 'action')
    OR p.permission_key LIKE 'dashboard.%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND UPPER(TRIM(COALESCE(rp.level, ''))) = 'STAFF'
      AND rp.transport_type IS NULL
  );
