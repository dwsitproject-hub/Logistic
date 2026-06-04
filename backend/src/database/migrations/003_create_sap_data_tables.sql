-- SAP Data Integration Tables
-- Migration: 003_create_sap_data_tables.sql

-- Main SAP data table for daily imports
CREATE TABLE IF NOT EXISTS sap_data_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_date DATE NOT NULL,
    import_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, completed, failed
    total_records INTEGER DEFAULT 0,
    processed_records INTEGER DEFAULT 0,
    failed_records INTEGER DEFAULT 0,
    error_log TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- SAP raw data table (stores all imported data)
CREATE TABLE IF NOT EXISTS sap_raw_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id UUID REFERENCES sap_data_imports(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    data JSONB NOT NULL, -- Flexible JSON storage for all SAP fields
    status VARCHAR(20) DEFAULT 'pending', -- pending, processed, error
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- SAP field mappings (defines which fields belong to which user roles)
CREATE TABLE IF NOT EXISTS sap_field_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sap_field_name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    field_type VARCHAR(50) NOT NULL, -- text, number, date, boolean
    user_role VARCHAR(50) NOT NULL, -- TRADING, LOGISTICS, FINANCE, etc.
    is_required BOOLEAN DEFAULT false,
    is_editable BOOLEAN DEFAULT true,
    validation_rules JSONB, -- JSON for validation rules
    color_code VARCHAR(7), -- Hex color code for UI
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sap_field_name, user_role)
);

-- Processed SAP data (normalized data after processing)
CREATE TABLE IF NOT EXISTS sap_processed_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id UUID REFERENCES sap_data_imports(id) ON DELETE CASCADE,
    raw_data_id UUID REFERENCES sap_raw_data(id) ON DELETE CASCADE,
    contract_number VARCHAR(100),
    shipment_id VARCHAR(100),
    trader_name VARCHAR(255),
    logistics_team VARCHAR(255),
    estimated_date DATE,
    actual_date DATE,
    status VARCHAR(50),
    priority VARCHAR(20),
    data JSONB NOT NULL, -- All processed fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User data input (for fields not provided by SAP)
CREATE TABLE IF NOT EXISTS user_data_inputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    processed_data_id UUID REFERENCES sap_processed_data(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    field_name VARCHAR(255) NOT NULL,
    field_value TEXT,
    input_type VARCHAR(50) NOT NULL, -- manual, calculated, validated
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    comments TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Data validation rules
CREATE TABLE IF NOT EXISTS data_validation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_name VARCHAR(255) NOT NULL,
    rule_type VARCHAR(50) NOT NULL, -- required, format, range, custom
    rule_config JSONB NOT NULL,
    error_message TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sap_data_imports_date ON sap_data_imports(import_date);
CREATE INDEX IF NOT EXISTS idx_sap_data_imports_status ON sap_data_imports(status);
CREATE INDEX IF NOT EXISTS idx_sap_raw_data_import_id ON sap_raw_data(import_id);
CREATE INDEX IF NOT EXISTS idx_sap_raw_data_status ON sap_raw_data(status);
CREATE INDEX IF NOT EXISTS idx_sap_processed_data_import_id ON sap_processed_data(import_id);
CREATE INDEX IF NOT EXISTS idx_sap_processed_data_contract ON sap_processed_data(contract_number);
CREATE INDEX IF NOT EXISTS idx_user_data_inputs_processed_id ON user_data_inputs(processed_data_id);
CREATE INDEX IF NOT EXISTS idx_user_data_inputs_user_id ON user_data_inputs(user_id);

-- Create updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_sap_data_imports_updated_at ON sap_data_imports;
CREATE TRIGGER update_sap_data_imports_updated_at BEFORE UPDATE ON sap_data_imports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_sap_raw_data_updated_at ON sap_raw_data;
CREATE TRIGGER update_sap_raw_data_updated_at BEFORE UPDATE ON sap_raw_data FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_sap_processed_data_updated_at ON sap_processed_data;
CREATE TRIGGER update_sap_processed_data_updated_at BEFORE UPDATE ON sap_processed_data FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_data_inputs_updated_at ON user_data_inputs;
CREATE TRIGGER update_user_data_inputs_updated_at BEFORE UPDATE ON user_data_inputs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_sap_field_mappings_updated_at ON sap_field_mappings;
CREATE TRIGGER update_sap_field_mappings_updated_at BEFORE UPDATE ON sap_field_mappings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_data_validation_rules_updated_at ON data_validation_rules;
CREATE TRIGGER update_data_validation_rules_updated_at BEFORE UPDATE ON data_validation_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
