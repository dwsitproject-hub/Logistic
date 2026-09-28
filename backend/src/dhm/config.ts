import { integrationEnv } from '../integrations/integrationEnv';
/** DHM client config — credentials stay server-side. */

export function isDhmEnabled(): boolean {
  if (String(integrationEnv('DHM_ENABLED') || '').toLowerCase() !== 'true') return false;
  return Boolean(
    String(integrationEnv('DHM_BASE_URL') || '').trim() &&
      String(integrationEnv('DHM_PUBLIC_KEY') || '').trim() &&
      String(integrationEnv('DHM_PRIVATE_KEY') || '').trim(),
  );
}

export function dhmBaseUrl(): string {
  return String(integrationEnv('DHM_BASE_URL') || '').trim().replace(/\/+$/, '');
}

export function dhmPublicKey(): string {
  return String(integrationEnv('DHM_PUBLIC_KEY') || '').trim();
}

export function dhmPrivateKey(): string {
  return String(integrationEnv('DHM_PRIVATE_KEY') || '').trim();
}

export function dhmWebhookSecret(): string {
  return String(integrationEnv('DHM_WEBHOOK_SECRET') || '').trim();
}

export function dhmRequestTimeoutMs(): number {
  const n = Number(integrationEnv('DHM_TIMEOUT_MS'));
  return Number.isFinite(n) && n > 0 ? n : 10_000;
}

export function dhmSyncCron(): string {
  return integrationEnv('DHM_SYNC_CRON') || '*/15 * * * *';
}
