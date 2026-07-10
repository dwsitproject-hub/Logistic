-- New page & data permissions for Master Plant

INSERT INTO permissions (permission_key, permission_name, description, category) VALUES
('page.master_plants', 'Master Plant Page', 'Access to Master Plant management page', 'page'),
('data.master_plants', 'Master Plant Data', 'Create/edit Master Plant records', 'data')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant LOGISTICS view access by default; ADMIN already has all permissions

-- LOGISTICS role
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, true, true, false
FROM roles r
JOIN permissions p ON p.permission_key IN ('page.master_plants', 'data.master_plants')
WHERE r.role_name = 'LOGISTICS'
AND NOT EXISTS (
  SELECT 1
  FROM role_permissions rp
  WHERE rp.role_id = r.id
    AND rp.permission_id = p.id
    AND COALESCE(UPPER(TRIM(rp.level)), '') = ''
    AND COALESCE(UPPER(TRIM(rp.transport_type)), '') = ''
);

-- SUPPORT role (view-only)
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, false, false, false
FROM roles r
JOIN permissions p ON p.permission_key = 'page.master_plants'
WHERE r.role_name = 'SUPPORT'
AND NOT EXISTS (
  SELECT 1
  FROM role_permissions rp
  WHERE rp.role_id = r.id
    AND rp.permission_id = p.id
    AND COALESCE(UPPER(TRIM(rp.level)), '') = ''
    AND COALESCE(UPPER(TRIM(rp.transport_type)), '') = ''
);

