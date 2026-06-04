-- Performance hot-path indexes (page load <2s target)
-- Focus: dashboard aggregates, contracts list, shipments list, trucking list, claim pages

-- sap_processed_data is used heavily for latest-per-contract and STO-based aggregates
CREATE INDEX IF NOT EXISTS idx_spd_contract_created_at_desc
  ON sap_processed_data (contract_number, created_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_spd_sto_number
  ON sap_processed_data (sto_number);

-- Partial index for rows that carry STO quantity (common aggregation filter)
CREATE INDEX IF NOT EXISTS idx_spd_contract_sto_qty_present
  ON sap_processed_data (contract_number)
  WHERE (data->'contract'->>'sto_quantity') IS NOT NULL;

-- Shipments: list + dashboard counts commonly filter/join by contract_id and sort by created_at
CREATE INDEX IF NOT EXISTS idx_shipments_contract_id_created_at_desc
  ON shipments (contract_id, created_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_shipments_created_at_desc
  ON shipments (created_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_shipments_status
  ON shipments (status);

-- Trucking: list + dashboard counts commonly filter/join by contract_id and sort by created_at
CREATE INDEX IF NOT EXISTS idx_trucking_contract_id_created_at_desc
  ON trucking_operations (contract_id, created_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_trucking_created_at_desc
  ON trucking_operations (created_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_trucking_status
  ON trucking_operations (status);

-- Documents are counted per contract/shipment/trucking
CREATE INDEX IF NOT EXISTS idx_documents_contract_id
  ON documents (contract_id);

CREATE INDEX IF NOT EXISTS idx_documents_shipment_id
  ON documents (shipment_id);

CREATE INDEX IF NOT EXISTS idx_documents_trucking_operation_id
  ON documents (trucking_operation_id);

-- Claim pages: server-side paging/sort by import_id + os_days
CREATE INDEX IF NOT EXISTS idx_claim_mutu_rows_import_os_days
  ON claim_mutu_rows (import_id, os_days DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_claim_susut_rows_import_os_days
  ON claim_susut_rows (import_id, os_days DESC NULLS LAST);

