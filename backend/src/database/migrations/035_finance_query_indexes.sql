-- Finance query performance indexes
-- Safe to re-run.

-- Helps pick latest SAP row per contract quickly
CREATE INDEX IF NOT EXISTS idx_sap_processed_data_contract_created_at
  ON sap_processed_data (contract_number, created_at DESC);

-- Helps common sort patterns
CREATE INDEX IF NOT EXISTS idx_payments_due_date
  ON payments (payment_due_date);

CREATE INDEX IF NOT EXISTS idx_payments_created_at
  ON payments (created_at DESC);

