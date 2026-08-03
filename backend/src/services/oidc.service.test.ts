import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { jwtVerify } from 'jose';

vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return {
    ...actual,
    jwtVerify: vi.fn(),
    createRemoteJWKSet: vi.fn(() => vi.fn()),
  };
});

vi.mock('../utils/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  fetchDiscoveryMetadata,
  generatePkcePair,
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

const mockedJwtVerify = vi.mocked(jwtVerify);

describe('oidc.service', () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetOidcCacheForTests();
    mockedJwtVerify.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.OIDC_DISCOVERY_URL = `${DISCOVERY.issuer}/.well-known/openid-configuration`;
    process.env.OIDC_CLIENT_ID = 'logistic';
    process.env.OIDC_REDIRECT_URI = 'http://test-klip.example/auth/oidc/callback';
    process.env.OIDC_SCOPES = 'openid email profile';
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const href =
        input instanceof URL
          ? input.href
          : typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
      if (href.includes('openid-configuration')) {
        return { ok: true, json: async () => DISCOVERY };
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('isOidcConfigured is true when required env vars are set', () => {
    expect(isOidcConfigured()).toBe(true);
  });

  it('isOidcConfigured is false when OIDC_DISCOVERY_URL is missing', () => {
    delete process.env.OIDC_DISCOVERY_URL;
    expect(isOidcConfigured()).toBe(false);
  });

  it('generatePkcePair produces an S256 code challenge', () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    const expected = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    expect(codeChallenge).toBe(expected);
  });

  it('buildAuthorizeUrl includes PKCE S256 parameters', () => {
    const url = buildAuthorizeUrl({
      metadata: DISCOVERY,
      config: getOidcConfig(),
      state: 'state123',
      nonce: 'nonce456',
      codeChallenge: 'challenge789',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(DISCOVERY.authorization_endpoint);
    expect(parsed.searchParams.get('client_id')).toBe('logistic');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge789');
    expect(parsed.searchParams.get('state')).toBe('state123');
  });

  it('exchangeAuthorizationCode POSTs JSON body (not form-urlencoded)', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const href =
        input instanceof URL
          ? input.href
          : typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
      if (href.includes('openid-configuration')) {
        return { ok: true, json: async () => DISCOVERY };
      }
      if (href.includes('token')) {
        return {
          ok: true,
          text: async () => JSON.stringify({ id_token: 'ey.test', access_token: 'at' }),
        };
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });

    const result = await exchangeAuthorizationCode({
      code: 'auth-code',
      codeVerifier: 'verifier-from-hub',
    });

    expect(result.idToken).toBe('ey.test');
    expect(result.accessToken).toBe('at');

    const tokenCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('token'));
    expect(tokenCall?.[1]?.method).toBe('POST');
    expect(tokenCall?.[1]?.headers).toMatchObject({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    const body = JSON.parse(String(tokenCall?.[1]?.body));
    expect(body).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code',
      redirect_uri: 'http://test-klip.example/auth/oidc/callback',
      client_id: 'logistic',
      code_verifier: 'verifier-from-hub',
    });
    expect(body.client_secret).toBeUndefined();
  });

  it('verifyIdToken rejects wrong audience via jwtVerify', async () => {
    mockedJwtVerify.mockRejectedValue(new Error('unexpected "aud" claim value'));

    await expect(verifyIdToken('fake.token')).rejects.toThrow(/aud/i);
    expect(mockedJwtVerify).toHaveBeenCalledWith(
      'fake.token',
      expect.any(Function),
      expect.objectContaining({
        issuer: DISCOVERY.issuer,
        audience: 'logistic',
      }),
    );
  });

  it('verifyIdToken rejects expired token via jwtVerify', async () => {
    mockedJwtVerify.mockRejectedValue(new Error('"exp" claim timestamp check failed'));

    await expect(verifyIdToken('expired.token')).rejects.toThrow(/exp/i);
  });

  it('verifyIdToken returns normalized sub and email on valid token', async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'hub-sub-42', email: 'User@KPN.com', nonce: 'nonce-abc' },
      protectedHeader: { alg: 'RS256' },
    } as Awaited<ReturnType<typeof jwtVerify>>);

    const claims = await verifyIdToken('valid.token', 'nonce-abc');
    expect(claims.sub).toBe('hub-sub-42');
    expect(claims.email).toBe('user@kpn.com');
  });

  it('verifyIdToken rejects nonce mismatch on SP-initiated path', async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'hub-sub-1', email: 'user@kpn.com', nonce: 'wrong-nonce' },
      protectedHeader: { alg: 'RS256' },
    } as Awaited<ReturnType<typeof jwtVerify>>);

    await expect(verifyIdToken('valid.token', 'expected-nonce')).rejects.toThrow(/nonce/i);
  });

  it('fetchDiscoveryMetadata caches discovery document', async () => {
    const first = await fetchDiscoveryMetadata();
    const second = await fetchDiscoveryMetadata();
    expect(first.issuer).toBe(DISCOVERY.issuer);
    expect(second.token_endpoint).toBe(DISCOVERY.token_endpoint);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
