-- Migration 006: User Management Enhancement
-- Adds role permissions, first-time login tracking, and enhanced user management

-- Add columns to users table for first-time login tracking
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS is_first_login BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS last_password_change TIMESTAMP,
ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS department VARCHAR(100);

-- Create roles table for dynamic role management
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_name VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create permissions table for granular access control
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    permission_key VARCHAR(100) UNIQUE NOT NULL,
    permission_name VARCHAR(100) NOT NULL,
    description TEXT,
    category VARCHAR(50), -- 'page', 'data', 'action'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create role_permissions junction table
CREATE TABLE IF NOT EXISTS role_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    can_view BOOLEAN DEFAULT false,
    can_create BOOLEAN DEFAULT false,
    can_edit BOOLEAN DEFAULT false,
    can_delete BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(role_id, permission_id)
);

-- Insert default roles
INSERT INTO roles (role_name, display_name, description) VALUES
('ADMIN', 'Administrator', 'Full system access with all permissions'),
('TRADING', 'Trading', 'Access to contracts, gain/loss, and trading operations'),
('LOGISTICS', 'Logistics', 'Access to shipments, SLA monitoring, and logistics operations'),
('FINANCE', 'Finance', 'Access to payments, invoices, and financial reports'),
('MANAGEMENT', 'Management', 'Access to dashboards, insights, and high-level reports'),
('SUPPORT', 'Support', 'Access to data validation, audit logs, and support functions')
ON CONFLICT (role_name) DO NOTHING;

-- Insert default permissions
-- Page Access Permissions
INSERT INTO permissions (permission_key, permission_name, description, category) VALUES
('page.dashboard', 'Dashboard Access', 'Access to dashboard page', 'page'),
('page.contracts', 'Contracts Access', 'Access to contracts page', 'page'),
('page.shipments', 'Shipments Access', 'Access to shipments page', 'page'),
('page.trucking', 'Trucking Access', 'Access to trucking operations page', 'page'),
('page.finance', 'Finance Access', 'Access to finance page', 'page'),
('page.documents', 'Documents Access', 'Access to documents page', 'page'),
('page.users', 'Users Access', 'Access to user management page', 'page'),
('page.audit', 'Audit Logs Access', 'Access to audit logs page', 'page'),
('page.sap', 'SAP Integration Access', 'Access to SAP integration features', 'page'),

-- Data Access Permissions
('data.contracts', 'Contract Data', 'Access to contract data', 'data'),
('data.shipments', 'Shipment Data', 'Access to shipment data', 'data'),
('data.trucking', 'Trucking Data', 'Access to trucking data', 'data'),
('data.finance', 'Financial Data', 'Access to financial data', 'data'),
('data.documents', 'Document Data', 'Access to document data', 'data'),
('data.users', 'User Data', 'Access to user data', 'data'),
('data.audit', 'Audit Data', 'Access to audit logs', 'data'),

-- Dashboard Widget Permissions
('dashboard.contracts_overview', 'Contracts Overview Widget', 'View contracts statistics', 'dashboard'),
('dashboard.shipments_overview', 'Shipments Overview Widget', 'View shipments statistics', 'dashboard'),
('dashboard.finance_overview', 'Finance Overview Widget', 'View financial statistics', 'dashboard'),
('dashboard.alerts', 'Alerts Widget', 'View system alerts', 'dashboard'),
('dashboard.top_performers', 'Top Performers Widget', 'View top performers data', 'dashboard'),

-- Action Permissions
('action.import_excel', 'Import Excel', 'Import data from Excel files', 'action'),
('action.export_data', 'Export Data', 'Export data to Excel/PDF', 'action'),
('action.bulk_operations', 'Bulk Operations', 'Perform bulk operations', 'action')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant ADMIN role all permissions
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, true, true, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'ADMIN'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Grant TRADING role permissions
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, 
    CASE WHEN p.permission_key IN ('page.dashboard', 'page.contracts', 'page.documents') THEN true ELSE false END,
    CASE WHEN p.permission_key IN ('data.contracts', 'data.documents') THEN true ELSE false END,
    CASE WHEN p.permission_key IN ('data.contracts', 'data.documents') THEN true ELSE false END,
    false
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'TRADING'
AND (p.category = 'page' OR p.category = 'data' OR p.permission_key LIKE 'dashboard.%')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Grant LOGISTICS role permissions
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id,
    CASE WHEN p.permission_key IN ('page.dashboard', 'page.shipments', 'page.trucking', 'page.documents') THEN true ELSE false END,
    CASE WHEN p.permission_key IN ('data.shipments', 'data.trucking', 'data.documents') THEN true ELSE false END,
    CASE WHEN p.permission_key IN ('data.shipments', 'data.trucking', 'data.documents') THEN true ELSE false END,
    false
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'LOGISTICS'
AND (p.category = 'page' OR p.category = 'data' OR p.permission_key LIKE 'dashboard.%')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Grant FINANCE role permissions
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id,
    CASE WHEN p.permission_key IN ('page.dashboard', 'page.finance', 'page.documents') THEN true ELSE false END,
    CASE WHEN p.permission_key IN ('data.finance', 'data.documents') THEN true ELSE false END,
    CASE WHEN p.permission_key IN ('data.finance', 'data.documents') THEN true ELSE false END,
    false
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'FINANCE'
AND (p.category = 'page' OR p.category = 'data' OR p.permission_key LIKE 'dashboard.%')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Grant MANAGEMENT role permissions (read-only access to most things)
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, false, false, false
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'MANAGEMENT'
AND p.category IN ('page', 'data', 'dashboard')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Grant SUPPORT role permissions
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id,
    CASE WHEN p.permission_key IN ('page.dashboard', 'page.audit', 'page.documents') THEN true ELSE false END,
    CASE WHEN p.permission_key IN ('data.audit') THEN true ELSE false END,
    false,
    false
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'SUPPORT'
AND (p.category = 'page' OR p.category = 'data')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_permissions_category ON permissions(category);

-- Update trigger for roles table
CREATE OR REPLACE FUNCTION update_roles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure trigger is recreated safely even if it already exists
DROP TRIGGER IF EXISTS roles_updated_at_trigger ON roles;
CREATE TRIGGER roles_updated_at_trigger
BEFORE UPDATE ON roles
FOR EACH ROW
EXECUTE FUNCTION update_roles_updated_at();

