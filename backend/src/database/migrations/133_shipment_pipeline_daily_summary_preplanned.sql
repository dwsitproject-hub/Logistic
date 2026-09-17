-- Preplanned pipeline stage count for Shipments Section 1 cards.
ALTER TABLE shipment_pipeline_daily_summary
  ADD COLUMN IF NOT EXISTS preplanned_contract_count BIGINT NOT NULL DEFAULT 0;
