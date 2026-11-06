import crypto from 'crypto';
import { integrationEnv } from '../integrations/integrationEnv';
import { isSecretBoxConfigured } from '../integrations/secretBox';

/**
 * Settings of the KMAPS partner API (Integrations > KMAPS). Read through integrationEnv like dhm/config.ts and jps/config.ts, so a value saved in the
 * menu wins over .env and a change takes effect at once.
 */

/** KMAPS_ENABLED must be exactly "true". Checked on every request, so switching it off ends access without a restart. */
export function isKmapsEnabled(): boolean {
  return String(integrationEnv('KMAPS_ENABLED') || '').toLowerCase() === 'true';
}

export function kmapsPublicKey(): string {
  return String(integrationEnv('KMAPS_PUBLIC_KEY') || '').trim();
}

/**
 * The scrypt hash of the private key, never the key. Only the Integrations menu writes it (hashOnStore), so a value that is not a hash - a plain key put
 * in .env - is treated as "no key": it can never match, and the API stays closed rather than comparing a plaintext secret.
 */
export function kmapsPrivateKeyHash(): string {
  const value = String(integrationEnv('KMAPS_PRIVATE_KEY') || '').trim();
  return value.startsWith('scrypt$') ? value : '';
}

/** Where the bell is sent (registered by an ADMIN; the last path segment is the slug KMAPS chose for KLIP). */
export function kmapsWebhookUrl(): string {
  return String(integrationEnv('KMAPS_WEBHOOK_URL') || '').trim();
}

/** The secret KMAPS issued with the keys (`whsec_...`); signs every bell. */
export function kmapsWebhookSecret(): string {
  return String(integrationEnv('KMAPS_WEBHOOK_SECRET') || '').trim();
}

/** Bells go out only while the integration is on and both the URL and the secret are saved. */
export function isKmapsWebhookConfigured(): boolean {
  return isKmapsEnabled() && kmapsWebhookUrl() !== '' && kmapsWebhookSecret() !== '';
}

/** Whether KLIP can authenticate KMAPS at all: both keys saved and the master key available to sign tokens. */
export function partnerReadiness(): { ok: boolean; message: string } {
  if (!isSecretBoxConfigured()) {
    return { ok: false, message: 'INTEGRATION_SECRETS_KEY is not set on the server, so tokens cannot be signed.' };
  }
  if (!kmapsPublicKey()) return { ok: false, message: 'The public key is not saved.' };
  if (!kmapsPrivateKeyHash()) return { ok: false, message: 'The private key is not saved.' };
  if (!isKmapsEnabled()) return { ok: false, message: 'Keys are saved, but the integration is switched off (Enabled = false).' };
  return { ok: true, message: 'Ready - KMAPS can request a token and read /api/partner/v1.' };
}

/**
 * Names the saved private key without revealing it: part of a hash of the stored hash. It rides inside every token, so saving a new key ends the tokens
 * issued under the old one immediately instead of after their hour.
 */
export function kmapsKeyVersion(): string {
  return crypto.createHash('sha256').update(kmapsPrivateKeyHash()).digest('hex').slice(0, 16);
}
