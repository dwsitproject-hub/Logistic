import { integrationEnv } from '../integrations/integrationEnv';
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
 * is configured or it is not https, so a submit is not held back just because the link cannot be built.
 */
export function jpsDocumentDownloadUrl(documentId: string | null | undefined): string | undefined {
  const id = String(documentId ?? '').trim();
  const origin = String(integrationEnv('APP_PUBLIC_ORIGIN') || integrationEnv('FRONTEND_URL') || '')
    .trim()
    .replace(/\/+$/, '');
  // JPS validates these three fields as HTTPS URLs and rejects the WHOLE instruction otherwise (SIT is served
  // over plain http, and every STO with a document attached came back VALIDATION_ERROR). A link JPS cannot
  // accept is no use to its operator either, so leave it out and let the instruction go without the document.
  if (!id || !/^https:\/\//i.test(origin)) return undefined;
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
 * The Region/Site KLIP submits for. Only BONTANG is in scope for the first integration; a second
 * jetty would need its own port, so this is a single value rather than a list.
 */
export function jpsRegionSite(): string {
  return String(integrationEnv('JPS_REGION_SITE') || 'BONTANG').trim().toUpperCase();
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
 * fix is on the PARTNER's side - a master vessel missing its LOA, say - where the payload was
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
 * The numeric JPS port id to send in place of the DHM `port_hub_code`. TESTING ONLY, and off unless BOTH
 * JPS_USE_PORT_ID=true and JPS_PORT_ID are set.
 *
 * Every payload that carried port_hub_code PORT-0048 (BONTANG) came back 400 "No port found" and then 500, while
 * the instructions JPS accepted before the code existed were sent with `port_id: 1`. This lets one STO go through
 * that older shape, so the rest of the loop (submit, poll, amend, status on the page) can be proven while JPS
 * sorts out the port. It sends a port id that is not tied to Master Port, so it must not outlive the test.
 */
export function jpsPortIdOverride(): number | null {
  if (String(integrationEnv('JPS_USE_PORT_ID') || '').toLowerCase() !== 'true') return null;
  const n = Number(integrationEnv('JPS_PORT_ID'));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Send the vessel NAME and no `vessel_hub_code`. TESTING ONLY, off unless JPS_USE_VESSEL_NAME=true.
 *
 * After JPS moved its masters to DataHub codes, every payload that passed its validation (no 400) came back 500,
 * with port_hub_code and with port_id, for three vessels. This isolates the vessel lookup: if an instruction goes
 * through by name, the failure is in how JPS resolves a vessel hub code. It sends a vessel the way the pilot did,
 * not the DataHub code the integration is meant to use, so it must not outlive the test.
 */
export function jpsUseVesselName(): boolean {
  return String(integrationEnv('JPS_USE_VESSEL_NAME') || '').toLowerCase() === 'true';
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
