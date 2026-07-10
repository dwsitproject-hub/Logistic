CREATE TABLE IF NOT EXISTS supplier_groups (
  group_id             VARCHAR(100) PRIMARY KEY,
  land_bank            NUMERIC(15,2),
  loading_method       VARCHAR(255),
  estimated_loading_rate NUMERIC(15,2),
  pic                  TEXT,
  company_type         VARCHAR(100),
  annual_turnover      NUMERIC(20,2),
  credit_rating        VARCHAR(100),
  credit_limit         NUMERIC(20,2),
  other_assets         TEXT,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
