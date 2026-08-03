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
  buildSessionUserPayload: vi.fn(),
  establishSession: vi.fn(),
  frontendUrl: vi.fn(() => 'http://localhost:3001'),
  loadActiveUserByEmail: vi.fn(),
  persistHubOidcSub: vi.fn().mockResolvedValue(undefined),
}));

import { isOidcConfigured, exchangeAuthorizationCode, verifyIdToken } from '../services/oidc.service';
import { establishSession, loadActiveUserByEmail } from '../services/sessionAuth.service';
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

    expect(exchangeAuthorizationCode).toHaveBeenCalledWith({
      code: 'abc',
      codeVerifier: 'hub-verifier',
    });
    expect(establishSession).toHaveBeenCalledWith(req, 'u1');
    expect(res.statusCode).toBe(303);
    expect(res.redirectUrl).toBe('http://localhost:3001');
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
});
