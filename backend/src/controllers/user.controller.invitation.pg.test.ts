import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import type { Response } from 'express';

/**
 * User Management creates accounts without a password and mails an invitation; reset and resend only mail a link.
 * Run in Postgres: the controller's connection (and its pool `query`) are both routed to one test transaction, whose BEGIN / COMMIT
 * become savepoints, and which is rolled back at the end. E-mail and audit are mocked.
 */
const state: { client: PoolClient | null } = { client: null };

function savepointClient(real: PoolClient): PoolClient {
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'query') {
        return (text: unknown, params?: unknown[]) => {
          const sql = typeof text === 'string' ? text.trim().toUpperCase() : '';
          if (sql === 'BEGIN') return target.query('SAVEPOINT controller_tx');
          if (sql === 'COMMIT') return target.query('RELEASE SAVEPOINT controller_tx');
          if (sql === 'ROLLBACK') return target.query('ROLLBACK TO SAVEPOINT controller_tx');
          return (target.query as (...args: unknown[]) => unknown)(text, params);
        };
      }
      if (prop === 'release') return () => undefined;
      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

vi.mock('../database/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../database/connection')>()),
  getClient: async () => savepointClient(state.client as PoolClient),
  query: (text: string, params?: unknown[]) => (state.client as PoolClient).query(text, params),
}));
vi.mock('../services/audit.service', () => ({
  AuditService: { log: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../services/authEmail.service', () => ({
  sendInvitationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  authEmailAppFrom: vi.fn(() => 'klip'),
}));

import { AuditService } from '../services/audit.service';
import { sendInvitationEmail, sendPasswordResetEmail } from '../services/authEmail.service';
import { hashToken, issueToken, unusablePasswordHash } from '../services/authToken.service';
import { createUser, resendInvitation, resetUserPassword } from './user.controller';
import type { AuthRequest } from '../middleware/auth';

// Every test hashes a password with bcrypt; in a full run the suite shares one busy CPU and database, so 5s is too tight.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as any,
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

function req(extra: Record<string, unknown>): AuthRequest {
  return {
    params: {},
    body: {},
    user: { id: ADMIN_ID, username: 'admin@example.test', email: 'admin@example.test', role: 'ADMIN' },
    ip: '127.0.0.1',
    get: () => 'test-agent',
    ...extra,
  } as unknown as AuthRequest;
}

let ADMIN_ID = '';

describe('User Management invitations (run in Postgres)', () => {
  let realClient: PoolClient;

  async function insertUser(email: string, opts: { firstLogin: boolean; active?: boolean; password?: string }): Promise<string> {
    const hash = opts.password ? await bcrypt.hash(opts.password, 10) : await unusablePasswordHash();
    const r = await state.client!.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active, is_first_login)
       VALUES ($1, $1, $2, 'Fixture User', 'SUPPORT', $3, $4) RETURNING id`,
      [email, hash, opts.active ?? true, opts.firstLogin],
    );
    return r.rows[0].id as string;
  }

  async function tokensOf(userId: string, purpose: string) {
    return (
      await state.client!.query(
        'SELECT token_hash, used_at FROM user_auth_tokens WHERE user_id = $1 AND purpose = $2 ORDER BY created_at, id',
        [userId, purpose],
      )
    ).rows as Array<{ token_hash: string; used_at: string | null }>;
  }

  beforeAll(async () => {
    // The module is mocked above (its getClient hands out the test transaction), so the real connection comes from the original.
    const actual = await vi.importActual<typeof import('../database/connection')>('../database/connection');
    realClient = await actual.getClient();
    await realClient.query('BEGIN');
    state.client = realClient;
    ADMIN_ID = await insertUser('invite.admin@example.test', { firstLogin: false, password: 'admin-pass-1' });
  }, 60_000);

  afterAll(async () => {
    try {
      await realClient.query('ROLLBACK');
    } finally {
      realClient.release();
    }
  });

  beforeEach(() => {
    vi.mocked(sendInvitationEmail).mockReset().mockResolvedValue(true);
    vi.mocked(sendPasswordResetEmail).mockReset().mockResolvedValue(true);
    vi.mocked(AuditService.log).mockClear();
  });

  describe('createUser', () => {
    const body = { email: 'New.Person@Example.test', full_name: 'New Person', role: 'SUPPORT' };

    it('creates the account without a password, with a pending first login, and mails an invitation', async () => {
      const res = mockRes();
      await createUser(req({ body }), res);

      expect(res.statusCode).toBe(201);
      expect(res.body.data).toMatchObject({ email: 'new.person@example.test', is_first_login: true, invitation_sent: true });
      expect(res.body.data).not.toHaveProperty('password_hash');

      const userId = res.body.data.id as string;
      const invites = await tokensOf(userId, 'INVITE');
      expect(invites).toHaveLength(1);
      expect(invites[0].used_at).toBeNull();

      expect(sendInvitationEmail).toHaveBeenCalledTimes(1);
      const [recipient, rawToken] = vi.mocked(sendInvitationEmail).mock.calls[0];
      expect(recipient).toEqual({ email: 'new.person@example.test', fullName: 'New Person' });
      expect(hashToken(rawToken)).toBe(invites[0].token_hash);
      expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_INVITED', entityId: userId }));
    });

    it('ignores a password in the request: nobody can sign in with it', async () => {
      const res = mockRes();
      await createUser(req({ body: { ...body, email: 'sneaky@example.test', password: 'hunter2hunter2' } }), res);
      expect(res.statusCode).toBe(201);
      const row = (await state.client!.query('SELECT password_hash FROM users WHERE id = $1', [res.body.data.id])).rows[0];
      expect(await bcrypt.compare('hunter2hunter2', row.password_hash)).toBe(false);
    });

    it('still creates the user when the e-mail cannot be sent, and says so', async () => {
      vi.mocked(sendInvitationEmail).mockResolvedValue(false);
      const res = mockRes();
      await createUser(req({ body: { ...body, email: 'no.smtp@example.test' } }), res);
      expect(res.statusCode).toBe(201);
      expect(res.body.data.invitation_sent).toBe(false);
      const found = await state.client!.query('SELECT 1 FROM users WHERE email = $1', ['no.smtp@example.test']);
      expect(found.rowCount).toBe(1);
    });

    it('refuses a duplicate e-mail without sending anything', async () => {
      const res = mockRes();
      await createUser(req({ body: { ...body, email: 'invite.admin@example.test' } }), res);
      expect(res.statusCode).toBe(400);
      expect(sendInvitationEmail).not.toHaveBeenCalled();
    });
  });

  describe('resendInvitation', () => {
    it('replaces the earlier link and mails a new one to a pending user', async () => {
      const userId = await insertUser('pending.user@example.test', { firstLogin: true });
      await issueToken(state.client!, userId, 'INVITE');

      const res = mockRes();
      await resendInvitation(req({ params: { id: userId } }), res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual({ email: 'pending.user@example.test', email_sent: true });
      // Both tokens are made in this one test transaction, so their created_at is identical: tell them apart by used_at, not by order.
      const tokens = await tokensOf(userId, 'INVITE');
      expect(tokens).toHaveLength(2);
      const open = tokens.filter((t) => t.used_at === null);
      expect(open).toHaveLength(1);
      expect(tokens.filter((t) => t.used_at !== null)).toHaveLength(1);
      expect(hashToken(vi.mocked(sendInvitationEmail).mock.calls[0][1])).toBe(open[0].token_hash);
    });

    it('refuses a user who already has a password', async () => {
      const userId = await insertUser('active.user@example.test', { firstLogin: false, password: 'secret-pass-1' });
      const res = mockRes();
      await resendInvitation(req({ params: { id: userId } }), res);
      expect(res.statusCode).toBe(400);
      expect(sendInvitationEmail).not.toHaveBeenCalled();
    });

    it('refuses a deactivated user and an unknown user', async () => {
      const inactive = await insertUser('inactive.user@example.test', { firstLogin: true, active: false });
      const a = mockRes();
      await resendInvitation(req({ params: { id: inactive } }), a);
      expect(a.statusCode).toBe(400);

      const b = mockRes();
      await resendInvitation(req({ params: { id: '00000000-0000-4000-8000-000000000000' } }), b);
      expect(b.statusCode).toBe(404);
      expect(sendInvitationEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetUserPassword', () => {
    it('mails a reset link and leaves the current password working', async () => {
      const userId = await insertUser('reset.me@example.test', { firstLogin: false, password: 'still-works-1' });
      const before = (await state.client!.query('SELECT password_hash FROM users WHERE id = $1', [userId])).rows[0].password_hash;

      const res = mockRes();
      await resetUserPassword(req({ params: { id: userId }, body: { newPassword: 'ignored-by-server' } }), res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual({ email: 'reset.me@example.test', email_sent: true });
      const row = (await state.client!.query('SELECT password_hash, is_first_login FROM users WHERE id = $1', [userId])).rows[0];
      expect(row.password_hash).toBe(before);
      expect(row.is_first_login).toBe(false);
      expect(await bcrypt.compare('still-works-1', row.password_hash)).toBe(true);

      const resets = await tokensOf(userId, 'RESET');
      expect(resets).toHaveLength(1);
      expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      expect(hashToken(vi.mocked(sendPasswordResetEmail).mock.calls[0][1])).toBe(resets[0].token_hash);
    });

    it('reports when the e-mail could not be sent', async () => {
      const userId = await insertUser('reset.nosmtp@example.test', { firstLogin: false, password: 'still-works-2' });
      vi.mocked(sendPasswordResetEmail).mockResolvedValue(false);
      const res = mockRes();
      await resetUserPassword(req({ params: { id: userId } }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.email_sent).toBe(false);
    });
  });
});
