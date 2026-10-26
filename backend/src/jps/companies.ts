/**
 * Which operating companies JPS has mapped to each port (v5.6, `GET /catalog/company`).
 *
 * JPS decides per port whether `company_hub_code` is needed: none mapped - a code is refused ("Company is not used at this
 * port"); exactly one - omit it and JPS stores that company; two or more - it is required. KLIP cannot know which of the
 * three applies from its own data, so it asks, and sends the code only when the answer calls for it. Asking once per sweep
 * (and caching for a few minutes) is cheaper than learning it from a 400, which KLIP records as FAILED and never retries.
 *
 * If the catalog cannot be read, the answer is "unknown" and no company is sent: that is what KLIP did before v5.6, so a
 * JPS outage on this one call cannot turn a working port into a refused one.
 */
import logger from '../utils/logger';
import { onIntegrationSettingsChanged } from '../integrations/integrationEnv';
import { jpsRequest } from './client';

/** port_hub_code (upper case) -> hub codes of the companies mapped to it. */
export type JpsPortCompanies = Map<string, string[]>;

interface CatalogEntity {
  referenceRows?: Array<{ hub_code?: unknown; port_hub_codes?: unknown }>;
}

const CACHE_MS = 10 * 60_000;
let cached: { at: number; value: JpsPortCompanies } | null = null;

export function resetJpsCompanyCatalogForTests(): void {
  cached = null;
}

// A saved change (a new base URL or key) must not be answered from the old environment's catalog.
onIntegrationSettingsChanged(resetJpsCompanyCatalogForTests);

function norm(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

/** Turn the catalog entity into port -> companies. Null when the response is not the shape the contract describes. */
export function parseJpsCompanyCatalog(data: unknown): JpsPortCompanies | null {
  const rows = (data as CatalogEntity | null | undefined)?.referenceRows;
  if (!Array.isArray(rows)) return null;
  const byPort: JpsPortCompanies = new Map();
  for (const row of rows) {
    const hub = norm(row?.hub_code);
    if (!hub) continue;
    const ports = Array.isArray(row.port_hub_codes) ? row.port_hub_codes : [];
    for (const port of ports) {
      const key = norm(port);
      if (!key) continue;
      const list = byPort.get(key) ?? [];
      if (!list.includes(hub)) list.push(hub);
      byPort.set(key, list);
    }
  }
  return byPort;
}

/**
 * The catalog, or null when JPS could not be asked (disabled, network, 4xx/5xx, unexpected body).
 * Failures are not cached, so the next sweep tries again.
 */
export async function fetchJpsPortCompanies(): Promise<JpsPortCompanies | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  // Recorded in the call history as kind "other" (inferred from the URL), like every call that is not a submit/poll/amend.
  const res = await jpsRequest<CatalogEntity>({ method: 'GET', url: '/catalog/company' });
  if (!res.ok) {
    logger.warn('JPS company catalog unavailable; no company_hub_code will be sent this sweep', {
      status: res.status,
      code: res.code,
      message: res.message,
    });
    return null;
  }
  const parsed = parseJpsCompanyCatalog(res.data);
  if (!parsed) {
    logger.warn('JPS company catalog had no referenceRows; no company_hub_code will be sent this sweep');
    return null;
  }
  cached = { at: Date.now(), value: parsed };
  return parsed;
}

/**
 * The companies mapped to one port: an empty list when the catalog is known and the port has none, `null` when the catalog
 * is unknown (so the caller sends nothing and holds nothing).
 */
export function companiesForPort(catalog: JpsPortCompanies | null, portHubCode: string | null | undefined): string[] | null {
  if (!catalog) return null;
  return catalog.get(norm(portHubCode)) ?? [];
}
