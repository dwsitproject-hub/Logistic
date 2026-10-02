/**
 * Webhook signature and payload for events JPS sends to KLIP (Partner API 5.x, section 3.5 and 3.6).
 *
 * JPS signs `<X-JPS-Timestamp>.<raw body>` with HMAC-SHA256 and the secret it showed once when the endpoint was registered,
 * and sends `X-JPS-Signature: sha256=<hex>`. The raw bytes are what is signed, so the route must not parse the body first.
 */
import crypto from 'crypto';
import { jpsWebhookSecret } from './config';
import type { JpsInstruction } from './types';

export const JPS_WEBHOOK_EVENTS = ['status.changed', 'schedule.updated'] as const;
export type JpsWebhookEvent = (typeof JPS_WEBHOOK_EVENTS)[number];

export interface JpsWebhookHeaders {
  timestamp?: string;
  signature?: string;
  event?: string;
  deliveryId?: string;
}

export interface JpsWebhookPayload {
  event: string;
  occurred_at?: string;
  data: JpsInstruction;
}

/** The signature JPS would produce for this timestamp, body and secret. */
export function signJpsWebhook(secret: string, timestamp: string, rawBody: Buffer | string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

/**
 * True only when a secret is configured and the signature matches. No secret means no delivery can be trusted, so it is
 * a rejection, not a pass.
 */
export function verifyJpsSignature(rawBody: Buffer, headers: JpsWebhookHeaders, secret = jpsWebhookSecret()): boolean {
  const timestamp = String(headers.timestamp ?? '').trim();
  const received = String(headers.signature ?? '').trim().replace(/^sha256=/i, '').toLowerCase();
  if (!secret || !timestamp || !received || !rawBody) return false;
  const expected = signJpsWebhook(secret, timestamp, rawBody);
  if (expected.length !== received.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  } catch {
    return false;
  }
}

/** The body, if it is what JPS documents: an event, and the instruction in `data` with the reference we sent. */
export function parseJpsWebhookPayload(rawBody: Buffer): JpsWebhookPayload | null {
  try {
    const parsed = JSON.parse(rawBody.toString('utf8')) as JpsWebhookPayload;
    if (!parsed || typeof parsed.event !== 'string' || !parsed.data || typeof parsed.data !== 'object') return null;
    if (typeof parsed.data.external_reference !== 'string' || !parsed.data.external_reference.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}
