-- 055_add_oil_loss_permission.sql
-- Dedicated page permission for Oil Loss.

UPDATE permissions
SET
  permission_name = COALESCE(permission_name, 'Oil Loss'),
  description = COALESCE(description, 'Access Oil Loss page'),
  category = COALESCE(category, 'page')
WHERE permission_key = 'page.oil_loss';

INSERT INTO permissions (permission_key, permission_name, description, category)
SELECT 'page.oil_loss', 'Oil Loss', 'Access Oil Loss page', 'page'
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p WHERE p.permission_key = 'page.oil_loss'
);

-- Grant ADMIN full access
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, true, true, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'ADMIN'
  AND p.permission_key = 'page.oil_loss'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- Grant view access to business roles
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, false, false, false
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('MANAGEMENT', 'SUPPORT', 'LOGISTICS')
  AND p.permission_key = 'page.oil_loss'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
