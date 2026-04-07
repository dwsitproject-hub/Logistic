-- 045_add_claim_susut_permission.sql
-- Dedicated page permission for Claim Susut.

-- IMPORTANT: some environments do NOT have a unique constraint on permissions.permission_key,
-- so avoid ON CONFLICT and use WHERE NOT EXISTS + UPDATE backfill.

UPDATE permissions
SET
  permission_name = COALESCE(permission_name, 'Claim Susut'),
  description = COALESCE(description, 'Access Claim Susut page'),
  category = COALESCE(category, 'page')
WHERE permission_key = 'page.claim_susut';

INSERT INTO permissions (permission_key, permission_name, description, category)
SELECT 'page.claim_susut', 'Claim Susut', 'Access Claim Susut page', 'page'
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p WHERE p.permission_key = 'page.claim_susut'
);

-- Grant ADMIN full access and other business roles view access
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, true, true, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'ADMIN'
  AND p.permission_key = 'page.claim_susut'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, false, false, false
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('MANAGEMENT', 'SUPPORT', 'LOGISTICS')
  AND p.permission_key = 'page.claim_susut'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

