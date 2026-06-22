-- Migration 086: AI Shipment Planner pattern cache tables (vessel + ETA)

CREATE TABLE IF NOT EXISTS vessel_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id VARCHAR(255) NOT NULL,
  buyer_id VARCHAR(255) NOT NULL,
  product_id VARCHAR(255) NOT NULL,
  incoterm VARCHAR(50) NOT NULL DEFAULT '',
  suggested_vessel_name VARCHAR(255) NOT NULL,
  suggested_charter_type VARCHAR(50),
  suggested_discharge_port VARCHAR(255),
  source VARCHAR(32) NOT NULL CHECK (source IN ('SAP_HISTORICAL', 'CLAUDE_AI')),
  last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_vessel_patterns_dims UNIQUE (supplier_id, buyer_id, product_id, incoterm)
);

CREATE INDEX IF NOT EXISTS idx_vessel_patterns_dims
  ON vessel_patterns (supplier_id, buyer_id, product_id, incoterm);

CREATE TABLE IF NOT EXISTS eta_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vessel_name VARCHAR(255) NOT NULL,
  loading_port VARCHAR(255) NOT NULL,
  discharge_port VARCHAR(255) NOT NULL,
  avg_transit_days NUMERIC(8, 2) NOT NULL,
  source VARCHAR(32) NOT NULL CHECK (source IN ('SAP_HISTORICAL', 'CLAUDE_AI')),
  last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_eta_patterns_route UNIQUE (vessel_name, loading_port, discharge_port)
);

CREATE INDEX IF NOT EXISTS idx_eta_patterns_route
  ON eta_patterns (vessel_name, loading_port, discharge_port);
