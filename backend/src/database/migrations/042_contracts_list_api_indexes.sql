-- Support scalable contracts list: sort, date filters, payment fallbacks, STO aggregation scans

CREATE INDEX IF NOT EXISTS idx_contracts_created_at_desc ON contracts (created_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_contracts_contract_date ON contracts (contract_date);

CREATE INDEX IF NOT EXISTS idx_payments_contract_id_created_at_desc
  ON payments (contract_id, created_at DESC NULLS LAST);

-- Narrower scans for sto_agg-style rows (many rows per contract over time)
CREATE INDEX IF NOT EXISTS idx_sap_processed_data_contract_has_sto
  ON sap_processed_data (contract_number)
  WHERE sto_number IS NOT NULL AND TRIM(sto_number::text) != '';
