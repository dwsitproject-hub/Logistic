import crypto from 'crypto';

/**
 * AES-256-GCM for integration secrets at rest.
 *
 * The master key comes only from INTEGRATION_SECRETS_KEY in the environment - 32 bytes, as 64 hex
 * characters or as base64. It is never stored in the database, so a dump of the database is not a
 * dump of the credentials.
 *
 * `context` is authenticated but not encrypted (GCM additional data). Callers pass
 * "<integration>:<setting_key>", which binds a ciphertext to its row: copying DHM's encrypted
 * private key into the JPS_API_KEY row makes it fail to decrypt instead of quietly becoming the
 * JPS key.
 *
 * Output format: `v1:<iv>:<tag>:<ciphertext>`, each part base64. The version prefix leaves room to
 * change algorithm or key later without guessing which rows were written under which.
 */
const VERSION = 'v1';
const IV_BYTES = 12;

export class SecretBoxError extends Error {}

function readMasterKey(): Buffer | null {
  const raw = String(process.env.INTEGRATION_SECRETS_KEY || '').trim();
  if (!raw) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : null;
}

/** True when a usable 32-byte master key is configured. Saving a secret requires it. */
export function isSecretBoxConfigured(): boolean {
  return readMasterKey() !== null;
}

export function sealSecret(plain: string, context: string): string {
  const key = readMasterKey();
  if (!key) {
    throw new SecretBoxError(
      'INTEGRATION_SECRETS_KEY is not set (or is not 32 bytes) - secrets cannot be saved until it is.',
    );
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function openSecret(sealed: string, context: string): string {
  const key = readMasterKey();
  if (!key) throw new SecretBoxError('INTEGRATION_SECRETS_KEY is not set - stored secrets cannot be read.');
  const parts = String(sealed).split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new SecretBoxError('Unrecognised secret format.');
  const [, ivB64, tagB64, ctB64] = parts;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    // Wrong master key, tampered row, or a value moved to another row. Never echo the input.
    throw new SecretBoxError('Stored secret could not be decrypted (wrong INTEGRATION_SECRETS_KEY or altered row).');
  }
}
