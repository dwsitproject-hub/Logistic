import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtVerify } from 'jose';

vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return { ...actual, jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => vi.fn()) };
});
vi.mock('../utils/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import {
  exchangeAuthorizationCode,
  getOidcConfig,
  isOidcConfigured,
  resetOidcCacheForTests,
  verifyIdToken,
} from './oidc.service';

const DISCOVERY = {
  issuer: 'https://hub.example/sso',
  authorization_endpoint: 'https://hub.example/sso/authorize',
  token_endpoint: 'https://hub.example/sso/token',
  jwks_uri: 'https://hub.example/sso/jwks',
};

/** Commercial Documents is its own Hub application: its own client id and redirect URI, on its own domain. */
describe('oidc.service: the Commercial Documents application', () => {
  const env = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetOidcCacheForTests();
    vi.mocked(jwtVerify).mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.OIDC_DISCOVERY_URL = `${DISCOVERY.issuer}/.well-known/openid-configuration`;
    process.env.OIDC_CLIENT_ID = 'logistic';
    process.env.OIDC_REDIRECT_URI = 'http://test-klip.kpndomain.com/auth/oidc/callback';
    process.env.COMMDOCS_URL = 'http://test-commercial-docs.kpndomain.com';
    process.env.OIDC_COMMDOCS_CLIENT_ID = 'commdocs';
    delete process.env.OIDC_COMMDOCS_REDIRECT_URI;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes('openid-configuration')) return { ok: true, json: async () => DISCOVERY };
      if (href.includes('/token')) return { ok: true, text: async () => JSON.stringify({ id_token: 'ey.test' }) };
      throw new Error(`Unexpected fetch: ${href}`);
    });
  });

  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it('has its own client id, and a redirect URI on its own domain by default', () => {
    expect(getOidcConfig('commdocs')).toMatchObject({
      clientId: 'commdocs',
      redirectUri: 'http://test-commercial-docs.kpndomain.com/auth/oidc/callback',
    });
    // KLIP is untouched
    expect(getOidcConfig()).toMatchObject({ clientId: 'logistic', redirectUri: 'http://test-klip.kpndomain.com/auth/oidc/callback' });
  });

  it('an explicit OIDC_COMMDOCS_REDIRECT_URI wins over the default', () => {
    process.env.OIDC_COMMDOCS_REDIRECT_URI = 'https://commercial-docs.kpndomain.com/auth/oidc/callback';
    expect(getOidcConfig('commdocs').redirectUri).toBe('https://commercial-docs.kpndomain.com/auth/oidc/callback');
  });

  it('falls back to the KLIP client id when none is set (one Hub application holding both domains)', () => {
    delete process.env.OIDC_COMMDOCS_CLIENT_ID;
    expect(getOidcConfig('commdocs').clientId).toBe('logistic');
  });

  it('is configured only with a discovery URL and a redirect URI to send the user back to', () => {
    expect(isOidcConfigured('commdocs')).toBe(true);
    delete process.env.COMMDOCS_URL;
    expect(isOidcConfigured('commdocs')).toBe(false); // nowhere to come back to
    expect(isOidcConfigured('klip')).toBe(true); // KLIP does not depend on it
    process.env.COMMDOCS_URL = 'http://test-commercial-docs.kpndomain.com';
    delete process.env.OIDC_DISCOVERY_URL;
    expect(isOidcConfigured('commdocs')).toBe(false);
  });

  it('KLIP being unconfigured does not switch Commercial Documents off', () => {
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_REDIRECT_URI;
    expect(isOidcConfigured('klip')).toBe(false);
    expect(isOidcConfigured('commdocs')).toBe(true);
  });

  it('the token exchange carries the Commercial Documents client id and redirect URI', async () => {
    await exchangeAuthorizationCode({ code: 'c', codeVerifier: 'v' }, 'commdocs');
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/token'));
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      client_id: 'commdocs',
      redirect_uri: 'http://test-commercial-docs.kpndomain.com/auth/oidc/callback',
      code: 'c',
      code_verifier: 'v',
    });
  });

  it('the id_token is checked against the Commercial Documents client id as its audience', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { sub: 'hub-1', email: 'A@B.com' } } as never);
    await verifyIdToken('ey.test', undefined, 'commdocs');
    expect(vi.mocked(jwtVerify).mock.calls[0][2]).toMatchObject({ audience: 'commdocs', issuer: DISCOVERY.issuer });
  });
});
