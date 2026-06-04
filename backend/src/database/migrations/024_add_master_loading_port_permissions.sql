-- New page & data permissions for Master Loading Port

INSERT INTO permissions (permission_key, permission_name, description, category) VALUES
('page.master_loading_ports', 'Master Loading Port Page', 'Access to Master Loading Port management page', 'page'),
('data.master_loading_ports', 'Master Loading Port Data', 'Create/edit Master Loading Port records', 'data')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant LOGISTICS and SUPPORT view access by default; ADMIN already has all permissions

-- LOGISTICS role
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, true, true, false
FROM roles r
JOIN permissions p ON p.permission_key IN ('page.master_loading_ports', 'data.master_loading_ports')
WHERE r.role_name = 'LOGISTICS'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- SUPPORT role (view-only)
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, false, false, false
FROM roles r
JOIN permissions p ON p.permission_key = 'page.master_loading_ports'
WHERE r.role_name = 'SUPPORT'
ON CONFLICT (role_id, permission_id) DO NOTHING;

