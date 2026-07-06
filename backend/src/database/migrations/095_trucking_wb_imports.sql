-- WB rekap (weighbridge) import batches + link daily actuals to source import.

CREATE TABLE IF NOT EXISTS trucking_wb_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_filename TEXT NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  sheets_processed JSONB NOT NULL DEFAULT '[]'::jsonb,
  sheets_skipped JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_ticket_rows INTEGER NOT NULL DEFAULT 0,
  aggregated_po_dates INTEGER NOT NULL DEFAULT 0,
  operations_updated INTEGER NOT NULL DEFAULT 0,
  operations_failed INTEGER NOT NULL DEFAULT 0,
  rows_upserted INTEGER NOT NULL DEFAULT 0,
  row_parse_failures JSONB NOT NULL DEFAULT '[]'::jsonb,
  operation_failures JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trucking_wb_imports_created_at
  ON trucking_wb_imports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trucking_wb_imports_uploaded_by
  ON trucking_wb_imports (uploaded_by);

ALTER TABLE trucking_daily_actuals
  ADD COLUMN IF NOT EXISTS wb_import_id UUID REFERENCES trucking_wb_imports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trucking_daily_actuals_wb_import
  ON trucking_daily_actuals (wb_import_id)
  WHERE wb_import_id IS NOT NULL;
