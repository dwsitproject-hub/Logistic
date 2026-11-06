import crypto from 'crypto';

/**
 * One-way storage for a credential KLIP only has to CHECK, never use.
 *
 * Every other integration secret (DHM_PRIVATE_KEY, JPS_API_KEY, ...) is something KLIP presents to another system, so it has to be readable again and is sealed
 * with AES-GCM (secretBox.ts). The KMAPS private key is the opposite: KMAPS presents it to KLIP, so KLIP keeps a scrypt hash and a database dump plus the
 * master key still do not reveal it (KMAPS partner API contract, section 3.1: "KLIP stores only a hash").
 *
 * Format: `scrypt$<N>$<salt b64>$<hash b64>`. The cost is in the string, so it can be raised later without breaking the keys already stored.
 */
const N = 16384;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

function derive(secret: string, salt: Buffer, n: number): Buffer {
  return crypto.scryptSync(secret, salt, KEY_BYTES, { N: n, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function hashSecret(secret: string): string {
  const salt = crypto.randomBytes(SALT_BYTES);
  return ['scrypt', String(N), salt.toString('base64'), derive(secret, salt, N).toString('base64')].join('$');
}

/** True only when `secret` is the one that produced `stored`. Any malformed `stored` is a plain false, never a throw. */
export function verifySecret(secret: string, stored: string): boolean {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
    const n = Number(parts[1]);
    if (!Number.isInteger(n) || n < 1024 || n > 1 << 20) return false;
    const salt = Buffer.from(parts[2], 'base64');
    const expected = Buffer.from(parts[3], 'base64');
    if (salt.length === 0 || expected.length !== KEY_BYTES) return false;
    return crypto.timingSafeEqual(derive(String(secret ?? ''), salt, n), expected);
  } catch {
    return false;
  }
}
