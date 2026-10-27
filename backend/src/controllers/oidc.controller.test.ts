import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../database/connection', () => ({
  query: vi.fn(),
}));

vi.mock('../services/audit.service', () => ({
  AuditService: { log: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../services/oidc.service', () => ({
  isOidcConfigured: vi.fn(),
  fetchDiscoveryMetadata: vi.fn(),
  getOidcConfig: vi.fn(),
  generateOidcState: vi.fn(() => 'state-1'),
  generateOidcNonce: vi.fn(() => 'nonce-1'),
  generatePkcePair: vi.fn(() => ({ codeVerifier: 'verifier-1', codeChallenge: 'challenge-1' })),
  buildAuthorizeUrl: vi.fn(() => 'https://hub.example/authorize'),
  exchangeAuthorizationCode: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock('../services/sessionAuth.service', () => ({
  commdocsUrl: vi.fn(() => null),
  buildSessionUserPayload: vi.fn(),
  establishSession: vi.fn(),
  frontendUrl: vi.fn(() => 'http://localhost:3001'),
  loadActiveUserByEmail: vi.fn(),
  persistHubOidcSub: vi.fn().mockResolvedValue(undefined),
  saveSession: vi.fn().mockResolvedValue(undefined),
}));

import { isOidcConfigured, exchangeAuthorizationCode, getOidcConfig, verifyIdToken } from '../services/oidc.service';
import { commdocsUrl, establishSession, loadActiveUserByEmail, saveSession } from '../services/sessionAuth.service';
import { oidcCallbackHandler, oidcLoginHandler } from './oidc.controller';

function mockRes() {
  const res: Partial<Response> & { statusCode: number; redirectUrl?: string; body?: unknown } = {
    statusCode: 200,
    status(n: number) {
      this.statusCode = n;
      return this as Response;
    },
    json(o: unknown) {
      this.body = o;
      return this as Response;
    },
    redirect(this: any, ...args: unknown[]) {
      this.statusCode = args.length > 1 ? (args[0] as number) : 302;
      this.redirectUrl = args.length > 1 ? args[1] : args[0];
      return this as Response;
    },
  };
  return res as unknown as Response & typeof res;
}

describe('oidc.controller', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.mocked(isOidcConfigured).mockReturnValue(true);
    vi.mocked(loadActiveUserByEmail).mockReset();
    vi.mocked(exchangeAuthorizationCode).mockReset();
    vi.mocked(verifyIdToken).mockReset();
    vi.mocked(establishSession).mockReset();
    process.env.FRONTEND_URL = 'http://localhost:3001';
    process.env.JWT_SECRET = 'test-jwt-secret-for-oidc';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns 503 when OIDC is not configured', async () => {
    vi.mocked(isOidcConfigured).mockReturnValue(false);
    const req = { query: {} } as Request;
    const res = mockRes();
    await oidcLoginHandler(req, res);
    expect(res.statusCode).toBe(503);
  });

  it('redirects to Hub authorize URL on SP-initiated login', async () => {
    const req = { session: {} } as Request;
    const res = mockRes();
    await oidcLoginHandler(req, res);
    expect(saveSession).toHaveBeenCalledWith(req);
    expect(res.redirectUrl).toBe('https://hub.example/authorize');
    expect(req.session?.oidcState).toBe('state-1');
    expect(req.session?.oidcCodeVerifier).toBe('verifier-1');
  });

  it('303 redirect to frontend after successful IdP-initiated callback', async () => {
    vi.mocked(exchangeAuthorizationCode).mockResolvedValue({ idToken: 'id.jwt' });
    vi.mocked(verifyIdToken).mockResolvedValue({ sub: 'hub-1', email: 'user@kpn.com' });
    vi.mocked(loadActiveUserByEmail).mockResolvedValue({
      id: 'u1',
      username: 'jdoe',
      email: 'user@kpn.com',
      full_name: 'John',
      role: 'LOGISTICS',
      is_active: true,
    });

    const req = {
      query: { code: 'abc', code_verifier: 'hub-verifier' },
      session: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      get: () => 'test',
    } as unknown as Request;
    const res = mockRes();

    await oidcCallbackHandler(req, res);

    expect(exchangeAuthorizationCode).toHaveBeenCalledWith(
      {
        code: 'abc',
        codeVerifier: 'hub-verifier',
      },
      'klip',
    );
    expect(establishSession).toHaveBeenCalledWith(req, 'u1');
    expect(res.statusCode).toBe(303);
    expect(String(res.redirectUrl)).toMatch(/^http:\/\/localhost:3001\/sso\/callback\?t=/);
  });

  it('redirects to sso_no_access when email is not invite-only registered', async () => {
    vi.mocked(exchangeAuthorizationCode).mockResolvedValue({ idToken: 'id.jwt' });
    vi.mocked(verifyIdToken).mockResolvedValue({ sub: 'hub-1', email: 'unknown@kpn.com' });
    vi.mocked(loadActiveUserByEmail).mockResolvedValue(null);

    const req = {
      query: { code: 'abc', code_verifier: 'hub-verifier' },
      session: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      get: () => 'test',
    } as unknown as Request;
    const res = mockRes();

    await oidcCallbackHandler(req, res);

    expect(res.redirectUrl).toContain('error=sso_no_access');
  });

  describe('on the Commercial Documents domain', () => {
    const commdocsReq = (extra: Record<string, unknown> = {}) =>
      ({
        headers: { host: 'test-commercial-docs.kpndomain.com' },
        query: { code: 'abc', code_verifier: 'hub-verifier' },
        session: {},
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
        get: () => 'test',
        ...extra,
      }) as unknown as Request;

    beforeEach(() => {
      process.env.COMMDOCS_URL = 'http://test-commercial-docs.kpndomain.com';
      vi.mocked(commdocsUrl).mockReturnValue('http://test-commercial-docs.kpndomain.com');
    });

    it('checks and starts the Commercial Documents application, not KLIP', async () => {
      const res = mockRes();
      await oidcLoginHandler(commdocsReq({ query: {} }), res);
      expect(isOidcConfigured).toHaveBeenCalledWith('commdocs');
      expect(getOidcConfig).toHaveBeenCalledWith('commdocs');
    });

    it('lands the user back on the Commercial Documents domain, with its token', async () => {
      vi.mocked(exchangeAuthorizationCode).mockResolvedValue({ idToken: 'id.jwt' });
      vi.mocked(verifyIdToken).mockResolvedValue({ sub: 'hub-1', email: 'user@kpn.com' });
      vi.mocked(loadActiveUserByEmail).mockResolvedValue({
        id: 'u1',
        username: 'jdoe',
        email: 'user@kpn.com',
        full_name: 'John',
        role: 'LOGISTICS',
        is_active: true,
      });
      const res = mockRes();
      await oidcCallbackHandler(commdocsReq(), res);
      expect(exchangeAuthorizationCode).toHaveBeenCalledWith({ code: 'abc', codeVerifier: 'hub-verifier' }, 'commdocs');
      expect(verifyIdToken).toHaveBeenCalledWith('id.jwt', undefined, 'commdocs');
      expect(res.statusCode).toBe(303);
      expect(String(res.redirectUrl)).toMatch(/^http:\/\/test-commercial-docs\.kpndomain\.com\/sso\/callback\?t=/);
    });

    it("sends a refused account to the Commercial Documents login page, not KLIP's", async () => {
      vi.mocked(exchangeAuthorizationCode).mockResolvedValue({ idToken: 'id.jwt' });
      vi.mocked(verifyIdToken).mockResolvedValue({ sub: 'hub-1', email: 'unknown@kpn.com' });
      vi.mocked(loadActiveUserByEmail).mockResolvedValue(null);
      const res = mockRes();
      await oidcCallbackHandler(commdocsReq(), res);
      expect(res.redirectUrl).toBe('http://test-commercial-docs.kpndomain.com/login?error=sso_no_access');
    });

    it('answers 503 for this app only when ITS client is not configured', async () => {
      vi.mocked(isOidcConfigured).mockImplementation((app?: string) => app !== 'commdocs');
      const res = mockRes();
      await oidcLoginHandler(commdocsReq({ query: {} }), res);
      expect(res.statusCode).toBe(503);
    });
  });
});
