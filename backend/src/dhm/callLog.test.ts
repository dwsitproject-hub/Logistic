import { describe, expect, it } from 'vitest';
import { describeDhmCall, maskSecrets, redactedAuthRequest } from './callLog';

describe('describeDhmCall', () => {
  it('names a push by slug and record code', () => {
    expect(describeDhmCall('POST', '/v1/inbound/company')).toMatchObject({ kind: 'push', slug: 'company', code: null });
    expect(describeDhmCall('PUT', '/v1/inbound/site/SITE-0005')).toMatchObject({
      kind: 'push',
      slug: 'site',
      code: 'SITE-0005',
    });
    expect(describeDhmCall('put', '/v1/inbound/vessel/VSL-0249')).toMatchObject({ slug: 'vessel', code: 'VSL-0249' });
  });

  it('names a sync by slug and gives its query string as parameters', () => {
    const call = describeDhmCall('GET', '/v1/sync/company?since=2026-10-01&limit=200');
    expect(call).toMatchObject({ kind: 'sync', slug: 'company', code: null, path: '/v1/sync/company' });
    expect(call.params).toEqual({ since: '2026-10-01', limit: '200' });
  });

  it('names the catalog, a lookup and the token request', () => {
    expect(describeDhmCall('GET', '/v1/catalog').kind).toBe('catalog');
    expect(describeDhmCall('GET', '/v1/lookup/vessel/MSMS3002')).toMatchObject({ kind: 'lookup', slug: 'vessel', code: 'MSMS3002' });
    expect(describeDhmCall('POST', '/auth/token').kind).toBe('auth');
  });

  it('does not take a GET on an inbound path for a push', () => {
    expect(describeDhmCall('GET', '/v1/inbound/company').kind).toBe('other');
    expect(describeDhmCall(undefined, undefined).kind).toBe('other');
  });
});

describe('maskSecrets', () => {
  it('masks a dhm_sk_ key wherever it appears in a value', () => {
    const masked = maskSecrets({ a: 'x dhm_sk_AbC123xyz y', nested: [{ k: 'dhm_sk_ZZ9' }] });
    expect(JSON.stringify(masked)).not.toContain('AbC123xyz');
    expect(JSON.stringify(masked)).not.toContain('ZZ9');
    expect(masked.a).toBe('x dhm_sk_*** y');
  });

  it('leaves a value without a key as it is, and null as null', () => {
    expect(maskSecrets({ a: 1, b: 'plain' })).toEqual({ a: 1, b: 'plain' });
    expect(maskSecrets(null)).toBeNull();
  });
});

describe('redactedAuthRequest', () => {
  it('shows the public key as a hint and never the private key', () => {
    const stored = redactedAuthRequest('dhm_pk_abcdefghijklmnop1234');
    expect(stored.privateKey).toBe('***');
    expect(stored.publicKey).toContain('dhm_pk_');
    expect(stored.publicKey).toContain('1234');
    expect(stored.publicKey).not.toContain('abcdefghijklmnop');
  });

  it('hides a key too short to show a hint of', () => {
    expect(redactedAuthRequest('short').publicKey).toBe('*** (5)');
  });
});
