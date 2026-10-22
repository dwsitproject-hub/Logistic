import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { QueryResult } from 'pg';

/**
 * One-time e-mail links that let a user set their own password (table `user_auth_tokens`, migration 247):
 * INVITE for a new account, RESET for "forgot password" or an admin-sent reset.
 *
 * The raw token only ever exists in the e-mail link. The database keeps its SHA-256, so reading the table gives nobody a usable link.
 * Every function takes the connection to run on, so a caller can put a token and the password change in one transaction (and a test can
 * roll the lot back).
 */
export type AuthTokenPurpose = 'INVITE' | 'RESET';

export const INVITE_TTL_HOURS = 72;
export const RESET_TTL_MINUTES = 60;
/** A second "forgot password" request for the same account inside this window sends nothing. */
export const RESET_REQUEST_COOLDOWN_SECONDS = 60;
export const MIN_PASSWORD_LENGTH = 6;

export interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<QueryResult>;
}

export function tokenTtlSeconds(purpose: AuthTokenPurpose): number {
  return purpose === 'INVITE' ? INVITE_TTL_HOURS * 3600 : RESET_TTL_MINUTES * 60;
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

/** A password hash nobody knows the password of: the placeholder an invited user holds until they open the link. */
export async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
}

/**
 * Create a token for the user. Any earlier unused token of the same purpose is revoked first, so only the newest link works
 * (a re-sent invitation or a second reset request replaces the first one).
 */
export async function issueToken(
  db: Queryable,
  userId: string,
  purpose: AuthTokenPurpose,
  options: { ttlSeconds?: number } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const ttlSeconds = options.ttlSeconds ?? tokenTtlSeconds(purpose);
  const token = crypto.randomBytes(32).toString('base64url');

  await db.query(
    `UPDATE user_auth_tokens SET used_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
    [userId, purpose],
  );
  const inserted = await db.query(
    `INSERT INTO user_auth_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP + make_interval(secs => $4::double precision))
     RETURNING expires_at`,
    [userId, purpose, hashToken(token), ttlSeconds],
  );
  return { token, expiresAt: new Date(inserted.rows[0].expires_at as string) };
}

export interface PendingToken {
  userId: string;
  purpose: AuthTokenPurpose;
  email: string;
  fullName: string | null;
}

/** Look at a token without using it: valid only while unused, unexpired and the account is active. */
export async function peekToken(db: Queryable, rawToken: string): Promise<PendingToken | null> {
  if (!rawToken) return null;
  const result = await db.query(
    `SELECT t.user_id, t.purpose, u.email, u.full_name
     FROM user_auth_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > CURRENT_TIMESTAMP AND u.is_active = true`,
    [hashToken(rawToken)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    userId: String(row.user_id),
    purpose: row.purpose as AuthTokenPurpose,
    email: String(row.email),
    fullName: (row.full_name as string | null) ?? null,
  };
}

/**
 * Use a token: one atomic UPDATE, so two requests with the same link cannot both win. Returns who it belonged to, or null when it is
 * unknown, already used, expired or the account is inactive. Everything else still unused for that user is revoked too.
 */
export async function consumeToken(db: Queryable, rawToken: string): Promise<PendingToken | null> {
  if (!rawToken) return null;
  const used = await db.query(
    `UPDATE user_auth_tokens t SET used_at = CURRENT_TIMESTAMP
     FROM users u
     WHERE u.id = t.user_id AND u.is_active = true
       AND t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > CURRENT_TIMESTAMP
     RETURNING t.user_id, t.purpose, u.email, u.full_name`,
    [hashToken(rawToken)],
  );
  const row = used.rows[0];
  if (!row) return null;
  await db.query(
    `UPDATE user_auth_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL`,
    [row.user_id],
  );
  return {
    userId: String(row.user_id),
    purpose: row.purpose as AuthTokenPurpose,
    email: String(row.email),
    fullName: (row.full_name as string | null) ?? null,
  };
}

/** Seconds since the newest token of this purpose was made for the user, or null when there never was one. */
export async function secondsSinceLastToken(
  db: Queryable,
  userId: string,
  purpose: AuthTokenPurpose,
): Promise<number | null> {
  const result = await db.query(
    `SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(created_at)))::double precision AS age
     FROM user_auth_tokens WHERE user_id = $1 AND purpose = $2`,
    [userId, purpose],
  );
  const age = result.rows[0]?.age;
  return age === null || age === undefined ? null : Number(age);
}

/**
 * Finish a password setup: spend the token and store the new password, in the caller's transaction. A user who opens an invitation or
 * a reset link has proven they read that mailbox, so the account is no longer "first login" afterwards.
 * Returns null (and changes nothing) when the token is not usable.
 */
export async function completePasswordSetup(
  db: Queryable,
  rawToken: string,
  newPassword: string,
): Promise<PendingToken | null> {
  const owner = await consumeToken(db, rawToken);
  if (!owner) return null;
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.query(
    `UPDATE users
     SET password_hash = $1, is_first_login = false, last_password_change = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [passwordHash, owner.userId],
  );
  return owner;
}
