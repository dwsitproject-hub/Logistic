-- Add Claim Mutu page permission

INSERT INTO permissions (permission_key, permission_name, description, category) VALUES
('page.claim_mutu', 'Claim Mutu', 'Access to Claim Mutu page', 'page')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant ADMIN global access
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, true, true, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'ADMIN'
  AND p.permission_key = 'page.claim_mutu'
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.level IS NULL
      AND rp.transport_type IS NULL
  );

-- Grant MANAGEMENT + SUPPORT + LOGISTICS view access (aligns with trucking-adjacent workflows)
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, false, false, false
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('MANAGEMENT','SUPPORT','LOGISTICS')
  AND p.permission_key = 'page.claim_mutu'
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.level IS NULL
      AND rp.transport_type IS NULL
  );

