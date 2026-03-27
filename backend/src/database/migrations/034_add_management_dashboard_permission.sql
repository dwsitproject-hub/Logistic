-- Management Dashboard page permission (mirrors page.dashboard access per role)

INSERT INTO permissions (permission_key, permission_name, description, category) VALUES
('page.management_dashboard', 'Management Dashboard Access', 'Access to the Management Dashboard page', 'page')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT rp.role_id, p_new.id, rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
FROM role_permissions rp
JOIN permissions p_old ON p_old.id = rp.permission_id AND p_old.permission_key = 'page.dashboard'
JOIN permissions p_new ON p_new.permission_key = 'page.management_dashboard'
ON CONFLICT (role_id, permission_id) DO NOTHING;
