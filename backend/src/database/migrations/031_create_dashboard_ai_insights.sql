-- Dashboard AI Insights cache table
-- Stores AI-generated insights per dashboard filter combination.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS dashboard_ai_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_key TEXT NOT NULL UNIQUE,
  filter_params JSONB NOT NULL,
  summary TEXT NOT NULL,
  highlights TEXT NOT NULL,
  recommendations TEXT NOT NULL,
  model_provider TEXT,
  model_name TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dashboard_ai_insights_filter_key
  ON dashboard_ai_insights(filter_key);

