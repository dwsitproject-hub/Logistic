/** Jetty Planning System client config — the API key stays server-side. */

export function isJpsEnabled(): boolean {
  if (String(process.env.JPS_ENABLED || '').toLowerCase() !== 'true') return false;
  return Boolean(jpsBaseUrl() && jpsApiKey());
}

export function jpsBaseUrl(): string {
  return String(process.env.JPS_API_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
}

export function jpsApiKey(): string {
  return String(process.env.JPS_API_KEY || '').trim();
}

/**
 * JPS port id. Staging has exactly one port, 1 (BONTANG), and production is expected to differ,
 * so this is configuration rather than a constant.
 */
export function jpsPortId(): number {
  const n = Number(process.env.JPS_PORT_ID);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * The Region/Site KLIP submits for. Only BONTANG is in scope for the first integration; a second
 * jetty would need its own port id, so this is a single value rather than a list.
 */
export function jpsRegionSite(): string {
  return String(process.env.JPS_REGION_SITE || 'BONTANG').trim().toUpperCase();
}

export function jpsRequestTimeoutMs(): number {
  const n = Number(process.env.JPS_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

/** JPS asks partners to poll an instruction at most once every 5 minutes. */
export function jpsMinPollIntervalMs(): number {
  const n = Number(process.env.JPS_MIN_POLL_INTERVAL_MS);
  return Number.isFinite(n) && n >= 60_000 ? n : 5 * 60_000;
}

export function jpsSweepCron(): string {
  return process.env.JPS_SWEEP_CRON || '*/15 * * * *';
}

/**
 * Submissions per sweep. JPS allows 120 requests per minute per key; this bounds a first run (or a
 * run after an outage) so one sweep cannot spend the whole budget.
 */
export function jpsMaxSubmitsPerSweep(): number {
  const n = Number(process.env.JPS_MAX_SUBMITS_PER_SWEEP);
  return Number.isFinite(n) && n > 0 ? n : 25;
}
