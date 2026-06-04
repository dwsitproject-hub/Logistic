-- New page & data permissions for Master Vessel

INSERT INTO permissions (permission_key, permission_name, description, category) VALUES
('page.master_vessels', 'Master Vessel Page', 'Access to Master Vessel management page', 'page'),
('data.master_vessels', 'Master Vessel Data', 'Create/edit Master Vessel records', 'data')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant LOGISTICS and SUPPORT view access by default; ADMIN already has all permissions from 006 migration

-- LOGISTICS role
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, true, true, false
FROM roles r
JOIN permissions p ON p.permission_key IN ('page.master_vessels', 'data.master_vessels')
WHERE r.role_name = 'LOGISTICS'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- SUPPORT role (view-only)
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, false, false, false
FROM roles r
JOIN permissions p ON p.permission_key = 'page.master_vessels'
WHERE r.role_name = 'SUPPORT'
ON CONFLICT (role_id, permission_id) DO NOTHING;

