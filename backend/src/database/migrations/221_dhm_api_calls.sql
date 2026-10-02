-- Every call KLIP makes to DHM (Data Hub Master), with what was sent and what came back. The DHM twin of
-- jps_api_calls (migration 220), readable from Integrations > DHM > History.
--
-- kind is auth / push / sync / catalog / lookup / other. `slug` is the DHM entity (company, site, plant, port_master,
-- vessel, ...) and `code` the record code (ORG-0003, VSL-0249) when the call names one.
--
-- The private key never reaches this table: the token request is stored with the key replaced and a successful answer
-- reduced to a placeholder, and every other body has dhm_sk_ keys masked before it is written (dhm/callLog.ts). A
-- successful read keeps only the first 2,000 characters of its answer, since a sync page is large and the same every
-- 15 minutes; everything else is capped at 32,000. Rows older than 30 days are deleted by the writer.

CREATE TABLE IF NOT EXISTS dhm_api_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kind VARCHAR(20) NOT NULL,
  method VARCHAR(10) NOT NULL,
  url TEXT NOT NULL,
  slug VARCHAR(100),
  code VARCHAR(100),
  request_params JSONB,
  request_body JSONB,
  -- 0 when no response came back at all (timeout, refused connection)
  response_status INT NOT NULL,
  response_body JSONB,
  ok BOOLEAN NOT NULL,
  error_code VARCHAR(100),
  error_message TEXT,
  request_id VARCHAR(100),
  duration_ms INT
);

CREATE INDEX IF NOT EXISTS idx_dhm_api_calls_created_at ON dhm_api_calls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dhm_api_calls_slug ON dhm_api_calls (slug);
CREATE INDEX IF NOT EXISTS idx_dhm_api_calls_code ON dhm_api_calls (code);
