import crypto from 'crypto';
import { dhmWebhookSecret } from './config';
import type { DhmWebhookPayload } from './types';

export function verifyDhmSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  const secret = dhmWebhookSecret();
  if (!secret || !rawBody || !signatureHeader) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const received = String(signatureHeader).trim();
  if (expected.length !== received.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  } catch {
    return false;
  }
}

export function parseDhmWebhookPayload(rawBody: Buffer): DhmWebhookPayload | null {
  try {
    const parsed = JSON.parse(rawBody.toString('utf8')) as DhmWebhookPayload;
    if (!parsed?.deliveryId || !parsed.entityType || !parsed.recordId) return null;
    return parsed;
  } catch {
    return null;
  }
}
