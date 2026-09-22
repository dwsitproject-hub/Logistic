import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { parseDhmWebhookPayload, verifyDhmSignature } from './webhook';

describe('dhm webhook crypto', () => {
  it('accepts HMAC of the raw body and rejects a mutated payload', () => {
    const secret = 'test-webhook-secret';
    process.env.DHM_WEBHOOK_SECRET = secret;
    const raw = Buffer.from('{"deliveryId":"d1","entityType":"vessel","recordId":"r1"}');
    const header = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
    expect(verifyDhmSignature(raw, header)).toBe(true);
    expect(verifyDhmSignature(Buffer.from(`${raw.toString()} `), header)).toBe(false);
    expect(verifyDhmSignature(raw, 'sha256=deadbeef')).toBe(false);
  });

  it('requires deliveryId for replay dedupe', () => {
    expect(parseDhmWebhookPayload(Buffer.from('{"event":"record.updated"}'))).toBeNull();
    expect(
      parseDhmWebhookPayload(
        Buffer.from(
          JSON.stringify({
            deliveryId: 'del-1',
            entityType: 'vessel',
            recordId: 'rec-1',
            event: 'record.updated',
          }),
        ),
      ),
    ).toMatchObject({ deliveryId: 'del-1', entityType: 'vessel' });
  });
});
