-- Every call KLIP makes to the Jetty Planning System, with what was sent and what came back.
--
-- jps_shipping_instructions keeps the outcome per STO, but a retryable failure (a 500, a timeout) writes no row on
-- purpose, so after SMS 3002 and three other STOs kept coming back 500 on 2026-10-02 the only trace was the server log.
-- This table is that trace, readable from Integrations > JPS > History.
--
-- The API key travels in a header and is never stored. Bodies are capped (see callLog.ts) and rows older than 30 days
-- are deleted by the writer itself, so the table stays small: polls are at most one per instruction every 5 minutes.

CREATE TABLE IF NOT EXISTS jps_api_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- submit / amend / poll / recover / test / other, from the request itself
  kind VARCHAR(20) NOT NULL,
  method VARCHAR(10) NOT NULL,
  url TEXT NOT NULL,
  sto_key VARCHAR(100),
  external_reference VARCHAR(100),
  request_params JSONB,
  request_body JSONB,
  -- 0 when no response came back at all (timeout, refused connection)
  response_status INT NOT NULL,
  response_body JSONB,
  ok BOOLEAN NOT NULL,
  error_code VARCHAR(100),
  error_message TEXT,
  -- JPS's own id for the call, the one its support asks for
  request_id VARCHAR(100),
  duration_ms INT
);

CREATE INDEX IF NOT EXISTS idx_jps_api_calls_created_at ON jps_api_calls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jps_api_calls_sto_key ON jps_api_calls (sto_key);
CREATE INDEX IF NOT EXISTS idx_jps_api_calls_request_id ON jps_api_calls (request_id);
