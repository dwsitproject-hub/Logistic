-- Migration 060: Create contract_stos table for multiple STO per contract
--
-- Previously, contracts table had only one sto_number + sto_quantity column.
-- A single contract (PO) can have multiple STOs in SAP. This table stores
-- each STO as a separate row linked to its parent contract.

CREATE TABLE IF NOT EXISTS contract_stos (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id      UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  sto_number       VARCHAR(100) NOT NULL,
  sto_quantity     NUMERIC(15,2),
  sto_type         VARCHAR(50),
  sto_item         VARCHAR(50),
  sto_classification VARCHAR(100),
  plant_code       VARCHAR(50),
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(contract_id, sto_number)
);

CREATE INDEX IF NOT EXISTS idx_contract_stos_contract_id ON contract_stos(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_stos_sto_number ON contract_stos(sto_number);

-- Backfill from existing contracts that already have sto_number
INSERT INTO contract_stos (contract_id, sto_number, sto_quantity, plant_code)
SELECT id, sto_number, sto_quantity, plant_code
FROM contracts
WHERE sto_number IS NOT NULL AND sto_number != ''
ON CONFLICT (contract_id, sto_number) DO NOTHING;

-- Trigger to keep updated_at current
CREATE TRIGGER update_contract_stos_updated_at
  BEFORE UPDATE ON contract_stos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
