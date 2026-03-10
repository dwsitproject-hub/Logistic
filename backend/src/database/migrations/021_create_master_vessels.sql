CREATE TABLE IF NOT EXISTS master_vessels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vessel_code VARCHAR(50) UNIQUE NOT NULL,
  vessel_name VARCHAR(255) NOT NULL,
  vessel_capacity_mt DECIMAL(15,2),
  vessel_owner VARCHAR(255),
  vessel_owner_group VARCHAR(255),
  hull_type VARCHAR(100),
  year_of_creation INT,
  heating BOOLEAN,
  lambung_type VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_master_vessels_vessel_code
  ON master_vessels (vessel_code);

