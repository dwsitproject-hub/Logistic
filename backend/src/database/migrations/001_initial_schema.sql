-- Migration 001: Initial KLIP schema
-- Purpose: Create base tables + RBAC tables + core domain tables

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT', 'SUPPORT')),
    is_active BOOLEAN DEFAULT true,
    is_first_login BOOLEAN DEFAULT true,
    last_password_change TIMESTAMP,
    phone VARCHAR(50),
    department VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_name VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Permissions table
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    permission_key VARCHAR(100) UNIQUE NOT NULL,
    permission_name VARCHAR(100) NOT NULL,
    description TEXT,
    category VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Role permissions junction table
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

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_permissions_category ON permissions(category);

-- Seed default roles
INSERT INTO roles (role_name, display_name, description) VALUES
('ADMIN', 'Administrator', 'Full system access with all permissions'),
('TRADING', 'Trading', 'Access to contracts, gain/loss, and trading operations'),
('LOGISTICS', 'Logistics', 'Access to shipments, SLA monitoring, and logistics operations'),
('FINANCE', 'Finance', 'Access to payments, invoices, and financial reports'),
('MANAGEMENT', 'Management', 'Access to dashboards, insights, and high-level reports'),
('SUPPORT', 'Support', 'Access to data validation, audit logs, and support functions')
ON CONFLICT (role_name) DO NOTHING;

-- Seed default permissions
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
('data.contracts', 'Contract Data', 'Access to contract data', 'data'),
('data.shipments', 'Shipment Data', 'Access to shipment data', 'data'),
('data.trucking', 'Trucking Data', 'Access to trucking data', 'data'),
('data.finance', 'Financial Data', 'Access to financial data', 'data'),
('data.documents', 'Document Data', 'Access to document data', 'data'),
('data.users', 'User Data', 'Access to user data', 'data'),
('data.audit', 'Audit Data', 'Access to audit logs', 'data'),
('dashboard.contracts_overview', 'Contracts Overview Widget', 'View contracts statistics', 'dashboard'),
('dashboard.shipments_overview', 'Shipments Overview Widget', 'View shipments statistics', 'dashboard'),
('dashboard.finance_overview', 'Finance Overview Widget', 'View financial statistics', 'dashboard'),
('dashboard.alerts', 'Alerts Widget', 'View system alerts', 'dashboard'),
('dashboard.top_performers', 'Top Performers Widget', 'View top performers data', 'dashboard'),
('action.import_excel', 'Import Excel', 'Import data from Excel files', 'action'),
('action.export_data', 'Export Data', 'Export data to Excel/PDF', 'action'),
('action.bulk_operations', 'Bulk Operations', 'Perform bulk operations', 'action')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant permissions to roles
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, true, true, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'ADMIN'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT
  r.id,
  p.id,
  CASE WHEN p.permission_key IN ('page.dashboard', 'page.contracts', 'page.documents', 'dashboard.contracts_overview', 'dashboard.alerts', 'dashboard.top_performers') THEN true ELSE false END,
  CASE WHEN p.permission_key IN ('data.contracts', 'data.documents', 'action.import_excel', 'action.export_data', 'action.bulk_operations') THEN true ELSE false END,
  CASE WHEN p.permission_key IN ('data.contracts', 'data.documents') THEN true ELSE false END,
  false
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'TRADING'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT
  r.id,
  p.id,
  CASE WHEN p.permission_key IN ('page.dashboard', 'page.shipments', 'page.trucking', 'page.documents', 'dashboard.contracts_overview', 'dashboard.shipments_overview', 'dashboard.alerts', 'dashboard.top_performers') THEN true ELSE false END,
  CASE WHEN p.permission_key IN ('data.shipments', 'data.trucking', 'data.documents', 'action.import_excel', 'action.export_data') THEN true ELSE false END,
  CASE WHEN p.permission_key IN ('data.shipments', 'data.trucking', 'data.documents') THEN true ELSE false END,
  false
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'LOGISTICS'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT
  r.id,
  p.id,
  CASE WHEN p.permission_key IN ('page.dashboard', 'page.finance', 'page.documents', 'dashboard.contracts_overview', 'dashboard.finance_overview', 'dashboard.alerts', 'dashboard.top_performers') THEN true ELSE false END,
  CASE WHEN p.permission_key IN ('data.finance', 'data.documents', 'action.import_excel', 'action.export_data') THEN true ELSE false END,
  CASE WHEN p.permission_key IN ('data.finance', 'data.documents') THEN true ELSE false END,
  false
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'FINANCE'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT
  r.id,
  p.id,
  CASE WHEN p.category IN ('page', 'data', 'dashboard') THEN true ELSE false END,
  false,
  false,
  false
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'MANAGEMENT'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT
  r.id,
  p.id,
  CASE WHEN p.permission_key IN ('page.dashboard', 'page.audit', 'page.documents', 'dashboard.alerts', 'dashboard.top_performers') THEN true ELSE false END,
  CASE WHEN p.permission_key IN ('data.audit') THEN true ELSE false END,
  false,
  false
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'SUPPORT'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Trigger to keep roles.updated_at current
CREATE OR REPLACE FUNCTION update_roles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS roles_updated_at_trigger ON roles;
CREATE TRIGGER roles_updated_at_trigger
BEFORE UPDATE ON roles
FOR EACH ROW
EXECUTE FUNCTION update_roles_updated_at();

-- Contracts table
CREATE TABLE contracts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_id VARCHAR(100) UNIQUE NOT NULL,
    buyer VARCHAR(255) NOT NULL,
    supplier VARCHAR(255) NOT NULL,
    product VARCHAR(255) NOT NULL,
    quantity_ordered DECIMAL(15, 2) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    incoterm VARCHAR(50),
    loading_site VARCHAR(255),
    unloading_site VARCHAR(255),
    contract_date DATE,
    delivery_start_date DATE,
    delivery_end_date DATE,
    contract_value DECIMAL(15, 2),
    currency VARCHAR(10) DEFAULT 'USD',
    status VARCHAR(50) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
    sap_contract_id VARCHAR(100),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Shipments table
CREATE TABLE shipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id VARCHAR(100) UNIQUE NOT NULL,
    contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
    vessel_name VARCHAR(255),
    shipment_date DATE,
    arrival_date DATE,
    port_of_loading VARCHAR(255),
    port_of_discharge VARCHAR(255),
    quantity_shipped DECIMAL(15, 2),
    quantity_delivered DECIMAL(15, 2),
    inbound_weight DECIMAL(15, 2),
    outbound_weight DECIMAL(15, 2),
    gain_loss_percentage DECIMAL(5, 2),
    gain_loss_amount DECIMAL(15, 2),
    status VARCHAR(50) DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'IN_TRANSIT', 'ARRIVED', 'UNLOADING', 'COMPLETED', 'CANCELLED')),
    sla_days INT,
    is_delayed BOOLEAN DEFAULT false,
    sap_delivery_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Suppliers table (Customer 360)
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_code VARCHAR(100) NOT NULL,
    mills VARCHAR(255),
    group_id VARCHAR(100),
    parent_company VARCHAR(255),
    group_holding VARCHAR(255),
    controlling_shareholder VARCHAR(255),
    other_shareholders VARCHAR(500),
    group_type VARCHAR(100),
    group_scale VARCHAR(100),
    integrated_status VARCHAR(100),
    cap VARCHAR(100),
    -- Deprecated single estimates retained for backward compatibility
    cpo_prod_est DECIMAL(15,2),
    pk_prod_est DECIMAL(15,2),
    pome_prod_est DECIMAL(15,2),
    shell_prod_est DECIMAL(15,2),
    -- New monthly and yearly estimates
    cpo_prod_est_month DECIMAL(15,2),
    pk_prod_est_month DECIMAL(15,2),
    pome_prod_est_month DECIMAL(15,2),
    shell_prod_est_month DECIMAL(15,2),
    cpo_prod_est_year DECIMAL(15,2),
    pk_prod_est_year DECIMAL(15,2),
    pome_prod_est_year DECIMAL(15,2),
    shell_prod_est_year DECIMAL(15,2),
    city_regency VARCHAR(255),
    province VARCHAR(255),
    island VARCHAR(255),
    longitude DECIMAL(10,6),
    latitude DECIMAL(10,6),
    kml_folder VARCHAR(255),
    map VARCHAR(255),
    rspo VARCHAR(100),
    rspo_type VARCHAR(100),
    ispo VARCHAR(100),
    iscc VARCHAR(100),
    year_commence INTEGER,
    updated_date DATE,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_suppliers_plant_code UNIQUE (plant_code)
);

-- Helpful indexes for suppliers
CREATE INDEX IF NOT EXISTS idx_suppliers_group_id ON suppliers(group_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_parent_company ON suppliers(parent_company);
CREATE INDEX IF NOT EXISTS idx_suppliers_province ON suppliers(province);
CREATE INDEX IF NOT EXISTS idx_suppliers_city ON suppliers(city_regency);

-- Products (Master Product Configuration)
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_name VARCHAR(255) NOT NULL UNIQUE,
    percent_produce DECIMAL(7,4),
    working_hours_per_day INTEGER,
    working_days_per_month INTEGER,
    working_days_per_year INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_name ON products(product_name);

-- Quality/Survey table
CREATE TABLE quality_surveys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
    coa_number VARCHAR(100),
    survey_date DATE,
    surveyor VARCHAR(255),
    density DECIMAL(10, 4),
    ffa DECIMAL(10, 4),
    moisture DECIMAL(10, 4),
    impurity DECIMAL(10, 4),
    iv DECIMAL(10, 4),
    remarks TEXT,
    status VARCHAR(50) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payment/Finance table
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
    invoice_number VARCHAR(100),
    invoice_date DATE,
    payment_amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    payment_due_date DATE,
    payment_date DATE,
    payment_status VARCHAR(50) DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE')),
    payment_method VARCHAR(100),
    bank_reference VARCHAR(255),
    sap_invoice_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Documents table
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_type VARCHAR(50) NOT NULL CHECK (document_type IN ('BOL', 'INVOICE', 'SURVEY', 'COA', 'PAYMENT_PROOF', 'OTHER')),
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT,
    mime_type VARCHAR(100),
    contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
    shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
    payment_id UUID REFERENCES payments(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES users(id),
    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);

-- Remarks/Comments table
CREATE TABLE remarks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    text TEXT NOT NULL,
    category VARCHAR(50),
    related_entity_type VARCHAR(50) CHECK (related_entity_type IN ('CONTRACT', 'SHIPMENT', 'PAYMENT', 'QUALITY')),
    related_entity_id UUID NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit Log table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    before_data JSONB,
    after_data JSONB,
    ip_address VARCHAR(50),
    user_agent TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AI Insights table
CREATE TABLE ai_insights (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    insight_type VARCHAR(50) NOT NULL CHECK (insight_type IN ('SLA_RISK', 'GAIN_LOSS', 'QUALITY_ALERT', 'PAYMENT_ALERT', 'RECOMMENDATION')),
    severity VARCHAR(20) DEFAULT 'LOW' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    recommendation TEXT,
    related_entity_type VARCHAR(50),
    related_entity_id UUID,
    status VARCHAR(50) DEFAULT 'NEW' CHECK (status IN ('NEW', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMP
);

-- Alerts table
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    severity VARCHAR(20) DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
    target_role VARCHAR(50)[],
    is_read BOOLEAN DEFAULT false,
    related_entity_type VARCHAR(50),
    related_entity_id UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_contracts_contract_id ON contracts(contract_id);
CREATE INDEX idx_contracts_status ON contracts(status);
CREATE INDEX idx_shipments_contract_id ON shipments(contract_id);
CREATE INDEX idx_shipments_status ON shipments(status);
CREATE INDEX idx_payments_contract_id ON payments(contract_id);
CREATE INDEX idx_payments_status ON payments(payment_status);
CREATE INDEX idx_documents_contract_id ON documents(contract_id);
CREATE INDEX idx_documents_shipment_id ON documents(shipment_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_ai_insights_status ON ai_insights(status);
CREATE INDEX idx_alerts_target_role ON alerts USING GIN(target_role);

-- Create update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update timestamp triggers
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contracts_updated_at ON contracts;
CREATE TRIGGER update_contracts_updated_at BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_shipments_updated_at ON shipments;
CREATE TRIGGER update_shipments_updated_at BEFORE UPDATE ON shipments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_quality_surveys_updated_at ON quality_surveys;
CREATE TRIGGER update_quality_surveys_updated_at BEFORE UPDATE ON quality_surveys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_remarks_updated_at ON remarks;
CREATE TRIGGER update_remarks_updated_at BEFORE UPDATE ON remarks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();



