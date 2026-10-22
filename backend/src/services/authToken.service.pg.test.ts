import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { getClient } from '../database/connection';
import {
  completePasswordSetup,
  consumeToken,
  hashToken,
  issueToken,
  peekToken,
  secondsSinceLastToken,
  unusablePasswordHash,
} from './authToken.service';

// bcrypt hashing plus a shared database: 5s is too tight when the whole suite runs at once.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

/** The e-mail link tokens, run in Postgres inside one transaction that is rolled back at the end. */
describe('authToken.service (run in Postgres)', () => {
  let client: PoolClient;
  let userId: string;
  let inactiveUserId: string;

  async function makeUser(email: string, active: boolean): Promise<string> {
    const r = await client.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active, is_first_login)
       VALUES ($1, $1, $2, 'Token Tester', 'SUPPORT', $3, true) RETURNING id`,
      [email, await unusablePasswordHash(), active],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    client = await getClient();
    await client.query('BEGIN');
    userId = await makeUser('token.tester@example.test', true);
    inactiveUserId = await makeUser('token.inactive@example.test', false);
  }, 60_000);

  afterAll(async () => {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('stores only the hash of the token', async () => {
    const { token } = await issueToken(client, userId, 'INVITE');
    const rows = (await client.query('SELECT token_hash FROM user_auth_tokens WHERE user_id = $1', [userId])).rows;
    expect(rows.map((r) => r.token_hash)).toContain(hashToken(token));
    expect(rows.map((r) => r.token_hash)).not.toContain(token);
  });

  it('peek shows who a valid token belongs to without using it', async () => {
    const { token } = await issueToken(client, userId, 'RESET');
    const first = await peekToken(client, token);
    const second = await peekToken(client, token);
    expect(first).toMatchObject({ userId, purpose: 'RESET', email: 'token.tester@example.test' });
    expect(second).not.toBeNull();
  });

  it('a token works once: the second use is refused', async () => {
    const { token } = await issueToken(client, userId, 'RESET');
    expect(await consumeToken(client, token)).toMatchObject({ userId, purpose: 'RESET' });
    expect(await consumeToken(client, token)).toBeNull();
    expect(await peekToken(client, token)).toBeNull();
  });

  it('refuses an unknown or empty token', async () => {
    expect(await consumeToken(client, 'not-a-real-token')).toBeNull();
    expect(await consumeToken(client, '')).toBeNull();
    expect(await peekToken(client, '')).toBeNull();
  });

  it('refuses an expired token', async () => {
    const { token } = await issueToken(client, userId, 'RESET', { ttlSeconds: -5 });
    expect(await peekToken(client, token)).toBeNull();
    expect(await consumeToken(client, token)).toBeNull();
  });

  it('a newer token of the same purpose revokes the older one', async () => {
    const older = await issueToken(client, userId, 'INVITE');
    const newer = await issueToken(client, userId, 'INVITE');
    expect(await peekToken(client, older.token)).toBeNull();
    expect(await peekToken(client, newer.token)).not.toBeNull();
  });

  it('an invitation and a reset link live side by side until one is used', async () => {
    const invite = await issueToken(client, userId, 'INVITE');
    const reset = await issueToken(client, userId, 'RESET');
    expect(await peekToken(client, invite.token)).not.toBeNull();
    expect(await peekToken(client, reset.token)).not.toBeNull();
    // using one spends every other unused link of that user
    expect(await consumeToken(client, reset.token)).not.toBeNull();
    expect(await peekToken(client, invite.token)).toBeNull();
  });

  it('refuses a token of a deactivated account', async () => {
    const { token } = await issueToken(client, inactiveUserId, 'RESET');
    expect(await peekToken(client, token)).toBeNull();
    expect(await consumeToken(client, token)).toBeNull();
  });

  it('completePasswordSetup stores the password, ends first login, and cannot be replayed', async () => {
    const { token } = await issueToken(client, userId, 'INVITE');
    const owner = await completePasswordSetup(client, token, 'my-own-pass');
    expect(owner).toMatchObject({ userId, purpose: 'INVITE' });

    const row = (await client.query('SELECT password_hash, is_first_login, last_password_change FROM users WHERE id = $1', [userId]))
      .rows[0];
    expect(await bcrypt.compare('my-own-pass', row.password_hash)).toBe(true);
    expect(row.is_first_login).toBe(false);
    expect(row.last_password_change).not.toBeNull();

    expect(await completePasswordSetup(client, token, 'another-pass')).toBeNull();
    const after = (await client.query('SELECT password_hash FROM users WHERE id = $1', [userId])).rows[0];
    expect(await bcrypt.compare('my-own-pass', after.password_hash)).toBe(true);
  });

  it('completePasswordSetup changes nothing for a bad token', async () => {
    const before = (await client.query('SELECT password_hash FROM users WHERE id = $1', [userId])).rows[0].password_hash;
    expect(await completePasswordSetup(client, 'bad-token', 'whatever-pass')).toBeNull();
    const after = (await client.query('SELECT password_hash FROM users WHERE id = $1', [userId])).rows[0].password_hash;
    expect(after).toBe(before);
  });

  it('secondsSinceLastToken reports the age of the newest token, or null when there never was one', async () => {
    const other = await makeUser('token.cooldown@example.test', true);
    expect(await secondsSinceLastToken(client, other, 'RESET')).toBeNull();
    await issueToken(client, other, 'RESET');
    const age = await secondsSinceLastToken(client, other, 'RESET');
    expect(age).not.toBeNull();
    expect(age as number).toBeGreaterThanOrEqual(0);
    expect(age as number).toBeLessThan(60);
    expect(await secondsSinceLastToken(client, other, 'INVITE')).toBeNull();
  });

  it('the unusable placeholder hash matches no ordinary password', async () => {
    const hash = await unusablePasswordHash();
    expect(await bcrypt.compare('', hash)).toBe(false);
    expect(await bcrypt.compare('password', hash)).toBe(false);
  });
});
