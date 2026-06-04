-- Enable trigram search + indexes for fast %term% ILIKE.
-- Target: page load/search < 2 seconds (Shipments/Trucking/Contracts).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Contracts: global search uses supplier/product/buyer/group/po/contract_id and Contract Ext No (from sap_processed_data).
CREATE INDEX IF NOT EXISTS idx_contracts_contract_id_trgm
  ON contracts USING GIN (contract_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_po_number_trgm
  ON contracts USING GIN (po_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_supplier_trgm
  ON contracts USING GIN (supplier gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_product_trgm
  ON contracts USING GIN (product gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_group_name_trgm
  ON contracts USING GIN (group_name gin_trgm_ops);

-- Shipments: shipment_base search hits these.
CREATE INDEX IF NOT EXISTS idx_shipments_shipment_id_trgm
  ON shipments USING GIN (shipment_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_shipments_operation_id_trgm
  ON shipments USING GIN (operation_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_shipments_vessel_name_trgm
  ON shipments USING GIN (vessel_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_shipments_vessel_code_trgm
  ON shipments USING GIN (vessel_code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_shipments_voyage_no_trgm
  ON shipments USING GIN (voyage_no gin_trgm_ops);

-- Trucking: global search hits these.
CREATE INDEX IF NOT EXISTS idx_trucking_operation_id_trgm
  ON trucking_operations USING GIN (operation_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_trucking_loading_location_trgm
  ON trucking_operations USING GIN (loading_location gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_trucking_unloading_location_trgm
  ON trucking_operations USING GIN (unloading_location gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_trucking_owner_trgm
  ON trucking_operations USING GIN (trucking_owner gin_trgm_ops);

-- sap_processed_data: Contract Ext No and quantity fields are searched/aggregated; add a trigram index for Contract Ext No extraction.
-- Note: expression index; Postgres can use it for ILIKE on the same expression.
CREATE INDEX IF NOT EXISTS idx_spd_contract_ext_no_trgm
  ON sap_processed_data USING GIN ((COALESCE(data->'raw'->>'Contract Ext No', data->>'Contract Ext No')) gin_trgm_ops);

