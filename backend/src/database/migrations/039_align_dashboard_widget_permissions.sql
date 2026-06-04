-- Align dashboard widget permissions with current Dashboard page widgets

-- Preserve existing role behavior by snapshotting old dashboard widget visibility
CREATE TEMP TABLE tmp_old_dashboard_widget_flags AS
SELECT
  r.id AS role_id,
  COALESCE(MAX(CASE WHEN p.permission_key = 'dashboard.contracts_overview' THEN rp.can_view::int ELSE 0 END), 0) AS can_contracts,
  COALESCE(MAX(CASE WHEN p.permission_key = 'dashboard.shipments_overview' THEN rp.can_view::int ELSE 0 END), 0) AS can_shipments,
  COALESCE(MAX(CASE WHEN p.permission_key = 'dashboard.finance_overview' THEN rp.can_view::int ELSE 0 END), 0) AS can_finance,
  COALESCE(MAX(CASE WHEN p.permission_key = 'dashboard.alerts' THEN rp.can_view::int ELSE 0 END), 0) AS can_ai_insight,
  COALESCE(MAX(CASE WHEN p.permission_key = 'dashboard.top_performers' THEN rp.can_view::int ELSE 0 END), 0) AS can_top_performers
FROM roles r
LEFT JOIN role_permissions rp ON rp.role_id = r.id
LEFT JOIN permissions p ON p.id = rp.permission_id
GROUP BY r.id;

-- Remove legacy dashboard widget permissions
DELETE FROM permissions
WHERE permission_key IN (
  'dashboard.contracts_overview',
  'dashboard.shipments_overview',
  'dashboard.finance_overview',
  'dashboard.alerts',
  'dashboard.top_performers'
);

-- Insert current dashboard widget permissions
INSERT INTO permissions (permission_key, permission_name, description, category) VALUES
('dashboard.ai_logistics_insight', 'AI Logistics Insight Widget', 'Access AI-generated logistics insight card', 'dashboard'),
('dashboard.quantity_performance', 'Quantity Performance Widget', 'Access quantity performance card', 'dashboard'),
('dashboard.shipment_performance', 'Shipment Performance Widget', 'Access shipment performance card', 'dashboard'),
('dashboard.trucking_performance', 'Trucking Performance Widget', 'Access trucking performance card', 'dashboard'),
('dashboard.payment_performance', 'Payment Performance Widget', 'Access payment performance card', 'dashboard'),
('dashboard.contract_quantity_by_product', 'Contract Quantity by Product Widget', 'Access contract quantity by product (incoterm mix) card', 'dashboard'),
('dashboard.contract_amount_by_product', 'Contract Amount by Product Widget', 'Access contract amount by product (incoterm mix) card', 'dashboard'),
('dashboard.contract_quantity_by_plant', 'Contract Quantity by Plant/Site Widget', 'Access contract quantity by plant/site card', 'dashboard'),
('dashboard.top_suppliers', 'Top Suppliers Widget', 'Access top suppliers widget', 'dashboard'),
('dashboard.top_trucking_owners', 'Top Trucking Owners Widget', 'Access top trucking owners widget', 'dashboard'),
('dashboard.top_vessels', 'Top Vessels Widget', 'Access top vessels widget', 'dashboard')
ON CONFLICT (permission_key) DO UPDATE
SET
  permission_name = EXCLUDED.permission_name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

-- Map old visibility to new widgets for existing role permissions
WITH old_flags AS (
  SELECT * FROM tmp_old_dashboard_widget_flags
),
desired AS (
  SELECT role_id, 'dashboard.ai_logistics_insight'::text AS permission_key, can_ai_insight::boolean AS can_view FROM old_flags
  UNION ALL SELECT role_id, 'dashboard.quantity_performance', can_contracts::boolean FROM old_flags
  UNION ALL SELECT role_id, 'dashboard.shipment_performance', can_shipments::boolean FROM old_flags
  UNION ALL SELECT role_id, 'dashboard.trucking_performance', can_shipments::boolean FROM old_flags
  UNION ALL SELECT role_id, 'dashboard.payment_performance', can_finance::boolean FROM old_flags
  UNION ALL SELECT role_id, 'dashboard.contract_quantity_by_product', can_contracts::boolean FROM old_flags
  UNION ALL SELECT role_id, 'dashboard.contract_amount_by_product', can_contracts::boolean FROM old_flags
  UNION ALL SELECT role_id, 'dashboard.contract_quantity_by_plant', can_contracts::boolean FROM old_flags
  UNION ALL SELECT role_id, 'dashboard.top_suppliers', can_top_performers::boolean FROM old_flags
  UNION ALL SELECT role_id, 'dashboard.top_trucking_owners', can_top_performers::boolean FROM old_flags
  UNION ALL SELECT role_id, 'dashboard.top_vessels', can_top_performers::boolean FROM old_flags
),
to_insert AS (
  SELECT
    d.role_id,
    p.id AS permission_id,
    d.can_view
  FROM desired d
  JOIN permissions p ON p.permission_key = d.permission_key
  WHERE d.can_view = true
)
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT role_id, permission_id, true, false, false, false
FROM to_insert
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS tmp_old_dashboard_widget_flags;

