-- STO qty assigned to contracts per PO (used in outstanding qty on GET /contracts).
CREATE TABLE IF NOT EXISTS user_sto_contract_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sto_number VARCHAR(255) NOT NULL,
  contract_number VARCHAR(255) NOT NULL,
  sto_qty_assigned NUMERIC(15, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (sto_number, contract_number)
);

ALTER TABLE user_sto_contract_assignments
  ADD COLUMN IF NOT EXISTS po_number VARCHAR(255);

ALTER TABLE user_sto_contract_assignments
  DROP CONSTRAINT IF EXISTS user_sto_contract_assignments_sto_number_contract_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS user_sto_contract_assignments_sto_contract_po_key
  ON user_sto_contract_assignments (sto_number, contract_number, COALESCE(po_number, ''));
