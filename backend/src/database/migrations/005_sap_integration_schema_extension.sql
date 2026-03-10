-- SAP Integration Schema Extension
-- Migration: 005_sap_integration_schema_extension.sql
-- Purpose: Extend schema to support all SAP MASTER v2 fields

-- =====================================================
-- 1. EXTEND CONTRACTS TABLE
-- =====================================================
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS group_name VARCHAR(100);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS po_number VARCHAR(100);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS sto_number VARCHAR(100);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS sto_quantity DECIMAL(15,2);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS unit_price DECIMAL(15,2);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS source_type VARCHAR(50); -- '3rd Party' or 'Inhouse'
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_type VARCHAR(20); -- 'LTC' or 'Spot'
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS transport_mode VARCHAR(20); -- 'Sea' or 'Land'
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS logistics_classification VARCHAR(100);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS po_classification VARCHAR(50); -- 'Single' or 'Multiple'

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_contracts_po_number ON contracts(po_number);
CREATE INDEX IF NOT EXISTS idx_contracts_sto_number ON contracts(sto_number);
CREATE INDEX IF NOT EXISTS idx_contracts_group_name ON contracts(group_name);

-- =====================================================
-- 2. EXTEND SHIPMENTS TABLE
-- =====================================================

-- Vessel Information
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS voyage_no VARCHAR(100);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS vessel_code VARCHAR(50);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS vessel_owner VARCHAR(255);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS vessel_draft DECIMAL(10,2);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS vessel_loa DECIMAL(10,2);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS vessel_capacity DECIMAL(15,2);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS vessel_hull_type VARCHAR(50);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS vessel_registration_year INT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS charter_type VARCHAR(20); -- 'VC', 'TC', 'Mix'
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS loading_method VARCHAR(50);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS discharge_method VARCHAR(50);

-- Trucking Information
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS trucking_owner VARCHAR(255);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS trucking_start_date DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS trucking_completion_date DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS quantity_trucked DECIMAL(15,2);

-- Vessel Milestone Dates - Loading Port
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS eta_arrival DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ata_arrival DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS eta_berthed DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ata_berthed DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS eta_loading_start DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ata_loading_start DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS eta_loading_complete DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ata_loading_complete DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS eta_sailed DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ata_sailed DATE;

-- Vessel Milestone Dates - Discharge Port
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS eta_discharge_arrival DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ata_discharge_arrival DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS eta_discharge_berthed DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ata_discharge_berthed DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS eta_discharge_start DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ata_discharge_start DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS eta_discharge_complete DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ata_discharge_complete DATE;

-- Loading/Discharge Rates
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS loading_rate DECIMAL(10,2);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS discharge_rate DECIMAL(10,2);

-- Analysis Fields
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS loading_duration_days INT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS discharge_duration_days INT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS total_lead_time_days INT;

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_shipments_vessel_code ON shipments(vessel_code);
CREATE INDEX IF NOT EXISTS idx_shipments_voyage_no ON shipments(voyage_no);

-- =====================================================
-- 3. EXTEND QUALITY SURVEYS TABLE
-- =====================================================

-- Additional Quality Parameters
ALTER TABLE quality_surveys ADD COLUMN IF NOT EXISTS dobi DECIMAL(10,4);
ALTER TABLE quality_surveys ADD COLUMN IF NOT EXISTS color_red DECIMAL(10,4);
ALTER TABLE quality_surveys ADD COLUMN IF NOT EXISTS dirt_sand DECIMAL(10,4);
ALTER TABLE quality_surveys ADD COLUMN IF NOT EXISTS stone DECIMAL(10,4);
ALTER TABLE quality_surveys ADD COLUMN IF NOT EXISTS location VARCHAR(100); -- 'Loading Port 1', 'Loading Port 2', 'Loading Port 3', 'Discharge Port'
ALTER TABLE quality_surveys ADD COLUMN IF NOT EXISTS surveyor_charges DECIMAL(15,2);

-- Add index
CREATE INDEX IF NOT EXISTS idx_quality_surveys_location ON quality_surveys(location);

-- =====================================================
-- 4. EXTEND PAYMENTS TABLE
-- =====================================================

ALTER TABLE payments ADD COLUMN IF NOT EXISTS dp_date DATE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payoff_date DATE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_deviation_days INT;

-- =====================================================
-- 5. NEW TABLE: VESSEL MASTER DATA
-- =====================================================

CREATE TABLE IF NOT EXISTS vessel_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_code VARCHAR(50) UNIQUE NOT NULL,
    vessel_name VARCHAR(255) NOT NULL,
    vessel_owner VARCHAR(255),
    vessel_draft DECIMAL(10,2),
    vessel_loa DECIMAL(10,2),
    vessel_capacity DECIMAL(15,2),
    vessel_hull_type VARCHAR(50),
    registration_year INT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_vessel_master_code ON vessel_master(vessel_code);
CREATE INDEX IF NOT EXISTS idx_vessel_master_name ON vessel_master(vessel_name);

-- Add trigger
DROP TRIGGER IF EXISTS update_vessel_master_updated_at ON vessel_master;
CREATE TRIGGER update_vessel_master_updated_at BEFORE UPDATE ON vessel_master
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 6. NEW TABLE: TRUCKING OPERATIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS trucking_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
    contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
    location_sequence INT, -- 1, 2, or 3 (for multiple trucking locations)
    cargo_readiness_date DATE,
    loading_location VARCHAR(255),
    unloading_location VARCHAR(255),
    trucking_owner VARCHAR(255),
    oa_budget DECIMAL(15,2),
    oa_actual DECIMAL(15,2),
    quantity_sent DECIMAL(15,2),
    quantity_delivered DECIMAL(15,2),
    gain_loss DECIMAL(15,2),
    trucking_start_date DATE,
    trucking_completion_date DATE,
    completion_rate_days INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_trucking_shipment_id ON trucking_operations(shipment_id);
CREATE INDEX IF NOT EXISTS idx_trucking_contract_id ON trucking_operations(contract_id);

-- Add trigger
DROP TRIGGER IF EXISTS update_trucking_operations_updated_at ON trucking_operations;
CREATE TRIGGER update_trucking_operations_updated_at BEFORE UPDATE ON trucking_operations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 7. NEW TABLE: SURVEYORS
-- =====================================================

CREATE TABLE IF NOT EXISTS surveyors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
    surveyor_number INT, -- 1, 2, 3, 4 (multiple surveyors per shipment)
    vendor_name VARCHAR(255),
    charges DECIMAL(15,2),
    location VARCHAR(100),
    survey_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_surveyors_shipment_id ON surveyors(shipment_id);

-- Add trigger
DROP TRIGGER IF EXISTS update_surveyors_updated_at ON surveyors;
CREATE TRIGGER update_surveyors_updated_at BEFORE UPDATE ON surveyors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 8. NEW TABLE: LOADING PORTS (For multi-port loading)
-- =====================================================

CREATE TABLE IF NOT EXISTS loading_ports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
    port_number INT, -- 1, 2, or 3
    port_name VARCHAR(255),
    incoterm VARCHAR(50),
    cargo_readiness_date DATE,
    loading_method VARCHAR(50),
    quantity DECIMAL(15,2),
    eta_arrival DATE,
    ata_arrival DATE,
    eta_berthed DATE,
    ata_berthed DATE,
    eta_loading_start DATE,
    ata_loading_start DATE,
    eta_loading_complete DATE,
    ata_loading_complete DATE,
    eta_sailed DATE,
    ata_sailed DATE,
    loading_rate DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_loading_ports_shipment_id ON loading_ports(shipment_id);

-- Add trigger
DROP TRIGGER IF EXISTS update_loading_ports_updated_at ON loading_ports;
CREATE TRIGGER update_loading_ports_updated_at BEFORE UPDATE ON loading_ports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 9. UPDATE SAP_PROCESSED_DATA TABLE
-- =====================================================

-- Add more specific fields to sap_processed_data for better indexing
ALTER TABLE sap_processed_data ADD COLUMN IF NOT EXISTS group_name VARCHAR(100);
ALTER TABLE sap_processed_data ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(255);
ALTER TABLE sap_processed_data ADD COLUMN IF NOT EXISTS product VARCHAR(255);
ALTER TABLE sap_processed_data ADD COLUMN IF NOT EXISTS po_number VARCHAR(100);
ALTER TABLE sap_processed_data ADD COLUMN IF NOT EXISTS sto_number VARCHAR(100);
ALTER TABLE sap_processed_data ADD COLUMN IF NOT EXISTS vessel_name VARCHAR(255);
ALTER TABLE sap_processed_data ADD COLUMN IF NOT EXISTS incoterm VARCHAR(50);
ALTER TABLE sap_processed_data ADD COLUMN IF NOT EXISTS transport_mode VARCHAR(20);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_sap_processed_po_number ON sap_processed_data(po_number);
CREATE INDEX IF NOT EXISTS idx_sap_processed_sto_number ON sap_processed_data(sto_number);
CREATE INDEX IF NOT EXISTS idx_sap_processed_supplier ON sap_processed_data(supplier_name);

-- =====================================================
-- 10. COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON TABLE vessel_master IS 'Master data for vessels - referenced by shipments';
COMMENT ON TABLE trucking_operations IS 'Detailed trucking operations - supports multiple trucking legs per shipment';
COMMENT ON TABLE surveyors IS 'Surveyor information and charges - supports multiple surveyors per shipment';
COMMENT ON TABLE loading_ports IS 'Multi-port loading support - handles shipments loading from up to 3 ports';

COMMENT ON COLUMN shipments.charter_type IS 'Vessel charter type: VC (Voyage Charter), TC (Time Charter), or Mix';
COMMENT ON COLUMN shipments.loading_method IS 'Loading method: Pipeline or Trucking';
COMMENT ON COLUMN contracts.transport_mode IS 'Transport mode: Sea or Land';
COMMENT ON COLUMN quality_surveys.location IS 'Quality survey location: Loading Port 1/2/3 or Discharge Port';

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

-- Log migration
INSERT INTO sap_data_imports (import_date, status, total_records, processed_records, failed_records, error_log)
VALUES (CURRENT_DATE, 'completed', 0, 0, 0, 'Schema extension migration 005 completed successfully')
ON CONFLICT DO NOTHING;

