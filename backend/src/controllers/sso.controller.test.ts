import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import type { Request, Response } from 'express';

vi.mock('../database/connection', () => ({
  query: vi.fn(),
}));

vi.mock('../services/audit.service', () => ({
  AuditService: { log: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../services/userAssociations.service', () => ({
  fetchUserScopeAssociations: vi.fn().mockResolvedValue({
    plants: [],
    group_plants: [],
    products: [],
  }),
}));

import { query } from '../database/connection';
import { AuditService } from '../services/audit.service';
import { ssoHubHandler, ssoExchangeHandler } from './sso.controller';

const SSO_SECRET = 'test-sso-shared-secret-at-least-32-chars!!';

function mockRes() {
  const res: Partial<Response> & {
    statusCode: number;
    body: unknown;
    redirectUrl?: string;
  } = {
    statusCode: 200,
    body: null,
    status(n: number) {
      this.statusCode = n;
      return this as Response;
    },
    json(o: unknown) {
      this.body = o;
      return this as Response;
    },
    redirect(this: any, ...args: unknown[]) {
      // support both res.redirect(url) and res.redirect(status, url)
      this.redirectUrl = args.length > 1 ? args[1] : args[0];
      return this as Response;
    },
    send(o: unknown) {
      this.body = o;
      return this as Response;
    },
  };
  return res as unknown as Response & typeof res;
}

function mockReq(body: Record<string, unknown>): Request {
  return {
    body,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    get: () => 'test-agent',
  } as unknown as Request;
}

async function signHubToken(payload: Record<string, unknown>): Promise<string> {
  const secret = new TextEncoder().encode(SSO_SECRET);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret);
}

describe('ssoHubHandler', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(AuditService.log).mockClear();
    process.env.SSO_TOKEN_SECRET = SSO_SECRET;
    process.env.APP_PUBLIC_ORIGIN = 'http://localhost:3001';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'klip-test-jwt-secret-at-least-32-chars!!';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('400 when token missing from body (negative)', async () => {
    const req = mockReq({});
    const res = mockRes();
    await ssoHubHandler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('redirects to sso_not_configured when SSO_TOKEN_SECRET is unset (negative)', async () => {
    delete process.env.SSO_TOKEN_SECRET;
    const req = mockReq({ token: 'anything' });
    const res = mockRes();
    await ssoHubHandler(req, res);
    expect(res.redirectUrl).toContain('error=sso_not_configured');
  });

  it('redirects to sso_failed when the Hub JWT is invalid (negative)', async () => {
    const req = mockReq({ token: 'not-a-valid-jwt' });
    const res = mockRes();
    await ssoHubHandler(req, res);
    expect(res.redirectUrl).toContain('error=sso_failed');
  });

  it('redirects to sso_failed when the Hub JWT is signed with the wrong secret (negative)', async () => {
    const secret = new TextEncoder().encode('wrong-secret-that-does-not-match-at-all!!');
    const badToken = await new SignJWT({ email: 'user@kpn.com', user_id: 'hub-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .sign(secret);
    const req = mockReq({ token: badToken });
    const res = mockRes();
    await ssoHubHandler(req, res);
    expect(res.redirectUrl).toContain('error=sso_failed');
  });

  it('redirects to sso_failed when email/user_id claims are missing (negative)', async () => {
    const token = await signHubToken({ foo: 'bar' });
    const req = mockReq({ token });
    const res = mockRes();
    await ssoHubHandler(req, res);
    expect(res.redirectUrl).toContain('error=sso_failed');
  });

  it('redirects to sso_no_access when the email has no matching active KLIP user (invite-only, negative)', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);
    const token = await signHubToken({ email: 'nouser@kpn.com', user_id: 'hub-1' });
    const req = mockReq({ token });
    const res = mockRes();
    await ssoHubHandler(req, res);
    expect(res.redirectUrl).toContain('error=sso_no_access');
  });

  it('looks up the user case-insensitively by email (positive)', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        {
          id: 'u1',
          username: 'jdoe',
          email: 'JDoe@kpn.com',
          full_name: 'John Doe',
          role: 'LOGISTICS',
          is_active: true,
        },
      ],
    } as never);
    const token = await signHubToken({ email: 'jdoe@kpn.com', user_id: 'hub-1' });
    const req = mockReq({ token });
    const res = mockRes();
    await ssoHubHandler(req, res);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('LOWER(email) = LOWER($1)'), [
      'jdoe@kpn.com',
    ]);
  });

  it('mints a session, logs SSO_LOGIN, and redirects to the frontend callback with a one-time code (positive)', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        {
          id: 'u1',
          username: 'jdoe',
          email: 'jdoe@kpn.com',
          full_name: 'John Doe',
          role: 'LOGISTICS',
          is_active: true,
        },
      ],
    } as never);
    const token = await signHubToken({ email: 'jdoe@kpn.com', user_id: 'hub-1' });
    const req = mockReq({ token });
    const res = mockRes();
    await ssoHubHandler(req, res);

    expect(AuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', action: 'SSO_LOGIN', entityType: 'USER' }),
    );
    expect(res.redirectUrl).toMatch(/^http:\/\/localhost:3001\/sso\/callback\?code=.+/);
  });
});

describe('ssoExchangeHandler', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    process.env.SSO_TOKEN_SECRET = SSO_SECRET;
    process.env.APP_PUBLIC_ORIGIN = 'http://localhost:3001';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'klip-test-jwt-secret-at-least-32-chars!!';
  });

  it('400 when code missing (negative)', async () => {
    const req = mockReq({});
    const res = mockRes();
    await ssoExchangeHandler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('400 when code is unknown/expired (negative)', async () => {
    const req = mockReq({ code: 'does-not-exist' });
    const res = mockRes();
    await ssoExchangeHandler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('exchanges a valid one-time code for the same payload shape as /api/auth/login, then invalidates it (positive)', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        {
          id: 'u1',
          username: 'jdoe',
          email: 'jdoe@kpn.com',
          full_name: 'John Doe',
          role: 'LOGISTICS',
          is_active: true,
        },
      ],
    } as never);
    const hubToken = await signHubToken({ email: 'jdoe@kpn.com', user_id: 'hub-1' });
    const hubReq = mockReq({ token: hubToken });
    const hubRes = mockRes();
    await ssoHubHandler(hubReq, hubRes);

    const code = new URL(hubRes.redirectUrl as string).searchParams.get('code');
    expect(code).toBeTruthy();

    const exchangeReq = mockReq({ code });
    const exchangeRes = mockRes();
    await ssoExchangeHandler(exchangeReq, exchangeRes);

    expect(exchangeRes.statusCode).toBe(200);
    const body = exchangeRes.body as {
      success: boolean;
      data: { user: { email: string }; token: string; requirePasswordChange: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe('jdoe@kpn.com');
    expect(typeof body.data.token).toBe('string');
    expect(body.data.requirePasswordChange).toBe(false);

    // Single-use: exchanging the same code again must fail.
    const secondRes = mockRes();
    await ssoExchangeHandler(mockReq({ code }), secondRes);
    expect(secondRes.statusCode).toBe(400);
  });
});
