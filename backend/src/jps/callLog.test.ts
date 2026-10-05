import { describe, expect, it } from 'vitest';
import { boundJson, inferJpsCallKind, maskWebhookSecrets, stoKeyFromReference } from './callLog';

describe('boundJson', () => {
  it('stores a small body as it is and nothing as null', () => {
    expect(boundJson({ a: 1 })).toBe('{"a":1}');
    expect(boundJson(null)).toBeNull();
    expect(boundJson(undefined)).toBeNull();
  });

  it('keeps the start of a body over the cap instead of dropping it', () => {
    const big = { text: 'x'.repeat(40_000) };
    const parsed = JSON.parse(boundJson(big) as string);
    expect(parsed.truncated).toBe(true);
    expect(parsed.chars).toBeGreaterThan(40_000);
    expect(String(parsed.preview).length).toBe(32_000);
  });

  it('survives a body that cannot be serialised', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(JSON.parse(boundJson(loop) as string)).toEqual({ unserializable: true });
  });
});

describe('inferJpsCallKind', () => {
  it('names a call from its shape', () => {
    expect(inferJpsCallKind('POST', '/shipping-instructions')).toBe('submit');
    expect(inferJpsCallKind('patch', '/shipping-instructions/7')).toBe('amend');
    expect(inferJpsCallKind('PATCH', '/shipping-instructions')).toBe('amend');
    expect(inferJpsCallKind('GET', '/shipping-instructions/7')).toBe('poll');
    expect(inferJpsCallKind('GET', '/shipping-instructions')).toBe('recover');
    expect(inferJpsCallKind('GET', '/terms')).toBe('test');
    expect(inferJpsCallKind('GET', '/agents')).toBe('other');
    expect(inferJpsCallKind(undefined, undefined)).toBe('other');
  });
});

describe('stoKeyFromReference', () => {
  it('reads the STO key back out of KLIP-<sto>-R<n>', () => {
    expect(stoKeyFromReference('KLIP-OP-1004031960-46588213-R1')).toBe('OP-1004031960-46588213');
    expect(stoKeyFromReference('KLIP-1006020016-R11')).toBe('1006020016');
  });

  it('answers null for anything else', () => {
    expect(stoKeyFromReference('something else')).toBeNull();
    expect(stoKeyFromReference(undefined)).toBeNull();
  });
});

// POST /webhooks answers with the signing secret once; the history must not keep it.
describe('maskWebhookSecrets', () => {
  it('replaces the secret JPS shows at registration, wherever it sits', () => {
    const masked = maskWebhookSecrets({
      success: true,
      data: { id: 1, url: 'http://x', secret_prefix: 'whsec_a1b2c3d4', secret: 'whsec_a1b2c3d4e5f6', events: ['status.changed'] },
    });
    expect(JSON.stringify(masked)).not.toContain('e5f6');
    expect(masked.data.secret).toBe('***');
    // the prefix is how a person tells two endpoints apart, and is not the secret
    expect(masked.data.secret_prefix).toBe('whsec_a1b2c3d4');
    expect(masked.data.events).toEqual(['status.changed']);
  });

  it('reaches into arrays and leaves other values and non-objects alone', () => {
    expect(maskWebhookSecrets({ list: [{ secret: 'a' }, { name: 'b' }] })).toEqual({ list: [{ secret: '***' }, { name: 'b' }] });
    expect(maskWebhookSecrets(null)).toBeNull();
    expect(maskWebhookSecrets('plain')).toBe('plain');
  });
});
