-- Fix VARCHAR length issues for SAP data tables
-- Migration: 004_fix_varchar_length.sql

-- Increase status column length in sap_data_imports
ALTER TABLE sap_data_imports 
ALTER COLUMN status TYPE VARCHAR(50);

-- Increase status column length in sap_raw_data  
ALTER TABLE sap_raw_data
ALTER COLUMN status TYPE VARCHAR(50);

-- Increase status column length in sap_processed_data
ALTER TABLE sap_processed_data
ALTER COLUMN status TYPE VARCHAR(100);

-- Increase priority column length in sap_processed_data
ALTER TABLE sap_processed_data
ALTER COLUMN priority TYPE VARCHAR(50);

-- Increase status column length in user_data_inputs
ALTER TABLE user_data_inputs
ALTER COLUMN status TYPE VARCHAR(50);

-- Add comment for documentation
COMMENT ON COLUMN sap_data_imports.status IS 'Import status: pending, processing, completed, failed, completed_with_errors';
COMMENT ON COLUMN sap_raw_data.status IS 'Processing status: pending, processed, error';
COMMENT ON COLUMN sap_processed_data.status IS 'Data status from Excel file';
COMMENT ON COLUMN sap_processed_data.priority IS 'Priority level from Excel file';
COMMENT ON COLUMN user_data_inputs.status IS 'Input status: pending, approved, rejected';

