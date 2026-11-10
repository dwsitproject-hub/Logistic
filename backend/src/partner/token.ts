import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { deriveSubKey } from '../integrations/secretBox';
import { kmapsKeyVersion } from './config';

/**
 * Partner tokens (KMAPS partner API contract, section 3).
 *
 * Signed with a key derived from INTEGRATION_SECRETS_KEY for this purpose alone - NOT JWT_SECRET. The user middleware (middleware/sessionAuth.ts) accepts
 * any JWT signed with JWT_SECRET, so a partner token signed with it would open every user route. Signed with a different key, a partner token fails there
 * with a bad signature, and a user token fails here the same way: neither kind is accepted by the other's routes, whatever its claims say.
 */
export const PARTNER_AUDIENCE = 'klip-partner';
export const PARTNER_ISSUER = 'klip';
export const PARTNER_SUBJECT = 'kmaps';
export const PARTNER_SCOPE = 'shipments:read';
export const PARTNER_TOKEN_TTL_SECONDS = 3600;

function signingKey(): Buffer | null {
  return deriveSubKey('partner-token-v1');
}

export function issuePartnerToken(): { token: string; expiresIn: number; scope: string } | null {
  const key = signingKey();
  if (!key) return null;
  const token = jwt.sign({ scope: PARTNER_SCOPE, kv: kmapsKeyVersion(), jti: crypto.randomUUID() }, key, {
    algorithm: 'HS256',
    audience: PARTNER_AUDIENCE,
    issuer: PARTNER_ISSUER,
    subject: PARTNER_SUBJECT,
    expiresIn: PARTNER_TOKEN_TTL_SECONDS,
  });
  return { token, expiresIn: PARTNER_TOKEN_TTL_SECONDS, scope: PARTNER_SCOPE };
}

export type PartnerTokenCheck =
  | { ok: true; scope: string[] }
  | { ok: false; reason: 'missing' | 'invalid' | 'unavailable' };

/** True only for an unexpired token this server signed for the partner audience, under the key that is saved right now. */
export function verifyPartnerToken(token: string | undefined): PartnerTokenCheck {
  if (!token) return { ok: false, reason: 'missing' };
  const key = signingKey();
  if (!key) return { ok: false, reason: 'unavailable' };
  try {
    const claims = jwt.verify(token, key, {
      algorithms: ['HS256'],
      audience: PARTNER_AUDIENCE,
      issuer: PARTNER_ISSUER,
      subject: PARTNER_SUBJECT,
    }) as jwt.JwtPayload;
    if (claims.kv !== kmapsKeyVersion()) return { ok: false, reason: 'invalid' };
    return { ok: true, scope: String(claims.scope ?? '').split(/\s+/).filter(Boolean) };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}
