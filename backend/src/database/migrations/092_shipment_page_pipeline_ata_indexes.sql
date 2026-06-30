-- Shipments page pipeline: partial indexes on milestone columns used for stage aggregation filters.

CREATE INDEX IF NOT EXISTS idx_shipments_ata_sailed_not_null
  ON shipments (ata_sailed)
  WHERE ata_sailed IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_ata_discharge_arrival_not_null
  ON shipments (ata_discharge_arrival)
  WHERE ata_discharge_arrival IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_eta_arrival_not_null
  ON shipments (eta_arrival)
  WHERE eta_arrival IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_open_sea_mix_contract_date
  ON contracts (contract_date DESC, contract_id)
  WHERE UPPER(COALESCE(NULLIF(TRIM(transport_mode), ''), 'SEA')) IN ('SEA', 'MIX');
