-- KMAPS partner API (KLIP is the data provider, KMAPS pulls; docs: D:\Project\kmaps\docs\KLIP-SHIPMENT-API.md, Draft 5).
--
-- Every call KMAPS makes to /api/partner/v1, readable from Integrations > KMAPS > History. It has the same shape as dhm_api_calls (migration 221) so the
-- history list and detail endpoints and the page are shared. Two differences, both on purpose:
--   * the table records calls KLIP RECEIVES, so there are no request or response bodies: the shipments answer carries the contract price, and the
--     contract (section 9) says "not the body, not the price". What is kept is the time, the path, the query parameters, the status, the duration
--     and, in response_body, only {"records": n}.
--   * `subject` holds a short description of what was asked (for example "3 vessel codes"), `reference` stays empty.
-- Rows older than 30 days are deleted by the writer (integrations/apiCallLog.ts).

CREATE TABLE IF NOT EXISTS kmaps_api_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kind VARCHAR(20) NOT NULL,
  method VARCHAR(10) NOT NULL,
  url TEXT NOT NULL,
  subject VARCHAR(100),
  reference VARCHAR(100),
  request_params JSONB,
  request_body JSONB,
  response_status INT NOT NULL,
  response_body JSONB,
  ok BOOLEAN NOT NULL,
  error_code VARCHAR(100),
  error_message TEXT,
  request_id VARCHAR(100),
  duration_ms INT
);

CREATE INDEX IF NOT EXISTS idx_kmaps_api_calls_created_at ON kmaps_api_calls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kmaps_api_calls_subject ON kmaps_api_calls (subject);
