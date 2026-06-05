-- View contract payment fields in Contract Details modal (Payment Information section).

INSERT INTO permissions (permission_key, permission_name, description, category)
SELECT
  'data.contract_payment_info',
  'Contract Payment Information',
  'View payment and financial fields in the contract details modal',
  'data'
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p WHERE p.permission_key = 'data.contract_payment_info'
);

-- ADMIN — full access
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT r.id, p.id, true, true, true, true, NULL, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'ADMIN'
  AND p.permission_key = 'data.contract_payment_info'
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.level IS NULL
      AND rp.transport_type IS NULL
  );

-- MANAGEMENT — view only (global scope)
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT r.id, p.id, true, false, false, false, NULL, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'MANAGEMENT'
  AND p.permission_key = 'data.contract_payment_info'
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
INNER JOIN permissions p ON p.permission_key = 'data.contract_payment_info'
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.role_name = 'MANAGEMENT'
  AND rp.level IS NULL
  AND rp.transport_type IS NULL;

-- TRADING — Staff and Admin levels only
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT r.id, p.id, true, false, false, false, scoped.level, NULL
FROM roles r
CROSS JOIN permissions p
CROSS JOIN (VALUES ('Staff'), ('Admin')) AS scoped(level)
WHERE r.role_name = 'TRADING'
  AND p.permission_key = 'data.contract_payment_info'
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND UPPER(TRIM(COALESCE(rp.level, ''))) = UPPER(TRIM(scoped.level))
      AND rp.transport_type IS NULL
  );

UPDATE role_permissions rp
SET can_view = true,
    can_create = false,
    can_edit = false,
    can_delete = false
FROM roles r
INNER JOIN permissions p ON p.permission_key = 'data.contract_payment_info'
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.role_name = 'TRADING'
  AND UPPER(TRIM(COALESCE(rp.level, ''))) IN ('STAFF', 'ADMIN');
