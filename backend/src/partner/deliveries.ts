import axios from 'axios';
import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { query } from '../database/connection';
import { recordApiCall } from '../integrations/apiCallLog';
import logger from '../utils/logger';
import { isKmapsWebhookConfigured, kmapsWebhookSecret, kmapsWebhookUrl } from './config';
import {
  buildKmapsWebhookBody,
  kmapsWebhookHeaders,
  retryDelayAfter,
  type KmapsWebhookEvent,
} from './webhook';

/**
 * Webhook deliveries to KMAPS: enqueue what the records refresh found, send what is due, retry what failed, offer a resend.
 * Delivery is at least once and unordered; KMAPS dedupes on the delivery id and orders by `version`, and polls every 15 minutes anyway, so a lost bell only delays.
 */

export interface ChangeEvent {
  recordId: string;
  version: number;
  vesselCode: string | null;
  events: KmapsWebhookEvent[];
}

const SEND_TIMEOUT_MS = 5_000;
const BATCH = 20;
/** A claimed row is invisible to the next sweep for this long, so two sweeps never send the same delivery at once. */
const LEASE_SECONDS = 60;

/**
 * Queue the bells for a refresh's changes. Runs inside the refresh's transaction, so a change and its bell are committed together or not at all. A pending
 * bell of the same kind for the same record that has not been tried yet is updated instead of doubled (contract 7.4: at most one `updated` per record per burst).
 */
export async function enqueueChangeEvents(client: PoolClient, changes: ChangeEvent[]): Promise<number> {
  if (!isKmapsWebhookConfigured() || changes.length === 0) return 0;
  let queued = 0;
  for (const change of changes) {
    for (const event of change.events) {
      const pending = await client.query(
        `SELECT delivery_id::text AS delivery_id, event_id::text AS event_id
           FROM kmaps_webhook_deliveries
          WHERE record_id = $1 AND event = $2 AND status = 'PENDING' AND attempts = 0
          LIMIT 1`,
        [change.recordId, event],
      );
      if (pending.rows[0]) {
        const { delivery_id: deliveryId, event_id: eventId } = pending.rows[0] as { delivery_id: string; event_id: string };
        const body = buildKmapsWebhookBody({
          event,
          eventId,
          deliveryId,
          occurredAt: new Date(),
          recordId: change.recordId,
          version: change.version,
          vesselCode: change.vesselCode,
        });
        await client.query(
          `UPDATE kmaps_webhook_deliveries SET version = $2, vessel_code = $3, body = $4, occurred_at = NOW() WHERE delivery_id = $1::uuid`,
          [deliveryId, change.version, change.vesselCode, body],
        );
        continue;
      }
      const deliveryId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const occurredAt = new Date();
      const body = buildKmapsWebhookBody({
        event,
        eventId,
        deliveryId,
        occurredAt,
        recordId: change.recordId,
        version: change.version,
        vesselCode: change.vesselCode,
      });
      await client.query(
        `INSERT INTO kmaps_webhook_deliveries (delivery_id, event_id, event, record_id, version, vessel_code, occurred_at, body)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)`,
        [deliveryId, eventId, event, change.recordId, change.version, change.vesselCode, occurredAt, body],
      );
      queued += 1;
    }
  }
  return queued;
}

interface DueRow {
  delivery_id: string;
  event_id: string;
  event: KmapsWebhookEvent;
  record_id: string;
  body: string;
  attempts: number;
}

/** Send what is due. Returns how many bells were delivered and how many failed this sweep. Never throws: the next sweep tries again. */
export async function sendDueDeliveries(): Promise<{ delivered: number; failed: number }> {
  const result = { delivered: 0, failed: 0 };
  if (!isKmapsWebhookConfigured()) return result;
  try {
    const claimed = await query(
      `UPDATE kmaps_webhook_deliveries d
          SET next_attempt_at = NOW() + ($2::int || ' seconds')::interval
        WHERE d.delivery_id IN (
                SELECT delivery_id FROM kmaps_webhook_deliveries
                 WHERE status = 'PENDING' AND next_attempt_at <= NOW()
                 ORDER BY next_attempt_at
                 LIMIT $1
                 FOR UPDATE SKIP LOCKED)
        RETURNING d.delivery_id::text AS delivery_id, d.event_id::text AS event_id, d.event, d.record_id, d.body, d.attempts`,
      [BATCH, LEASE_SECONDS],
    );
    for (const row of claimed.rows as DueRow[]) {
      const ok = await sendOne(row);
      if (ok) result.delivered += 1;
      else result.failed += 1;
    }
  } catch (error) {
    logger.error('KMAPS webhook sweep failed', { error: error instanceof Error ? error.message : String(error) });
  }
  return result;
}

async function sendOne(row: DueRow): Promise<boolean> {
  const url = kmapsWebhookUrl();
  const startedAt = Date.now();
  let status = 0;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  try {
    const headers = kmapsWebhookHeaders({
      secret: kmapsWebhookSecret(),
      rawBody: row.body,
      event: row.event,
      eventId: row.event_id,
      deliveryId: row.delivery_id,
    });
    const res = await axios.post(url, row.body, {
      headers,
      timeout: SEND_TIMEOUT_MS,
      maxRedirects: 0,
      validateStatus: () => true,
      // The body is already the exact bytes that were signed: no transformation.
      transformRequest: [(data) => data],
    });
    status = res.status;
    if (status < 200 || status >= 300) {
      errorCode = `http_${status}`;
      errorMessage = `KMAPS answered ${status}`;
    }
  } catch (error) {
    // Message only: the request object carries the signature headers.
    errorCode = (error as { code?: string })?.code ?? 'request_failed';
    errorMessage = error instanceof Error ? error.message.slice(0, 200) : 'request failed';
  }
  const ok = status >= 200 && status < 300;
  const attempts = row.attempts + 1;
  try {
    if (ok) {
      await query(
        `UPDATE kmaps_webhook_deliveries
            SET status = 'DELIVERED', attempts = $2, last_attempt_at = NOW(), last_status = $3, last_error = NULL, delivered_at = NOW()
          WHERE delivery_id = $1::uuid`,
        [row.delivery_id, attempts, status],
      );
    } else {
      const delay = retryDelayAfter(attempts);
      await query(
        `UPDATE kmaps_webhook_deliveries
            SET attempts = $2, last_attempt_at = NOW(), last_status = $3, last_error = $4,
                status = CASE WHEN $5::int IS NULL THEN 'FAILED' ELSE 'PENDING' END,
                next_attempt_at = CASE WHEN $5::int IS NULL THEN next_attempt_at ELSE NOW() + ($5::int || ' milliseconds')::interval END
          WHERE delivery_id = $1::uuid`,
        [row.delivery_id, attempts, status || null, errorMessage, delay],
      );
    }
  } catch (error) {
    logger.error('KMAPS webhook result could not be saved', { error: error instanceof Error ? error.message : String(error) });
  }
  void recordApiCall('kmaps', {
    kind: 'webhook',
    method: 'POST',
    // The URL is what an ADMIN registered (host and slug): no secret and no key in it.
    url,
    subject: row.event,
    reference: row.record_id,
    requestParams: null,
    // The bell: ids, version and vessel code only. No price, and the signature headers are not kept.
    requestBody: JSON.parse(row.body),
    responseStatus: status,
    responseBody: null,
    ok,
    errorCode,
    errorMessage,
    requestId: row.delivery_id,
    durationMs: Date.now() - startedAt,
  });
  return ok;
}

export interface DeliveryView {
  delivery_id: string;
  event: string;
  record_id: string;
  version: string;
  vessel_code: string | null;
  status: string;
  attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  last_status: number | null;
  last_error: string | null;
  created_at: string;
}

export async function listDeliveries(status: 'FAILED' | 'PENDING' | 'ALL', limit = 100): Promise<{ items: DeliveryView[]; counts: Record<string, number> }> {
  const filter = status === 'ALL' ? '' : `WHERE status = '${status}'`;
  const [items, counts] = await Promise.all([
    query(
      `SELECT delivery_id::text AS delivery_id, event, record_id, version::text AS version, vessel_code, status, attempts, next_attempt_at::text AS next_attempt_at,
              last_attempt_at::text AS last_attempt_at, last_status, last_error, created_at::text AS created_at
         FROM kmaps_webhook_deliveries ${filter} ORDER BY created_at DESC LIMIT $1`,
      [Math.min(200, Math.max(1, limit))],
    ),
    query(`SELECT status, COUNT(*)::int AS n FROM kmaps_webhook_deliveries GROUP BY status`),
  ]);
  const byStatus: Record<string, number> = { PENDING: 0, DELIVERED: 0, FAILED: 0 };
  for (const r of counts.rows as Array<{ status: string; n: number }>) byStatus[r.status] = r.n;
  return { items: items.rows as DeliveryView[], counts: byStatus };
}

/** Put a delivery (or every failed one) back in the queue to be sent at the next sweep, with the same delivery id. Returns how many were queued. */
export async function resendDeliveries(deliveryId: string | null): Promise<number> {
  const res = await query(
    `UPDATE kmaps_webhook_deliveries
        SET status = 'PENDING', attempts = 0, next_attempt_at = NOW(), last_error = NULL
      WHERE status <> 'PENDING' AND ($1::uuid IS NULL AND status = 'FAILED' OR delivery_id = $1::uuid)`,
    [deliveryId],
  );
  return res.rowCount ?? 0;
}

export async function pruneDeliveries(): Promise<void> {
  await query(
    `DELETE FROM kmaps_webhook_deliveries
      WHERE (status = 'DELIVERED' AND delivered_at < NOW() - INTERVAL '7 days')
         OR (status = 'FAILED' AND created_at < NOW() - INTERVAL '30 days')`,
  );
}
