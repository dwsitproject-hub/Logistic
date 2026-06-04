-- Ensure trucking_operations table exists (for fresh databases)
-- This mirrors the definition in 005_sap_integration_schema_extension.sql
-- so that this migration can run safely even before 005.
CREATE TABLE IF NOT EXISTS trucking_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
    contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
    location_sequence INT,
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

-- Add trucking_operation_id to documents table
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS trucking_operation_id UUID REFERENCES trucking_operations(id) ON DELETE CASCADE;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_documents_trucking_operation ON documents(trucking_operation_id);

