import crypto from 'crypto';

/**
 * The webhook KLIP sends KMAPS (contract section 7). A bell: "record X changed". It carries NO business data and NO price; KMAPS reads the record through the API.
 *
 * Signature (fixed by the contract, section 7.3):
 *   signature = HMAC_SHA256(key = webhook secret, message = X-KLIP-Timestamp + "." + raw body bytes), hex, lower case; header "sha256=" + signature.
 * The body is serialized ONCE and those exact bytes are signed and sent. The JPS receiver (jps/webhook.ts) does the mirror image for what JPS sends to KLIP.
 */
export const KMAPS_WEBHOOK_EVENTS = ['shipment.created', 'shipment.updated', 'shipment.status_changed', 'shipment.deleted'] as const;
export type KmapsWebhookEvent = (typeof KMAPS_WEBHOOK_EVENTS)[number];

export function signKmapsWebhook(secret: string, timestamp: string | number, rawBody: Buffer | string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

export interface KmapsWebhookBody {
  event: KmapsWebhookEvent;
  eventId: string;
  deliveryId: string;
  occurredAt: string;
  entityType: 'shipment';
  recordId: string;
  version: number;
  vesselCode: string | null;
}

/** Key order is the contract's example order. Exactly these fields; nothing else, in particular no quantity, price, party or document. */
export function buildKmapsWebhookBody(input: {
  event: KmapsWebhookEvent;
  eventId: string;
  deliveryId: string;
  occurredAt: Date | string;
  recordId: string;
  version: number;
  vesselCode: string | null;
}): string {
  const body: KmapsWebhookBody = {
    event: input.event,
    eventId: input.eventId,
    deliveryId: input.deliveryId,
    occurredAt: new Date(input.occurredAt).toISOString(),
    entityType: 'shipment',
    recordId: input.recordId,
    version: input.version,
    vesselCode: input.vesselCode,
  };
  return JSON.stringify(body);
}

/** The headers of one delivery attempt. The timestamp is the moment of THIS attempt (KMAPS rejects one more than 300 seconds off its clock). */
export function kmapsWebhookHeaders(input: {
  secret: string;
  rawBody: string;
  event: KmapsWebhookEvent;
  eventId: string;
  deliveryId: string;
  nowSeconds?: number;
}): Record<string, string> {
  const timestamp = String(input.nowSeconds ?? Math.floor(Date.now() / 1000));
  return {
    'Content-Type': 'application/json',
    'X-KLIP-Event': input.event,
    'X-KLIP-Event-Id': input.eventId,
    'X-KLIP-Delivery-Id': input.deliveryId,
    'X-KLIP-Timestamp': timestamp,
    'X-KLIP-Signature': `sha256=${signKmapsWebhook(input.secret, timestamp, input.rawBody)}`,
  };
}

/** Wait before retry N (1-based): 30 s, 2 min, 10 min, 1 h, 6 h, then stop (contract 7.4). Null when the retries are used up. */
export const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000] as const;

export function retryDelayAfter(attemptsMade: number): number | null {
  return RETRY_DELAYS_MS[attemptsMade - 1] ?? null;
}
