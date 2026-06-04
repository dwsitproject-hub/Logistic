-- Add plant_code column to contracts table
-- Migration: 056_add_plant_code_to_contracts.sql
-- Purpose: Store the SAP Plant Code from the "Plant Code" column in the uploaded CSV

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS plant_code VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_contracts_plant_code ON contracts(plant_code);
