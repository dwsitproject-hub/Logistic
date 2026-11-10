-- Webhook bells KLIP sends KMAPS (contract section 7): "record X changed". One row per delivery, so a failed one can be retried with the SAME delivery id (KMAPS
-- dedupes on it) and shown on Integrations > KMAPS with a Resend button.
--
-- `body` is the exact text that was serialized once and signed; every attempt sends these same bytes with a fresh timestamp and signature. It carries no
-- business data and no price (partner/webhook.ts), so keeping it is harmless.
--
-- status: PENDING (waiting for its first attempt or a retry), DELIVERED (KMAPS answered 2xx), FAILED (the retries are used up: 30 s, 2 min, 10 min, 1 h, 6 h).
-- Delivered rows are deleted after 7 days, failed ones after 30, by the sender.

CREATE TABLE IF NOT EXISTS kmaps_webhook_deliveries (
  delivery_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL DEFAULT gen_random_uuid(),
  event            VARCHAR(40) NOT NULL,
  record_id        TEXT NOT NULL,
  version          BIGINT NOT NULL,
  vessel_code      TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  body             TEXT NOT NULL,
  status           VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DELIVERED', 'FAILED')),
  attempts         INT NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at  TIMESTAMPTZ,
  last_status      INT,
  last_error       TEXT,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kmaps_webhook_due ON kmaps_webhook_deliveries (next_attempt_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_kmaps_webhook_status ON kmaps_webhook_deliveries (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kmaps_webhook_record ON kmaps_webhook_deliveries (record_id, event) WHERE status = 'PENDING';
