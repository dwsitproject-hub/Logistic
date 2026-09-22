/** DHM client config — credentials stay server-side. */

export function isDhmEnabled(): boolean {
  if (String(process.env.DHM_ENABLED || '').toLowerCase() !== 'true') return false;
  return Boolean(
    String(process.env.DHM_BASE_URL || '').trim() &&
      String(process.env.DHM_PUBLIC_KEY || '').trim() &&
      String(process.env.DHM_PRIVATE_KEY || '').trim(),
  );
}

export function dhmBaseUrl(): string {
  return String(process.env.DHM_BASE_URL || '').trim().replace(/\/+$/, '');
}

export function dhmPublicKey(): string {
  return String(process.env.DHM_PUBLIC_KEY || '').trim();
}

export function dhmPrivateKey(): string {
  return String(process.env.DHM_PRIVATE_KEY || '').trim();
}

export function dhmWebhookSecret(): string {
  return String(process.env.DHM_WEBHOOK_SECRET || '').trim();
}

export function dhmRequestTimeoutMs(): number {
  const n = Number(process.env.DHM_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 10_000;
}

export function dhmSyncCron(): string {
  return process.env.DHM_SYNC_CRON || '*/15 * * * *';
}
