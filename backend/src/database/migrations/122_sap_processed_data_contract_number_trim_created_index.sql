-- Shipping Performance / Shipments: latest-SAP-row-per-contract fallback lookups match
-- on TRIM(contract_number) and take the newest created_at. This composite expression
-- index serves that as a single ordered index probe (equality on the trimmed key,
-- newest-first within it) instead of scanning all SAP rows per outer row.
-- Access-path only; query output verified byte-identical.
CREATE INDEX IF NOT EXISTS idx_spd_contract_number_trim_created
  ON sap_processed_data (TRIM(contract_number), created_at DESC NULLS LAST);

ANALYZE sap_processed_data;
