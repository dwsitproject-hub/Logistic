-- Extend pipeline daily summary with product + incoterm dimensions (toolbar scope filters).

ALTER TABLE trucking_pipeline_daily_summary
  ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'Blank',
  ADD COLUMN IF NOT EXISTS incoterm TEXT NOT NULL DEFAULT 'Blank';

ALTER TABLE shipment_pipeline_daily_summary
  ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'Blank',
  ADD COLUMN IF NOT EXISTS incoterm TEXT NOT NULL DEFAULT 'Blank';

ALTER TABLE trucking_pipeline_daily_summary DROP CONSTRAINT IF EXISTS trucking_pipeline_daily_summary_pkey;
ALTER TABLE trucking_pipeline_daily_summary
  ADD PRIMARY KEY (group_plant, contract_date, product, incoterm);

ALTER TABLE shipment_pipeline_daily_summary DROP CONSTRAINT IF EXISTS shipment_pipeline_daily_summary_pkey;
ALTER TABLE shipment_pipeline_daily_summary
  ADD PRIMARY KEY (group_plant, contract_date, product, incoterm);

CREATE INDEX IF NOT EXISTS idx_trucking_pipeline_daily_summary_dims
  ON trucking_pipeline_daily_summary (contract_date, product, incoterm);

CREATE INDEX IF NOT EXISTS idx_shipment_pipeline_daily_summary_dims
  ON shipment_pipeline_daily_summary (contract_date, product, incoterm);

UPDATE pipeline_summary_refresh_meta SET is_stale = TRUE;
