/**
 * The ports JPS knows (`GET /catalog/port`, rows `{ hub_code, jps_port_id, name }`).
 *
 * JPS takes a shipping instruction's port as `port_hub_code` and refuses a code that is not in its own master data with a 400, which KLIP records as FAILED and never
 * retries. A shipment can discharge at a Master Port that has a DHM code but is not one of JPS's ports (on SIT 2026-10-28: PORT PELINTUNG), so KLIP asks which ports JPS
 * knows and holds such an STO with the reason, instead of sending it to be refused. Asked once per sweep and cached for a few minutes, like the company catalog.
 *
 * If the catalog cannot be read, the answer is "unknown" and nothing is held for it: JPS's own refusal remains the backstop, so an outage on this one call cannot stop a
 * port that works.
 */
import logger from '../utils/logger';
import { onIntegrationSettingsChanged } from '../integrations/integrationEnv';
import { jpsRequest } from './client';

/** The hub codes (upper case) of the ports JPS knows. */
export type JpsKnownPorts = Set<string>;

interface CatalogEntity {
  referenceRows?: Array<{ hub_code?: unknown }>;
}

const CACHE_MS = 10 * 60_000;
let cached: { at: number; value: JpsKnownPorts } | null = null;

export function resetJpsPortCatalogForTests(): void {
  cached = null;
}

// A saved change (a new base URL or key) must not be answered from the old environment's catalog.
onIntegrationSettingsChanged(resetJpsPortCatalogForTests);

/** Turn the catalog entity into a set of hub codes. Null when the response is not the shape the contract describes. */
export function parseJpsPortCatalog(data: unknown): JpsKnownPorts | null {
  const rows = (data as CatalogEntity | null | undefined)?.referenceRows;
  if (!Array.isArray(rows)) return null;
  const codes: JpsKnownPorts = new Set();
  for (const row of rows) {
    const code = String(row?.hub_code ?? '').trim().toUpperCase();
    if (code) codes.add(code);
  }
  // An empty catalog is not an answer: it would hold every STO. Treat it as unknown.
  return codes.size > 0 ? codes : null;
}

/**
 * The ports JPS knows, or null when JPS could not be asked (disabled, network, 4xx/5xx, unexpected or empty body).
 * Failures are not cached, so the next sweep tries again.
 */
export async function fetchJpsKnownPorts(): Promise<JpsKnownPorts | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  // Recorded in the call history as kind "other" (inferred from the URL), like the company catalog.
  const res = await jpsRequest<CatalogEntity>({ method: 'GET', url: '/catalog/port' });
  if (!res.ok) {
    logger.warn('JPS port catalog unavailable; ports are not checked against JPS this sweep', { status: res.status, code: res.code, message: res.message });
    return null;
  }
  const parsed = parseJpsPortCatalog(res.data);
  if (!parsed) {
    logger.warn('JPS port catalog had no referenceRows; ports are not checked against JPS this sweep');
    return null;
  }
  cached = { at: Date.now(), value: parsed };
  return parsed;
}
