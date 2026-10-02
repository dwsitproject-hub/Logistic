-- Webhook deliveries JPS has sent to KLIP (POST /api/jps/webhooks), kept so a delivery JPS retries is recognised.
--
-- JPS delivers at-least-once and says to dedupe on X-JPS-Delivery-Id. The id is written only AFTER the delivery was
-- applied, so a delivery whose apply failed (and was answered 5xx) is processed again on the retry instead of being
-- skipped as a duplicate. Applying the same status twice writes the same values, so the narrow window in which two copies
-- are in flight at once does no harm.
--
-- Small and self-cleaning: rows older than 30 days are deleted by the receiver.

CREATE TABLE IF NOT EXISTS jps_webhook_deliveries (
  delivery_id VARCHAR(100) PRIMARY KEY,
  event VARCHAR(50),
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jps_webhook_deliveries_received_at ON jps_webhook_deliveries (received_at);
