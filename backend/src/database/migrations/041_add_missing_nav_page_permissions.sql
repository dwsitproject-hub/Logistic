-- Page permissions for routes that existed in the app but were missing from the catalog

INSERT INTO permissions (permission_key, permission_name, description, category) VALUES
('page.customer_360', 'Suppliers Dashboard', 'Access to Suppliers Dashboard (Customer 360)', 'page'),
('page.suppliers', 'Suppliers', 'Access to Suppliers page', 'page'),
('page.customer_360_company', 'Customer 360 Company', 'Access to Customer 360 company view', 'page'),
('page.master_product_configuration', 'Master Product Configuration', 'Access to master product configuration', 'page'),
('page.klip_agent_ai', 'KLIP Agent AI', 'Access to KLIP Agent AI page', 'page')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant ADMIN global access (level/transport NULL) for new keys
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, true, true, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'ADMIN'
  AND p.permission_key IN (
    'page.customer_360',
    'page.suppliers',
    'page.customer_360_company',
    'page.master_product_configuration',
    'page.klip_agent_ai'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.level IS NULL
      AND rp.transport_type IS NULL
  );
