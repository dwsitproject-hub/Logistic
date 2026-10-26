import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../database/connection', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({
  AuditService: { log: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../services/sessionAuth.service', () => ({
  buildSessionUserPayload: vi.fn(),
  establishSession: vi.fn(),
  loadActiveUserByEmail: vi.fn(),
  loadActiveUserById: vi.fn(),
  saveSession: vi.fn(),
  frontendUrl: () => 'https://klip.example.test',
}));
vi.mock('../services/authEmail.service', () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
  authEmailAppFrom: vi.fn(() => 'klip'),
}));
vi.mock('../services/authToken.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/authToken.service')>()),
  issueToken: vi.fn(),
  peekToken: vi.fn(),
  secondsSinceLastToken: vi.fn(),
  completePasswordSetup: vi.fn(),
}));

import { getClient } from '../database/connection';
import { AuditService } from '../services/audit.service';
import { loadActiveUserByEmail } from '../services/sessionAuth.service';
import { sendPasswordResetEmail } from '../services/authEmail.service';
import { completePasswordSetup, issueToken, peekToken, secondsSinceLastToken } from '../services/authToken.service';
import {
  FORGOT_PASSWORD_MESSAGE,
  INVALID_LINK_MESSAGE,
  forgotPassword,
  setPassword,
  validatePasswordToken,
} from './auth.controller';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(n: number) {
      this.statusCode = n;
      return this;
    },
    json(o: unknown) {
      this.body = o;
      return this;
    },
  };
  return res as unknown as Response & typeof res;
}

function mockReq(body: Record<string, unknown>): Request {
  return { body, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' }, get: () => 'test-agent' } as unknown as Request;
}

const USER = { id: 'user-1', email: 'sari@example.test', full_name: 'Sari Dewi' };

describe('POST /auth/forgot-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LOCAL_LOGIN_ENABLED;
    vi.mocked(issueToken).mockResolvedValue({ token: 'raw-token', expiresAt: new Date() });
    vi.mocked(secondsSinceLastToken).mockResolvedValue(null);
    vi.mocked(sendPasswordResetEmail).mockResolvedValue(true);
  });

  it('answers the same for an unknown e-mail and sends nothing', async () => {
    vi.mocked(loadActiveUserByEmail).mockResolvedValue(null);
    const res = mockRes();
    await forgotPassword(mockReq({ email: 'nobody@example.test' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { message: FORGOT_PASSWORD_MESSAGE } });
    expect(issueToken).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('for a known e-mail gives the identical response, issues a RESET token and e-mails it', async () => {
    vi.mocked(loadActiveUserByEmail).mockResolvedValue(USER);
    const res = mockRes();
    await forgotPassword(mockReq({ email: '  Sari@Example.test ' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { message: FORGOT_PASSWORD_MESSAGE } });
    expect(loadActiveUserByEmail).toHaveBeenCalledWith('sari@example.test');
    expect(issueToken).toHaveBeenCalledWith(expect.anything(), 'user-1', 'RESET');
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      { email: 'sari@example.test', fullName: 'Sari Dewi' },
      'raw-token',
      'klip',
    );
    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'PASSWORD_RESET_REQUESTED', userId: 'user-1' }));
  });

  it('never puts the token in the response', async () => {
    vi.mocked(loadActiveUserByEmail).mockResolvedValue(USER);
    const res = mockRes();
    await forgotPassword(mockReq({ email: USER.email }), res);
    expect(JSON.stringify(res.body)).not.toContain('raw-token');
  });

  it('a second request inside the cooldown answers the same but sends nothing', async () => {
    vi.mocked(loadActiveUserByEmail).mockResolvedValue(USER);
    vi.mocked(secondsSinceLastToken).mockResolvedValue(10);
    const res = mockRes();
    await forgotPassword(mockReq({ email: USER.email }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { message: FORGOT_PASSWORD_MESSAGE } });
    expect(issueToken).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('sends again once the cooldown has passed', async () => {
    vi.mocked(loadActiveUserByEmail).mockResolvedValue(USER);
    vi.mocked(secondsSinceLastToken).mockResolvedValue(61);
    await forgotPassword(mockReq({ email: USER.email }), mockRes());
    expect(issueToken).toHaveBeenCalledTimes(1);
  });

  it('rejects something that is not an e-mail address', async () => {
    for (const email of ['', 'not-an-email', undefined]) {
      const res = mockRes();
      await forgotPassword(mockReq({ email }), res);
      expect(res.statusCode).toBe(400);
    }
    expect(loadActiveUserByEmail).not.toHaveBeenCalled();
  });

  it('is refused when local login is switched off', async () => {
    process.env.LOCAL_LOGIN_ENABLED = 'false';
    const res = mockRes();
    await forgotPassword(mockReq({ email: USER.email }), res);
    expect(res.statusCode).toBe(403);
    expect(loadActiveUserByEmail).not.toHaveBeenCalled();
  });

  afterEach(() => {
    delete process.env.LOCAL_LOGIN_ENABLED;
  });
});

describe('POST /auth/password-token/validate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LOCAL_LOGIN_ENABLED;
  });

  it('says valid with the purpose and name for a usable token', async () => {
    vi.mocked(peekToken).mockResolvedValue({ userId: 'user-1', purpose: 'INVITE', email: USER.email, fullName: 'Sari Dewi' });
    const res = mockRes();
    await validatePasswordToken(mockReq({ token: 'raw-token' }), res);
    expect(res.body).toEqual({
      success: true,
      data: { valid: true, purpose: 'INVITE', full_name: 'Sari Dewi', email: USER.email },
    });
  });

  it('says not valid, and nothing else, for an unusable token', async () => {
    vi.mocked(peekToken).mockResolvedValue(null);
    const res = mockRes();
    await validatePasswordToken(mockReq({ token: 'nope' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { valid: false } });
  });
});

describe('POST /auth/set-password', () => {
  const calls: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      return { rows: [] };
    }),
    release: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    delete process.env.LOCAL_LOGIN_ENABLED;
    vi.mocked(getClient).mockResolvedValue(client as never);
  });

  it('saves the password and commits when the link is good', async () => {
    vi.mocked(completePasswordSetup).mockResolvedValue({
      userId: 'user-1',
      purpose: 'INVITE',
      email: USER.email,
      fullName: 'Sari Dewi',
    });
    const res = mockRes();
    await setPassword(mockReq({ token: 'raw-token', newPassword: 'my-own-pass' }), res);
    expect(res.statusCode).toBe(200);
    expect(completePasswordSetup).toHaveBeenCalledWith(client, 'raw-token', 'my-own-pass');
    expect(calls).toEqual(['BEGIN', 'COMMIT']);
    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ACCOUNT_ACTIVATED', userId: 'user-1' }));
    expect(client.release).toHaveBeenCalled();
  });

  it('audits a reset link as PASSWORD_RESET', async () => {
    vi.mocked(completePasswordSetup).mockResolvedValue({
      userId: 'user-1',
      purpose: 'RESET',
      email: USER.email,
      fullName: null,
    });
    await setPassword(mockReq({ token: 'raw-token', newPassword: 'my-own-pass' }), mockRes());
    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'PASSWORD_RESET' }));
  });

  it('rolls back and refuses a link that is invalid, used or expired', async () => {
    vi.mocked(completePasswordSetup).mockResolvedValue(null);
    const res = mockRes();
    await setPassword(mockReq({ token: 'bad', newPassword: 'my-own-pass' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: { message: INVALID_LINK_MESSAGE } });
    expect(calls).toEqual(['BEGIN', 'ROLLBACK']);
    expect(AuditService.log).not.toHaveBeenCalled();
  });

  it('refuses a password that is too short before touching the database', async () => {
    const res = mockRes();
    await setPassword(mockReq({ token: 'raw-token', newPassword: '12345' }), res);
    expect(res.statusCode).toBe(400);
    expect(completePasswordSetup).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('is refused when local login is switched off', async () => {
    process.env.LOCAL_LOGIN_ENABLED = 'false';
    const res = mockRes();
    await setPassword(mockReq({ token: 'raw-token', newPassword: 'my-own-pass' }), res);
    expect(res.statusCode).toBe(403);
    expect(completePasswordSetup).not.toHaveBeenCalled();
  });

  it('rolls back and answers 500 when saving blows up, and still releases the connection', async () => {
    vi.mocked(completePasswordSetup).mockRejectedValue(new Error('db down'));
    const res = mockRes();
    await setPassword(mockReq({ token: 'raw-token', newPassword: 'my-own-pass' }), res);
    expect(res.statusCode).toBe(500);
    expect(calls).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalled();
  });
});
