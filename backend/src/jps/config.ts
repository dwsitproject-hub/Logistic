import { integrationEnv } from '../integrations/integrationEnv';
import { parseJpsPorts, type JpsPort } from './ports';
/** Jetty Planning System client config — the API key stays server-side. */

export function isJpsEnabled(): boolean {
  if (String(integrationEnv('JPS_ENABLED') || '').toLowerCase() !== 'true') return false;
  return Boolean(jpsBaseUrl() && jpsApiKey());
}

/**
 * Absolute download link for a shipment document, opened by a JPS operator without a KLIP login.
 *
 * The file itself stays on the Synology share. This is `APP_PUBLIC_ORIGIN` (same host that proxies
 * `/api` on SIT) plus the open `GET /api/documents/:id/download` route. Empty when no public origin
 * is configured, so a submit is not held back just because the link cannot be built.
 *
 * http or https: JPS 5.3 accepts both. Until then it refused http with "must be a valid HTTPS URL" and rejected the WHOLE
 * instruction, which is why this once left the link out unless the origin was https (SIT is plain http).
 */
export function jpsDocumentDownloadUrl(documentId: string | null | undefined): string | undefined {
  const id = String(documentId ?? '').trim();
  const origin = String(integrationEnv('APP_PUBLIC_ORIGIN') || integrationEnv('FRONTEND_URL') || '')
    .trim()
    .replace(/\/+$/, '');
  if (!id || !/^https?:\/\//i.test(origin)) return undefined;
  return `${origin}/api/documents/${encodeURIComponent(id)}/download`;
}

export function jpsBaseUrl(): string {
  return String(integrationEnv('JPS_API_BASE_URL') || '')
    .trim()
    .replace(/\/+$/, '');
}

export function jpsApiKey(): string {
  return String(integrationEnv('JPS_API_KEY') || '').trim();
}

/**
 * The Master Ports KLIP submits to JPS for, switched on or not: the setting JPS_PORTS (Integrations > JPS > Ports). Nothing is built into the code: with no port switched
 * on, nothing is sent. JPS knows a port by its DHM code (port_hub_code) and has no site or region, so the port is the only scope there is.
 */
export function jpsPorts(): JpsPort[] {
  const parsed = parseJpsPorts(integrationEnv('JPS_PORTS'));
  return parsed.ok ? parsed.ports : [];
}

/** The ports a sweep submits for. */
export function jpsEnabledPorts(): JpsPort[] {
  return jpsPorts().filter((p) => p.enabled);
}

/** Their names, as the eligibility rule takes them. */
export function jpsEnabledPortNames(): string[] {
  return jpsEnabledPorts().map((p) => p.port);
}

export function jpsRequestTimeoutMs(): number {
  const n = Number(integrationEnv('JPS_TIMEOUT_MS'));
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

/** JPS asks partners to poll an instruction at most once every 5 minutes. */
export function jpsMinPollIntervalMs(): number {
  const n = Number(integrationEnv('JPS_MIN_POLL_INTERVAL_MS'));
  return Number.isFinite(n) && n >= 60_000 ? n : 5 * 60_000;
}

/**
 * Retry submissions JPS rejected outright, instead of leaving them settled.
 *
 * OFF by default, and meant to stay off. A 400 is permanent by definition, so retrying it on a
 * schedule normally just burns the rate limit and delays the real fix. It exists for the case the
 * fix is on the PARTNER's side - a master vessel value JPS holds wrongly, say - where the payload was
 * right all along and there is nothing in KLIP to change. Switch it on while that is being sorted
 * out, then off again.
 *
 * Never retries a SUBMITTED or SKIPPED_PRE_EXISTING instruction: those exist at JPS, and sending
 * them again is a duplicate, not a retry.
 */
export function jpsRetryFailed(): boolean {
  return String(integrationEnv('JPS_RETRY_FAILED') || '').toLowerCase() === 'true';
}

/**
 * How long a failure is left alone before it is retried. The sweep runs every 15 minutes anyway,
 * but it also fires on every shipment edit and SAP import, and without this a busy afternoon of
 * edits would resend the same rejected payload once per save.
 */
export function jpsRetryFailedAfterMs(): number {
  const n = Number(integrationEnv('JPS_RETRY_FAILED_AFTER_MS'));
  return Number.isFinite(n) && n >= 60_000 ? n : 5 * 60_000;
}

/**
 * The secret JPS showed once when the webhook endpoint was registered (whsec_...). Saved from Integrations > JPS and
 * used to verify X-JPS-Signature on POST /api/jps/webhooks. Empty means every delivery is refused.
 */
export function jpsWebhookSecret(): string {
  return String(integrationEnv('JPS_WEBHOOK_SECRET') || '').trim();
}

export function jpsSweepCron(): string {
  return integrationEnv('JPS_SWEEP_CRON') || '*/15 * * * *';
}

/**
 * Submissions per sweep. JPS allows 120 requests per minute per key; this bounds a first run (or a
 * run after an outage) so one sweep cannot spend the whole budget.
 */
export function jpsMaxSubmitsPerSweep(): number {
  const n = Number(integrationEnv('JPS_MAX_SUBMITS_PER_SWEEP'));
  return Number.isFinite(n) && n > 0 ? n : 25;
}
