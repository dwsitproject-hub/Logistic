import { describe, expect, it } from 'vitest';
import { buildKmapsWebhookBody, kmapsWebhookHeaders, retryDelayAfter, signKmapsWebhook } from './webhook';

/** The test vector of the KMAPS contract, section 7.3: both sides must produce this exact signature. */
const SECRET = 'whsec_test_0123456789abcdef';
const TIMESTAMP = '1793000000';
const BODY =
  '{"event":"shipment.updated","eventId":"5f0c1d52-8a0e-4b57-9f0e-1f6c2f1d7a11","deliveryId":"b7c1e6a4-3d2f-4e0a-9b5c-0c6a1f2e8d33","occurredAt":"2026-11-06T06:30:00.000Z","entityType":"shipment","recordId":"STO-4500012345","version":12,"vesselCode":"VSL-0537"}';
const SIGNATURE = '8d14ca4a5babea7d596130e7de0aa00fdecc797467977d97ffa97c57c592eaed';

describe('KMAPS webhook signature (contract 7.3 test vector)', () => {
  it('produces the contract signature for the contract body', () => {
    expect(signKmapsWebhook(SECRET, TIMESTAMP, BODY)).toBe(SIGNATURE);
    expect(signKmapsWebhook(SECRET, TIMESTAMP, Buffer.from(BODY, 'utf8'))).toBe(SIGNATURE);
  });

  it('serializes the contract example body byte for byte, so the signed bytes are the sent bytes', () => {
    const body = buildKmapsWebhookBody({
      event: 'shipment.updated',
      eventId: '5f0c1d52-8a0e-4b57-9f0e-1f6c2f1d7a11',
      deliveryId: 'b7c1e6a4-3d2f-4e0a-9b5c-0c6a1f2e8d33',
      occurredAt: '2026-11-06T06:30:00.000Z',
      recordId: 'STO-4500012345',
      version: 12,
      vesselCode: 'VSL-0537',
    });
    expect(body).toBe(BODY);
  });

  it('headers carry the event, ids, the timestamp of the attempt and sha256=<signature>', () => {
    const headers = kmapsWebhookHeaders({
      secret: SECRET,
      rawBody: BODY,
      event: 'shipment.updated',
      eventId: '5f0c1d52-8a0e-4b57-9f0e-1f6c2f1d7a11',
      deliveryId: 'b7c1e6a4-3d2f-4e0a-9b5c-0c6a1f2e8d33',
      nowSeconds: 1793000000,
    });
    expect(headers).toEqual({
      'Content-Type': 'application/json',
      'X-KLIP-Event': 'shipment.updated',
      'X-KLIP-Event-Id': '5f0c1d52-8a0e-4b57-9f0e-1f6c2f1d7a11',
      'X-KLIP-Delivery-Id': 'b7c1e6a4-3d2f-4e0a-9b5c-0c6a1f2e8d33',
      'X-KLIP-Timestamp': '1793000000',
      'X-KLIP-Signature': `sha256=${SIGNATURE}`,
    });
  });

  it('a tampered body, a different timestamp or another secret does not match', () => {
    expect(signKmapsWebhook(SECRET, TIMESTAMP, BODY.replace('12', '13'))).not.toBe(SIGNATURE);
    expect(signKmapsWebhook(SECRET, '1793000001', BODY)).not.toBe(SIGNATURE);
    expect(signKmapsWebhook('whsec_other', TIMESTAMP, BODY)).not.toBe(SIGNATURE);
  });

  it('the body has exactly the contract fields: no price, quantity or party can ride in it', () => {
    const body = JSON.parse(
      buildKmapsWebhookBody({ event: 'shipment.created', eventId: 'e', deliveryId: 'd', occurredAt: new Date(0), recordId: 'shp_x', version: 1, vesselCode: null }),
    );
    expect(Object.keys(body)).toEqual(['event', 'eventId', 'deliveryId', 'occurredAt', 'entityType', 'recordId', 'version', 'vesselCode']);
    expect(body.vesselCode).toBeNull();
  });

  it('retries: 30 s, 2 min, 10 min, 1 h, 6 h, then stop', () => {
    expect([1, 2, 3, 4, 5].map(retryDelayAfter)).toEqual([30_000, 120_000, 600_000, 3_600_000, 21_600_000]);
    expect(retryDelayAfter(6)).toBeNull();
  });
});
