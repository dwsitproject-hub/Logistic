CREATE TABLE IF NOT EXISTS master_plants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name VARCHAR(255) NOT NULL,
  plant_code VARCHAR(50) NOT NULL,
  plant_name VARCHAR(255),
  postal_code VARCHAR(50),
  city VARCHAR(255),
  plant_type VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_master_plants_company_name
  ON master_plants (company_name);

CREATE INDEX IF NOT EXISTS idx_master_plants_plant_code
  ON master_plants (plant_code);

