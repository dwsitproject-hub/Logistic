/**
 * Receive an event JPS sends to KLIP (status.changed, schedule.updated) and put it on the instruction it describes.
 *
 * The answer decides what JPS does next: 2xx ends the delivery, anything else is retried with backoff. So a delivery that
 * cannot be trusted (bad signature) or understood is refused, one that is none of our business (a reference KLIP never
 * sent) is accepted and dropped so JPS does not retry it forever, and one that failed to apply is answered 5xx so it comes
 * back.
 *
 * Every delivery, accepted or not, is written to the call history (Integrations > JPS > History, kind "webhook"), so a
 * webhook that never arrives or arrives with the wrong secret can be seen from the page.
 */
import { query } from '../database/connection';
import logger from '../utils/logger';
import { applyJpsInstruction } from './applyInstruction';
import { recordJpsCall, stoKeyFromReference } from './callLog';
import { isJpsEnabled } from './config';
import { parseJpsWebhookPayload, verifyJpsSignature, type JpsWebhookHeaders } from './webhook';

export interface JpsWebhookResult {
  accepted: boolean;
  /** HTTP status to answer with. */
  status: number;
  duplicate?: boolean;
  /** Accepted but not applied, and why. */
  ignored?: string;
  error?: string;
}

const RETENTION_DAYS = 30;
const WEBHOOK_URL = '/api/jps/webhooks';

async function wasDelivered(deliveryId: string): Promise<boolean> {
  const r = await query(`SELECT 1 FROM jps_webhook_deliveries WHERE delivery_id = $1`, [deliveryId]);
  return r.rows.length > 0;
}

async function markDelivered(deliveryId: string, event: string): Promise<void> {
  await query(
    `INSERT INTO jps_webhook_deliveries (delivery_id, event) VALUES ($1, $2) ON CONFLICT (delivery_id) DO NOTHING`,
    [deliveryId, event],
  );
  // Cheap and self-cleaning; a delivery is only ever repeated within hours, never within a month.
  await query(`DELETE FROM jps_webhook_deliveries WHERE received_at < NOW() - ($1::int || ' days')::interval`, [
    RETENTION_DAYS,
  ]);
}

async function invalidateShipmentsList(): Promise<void> {
  try {
    const { invalidateShipmentsListCache } = await import('../services/shipmentList.service');
    invalidateShipmentsListCache();
  } catch (error) {
    logger.warn('JPS webhook: could not clear the Shipments list cache', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function handleJpsWebhook(rawBody: Buffer, headers: JpsWebhookHeaders): Promise<JpsWebhookResult> {
  const startedAt = Date.now();
  const deliveryId = String(headers.deliveryId ?? '').trim();
  const event = String(headers.event ?? '').trim();

  const finish = async (
    result: JpsWebhookResult,
    detail: { reference?: string | null; body?: unknown } = {},
  ): Promise<JpsWebhookResult> => {
    await recordJpsCall({
      kind: 'webhook',
      method: 'POST',
      url: WEBHOOK_URL,
      stoKey: stoKeyFromReference(detail.reference),
      externalReference: detail.reference ?? null,
      requestParams: { event: event || null, deliveryId: deliveryId || null, timestamp: headers.timestamp ?? null },
      // The body of a delivery whose signature failed is not ours to trust or keep.
      requestBody: detail.body ?? null,
      responseStatus: result.status,
      responseBody: {
        accepted: result.accepted,
        duplicate: result.duplicate ?? false,
        ignored: result.ignored ?? null,
      },
      ok: result.accepted,
      errorCode: result.accepted ? null : `HTTP_${result.status}`,
      errorMessage: result.error ?? null,
      requestId: deliveryId || null,
      durationMs: Date.now() - startedAt,
    });
    return result;
  };

  if (!isJpsEnabled()) {
    return finish({ accepted: false, status: 503, error: 'JPS integration is not enabled' });
  }
  if (!verifyJpsSignature(rawBody, headers)) {
    return finish({ accepted: false, status: 401, error: 'Invalid signature' });
  }
  const payload = parseJpsWebhookPayload(rawBody);
  if (!payload) {
    return finish({ accepted: false, status: 400, error: 'Invalid payload' });
  }
  const reference = payload.data.external_reference;
  const detail = { reference, body: payload };
  if (!deliveryId) {
    return finish({ accepted: false, status: 400, error: 'Missing X-JPS-Delivery-Id' }, detail);
  }

  try {
    if (await wasDelivered(deliveryId)) {
      return await finish({ accepted: true, status: 200, duplicate: true }, detail);
    }

    const found = await query(
      `SELECT id, jps_status FROM jps_shipping_instructions WHERE external_reference = $1 LIMIT 1`,
      [reference],
    );
    const row = found.rows[0] as { id: string; jps_status: string | null } | undefined;
    if (!row) {
      // Not an instruction KLIP sent (another environment, another partner's key): nothing to update, and a 4xx would
      // only make JPS retry it.
      await markDelivered(deliveryId, event || payload.event);
      return await finish({ accepted: true, status: 200, ignored: 'unknown external_reference' }, detail);
    }

    await applyJpsInstruction(row.id, payload.data);
    await markDelivered(deliveryId, event || payload.event);
    await invalidateShipmentsList();
    if (String(row.jps_status ?? '') !== String(payload.data.status ?? '')) {
      logger.info('JPS status changed (webhook)', {
        reference,
        event: payload.event,
        from: row.jps_status,
        to: payload.data.status,
      });
    }
    return await finish({ accepted: true, status: 200 }, detail);
  } catch (error) {
    logger.error('JPS webhook apply failed', {
      deliveryId,
      reference,
      error: error instanceof Error ? error.message : String(error),
    });
    return finish({ accepted: false, status: 500, error: 'Apply failed' }, detail);
  }
}
