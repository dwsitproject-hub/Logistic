import { ACTIVE_STAGES, STAGE_LABELS } from './format';
import { PARTNER_MAX_STALENESS_SECONDS } from './refresh';

/**
 * GET /catalog: the contract describing itself, so KMAPS can check what this KLIP supports instead of assuming it.
 */
export const PARTNER_API_VERSION = '1';
export const PARTNER_MAX_CODES = 100;
export const PARTNER_MAX_PAGE = 500;

export function buildCatalog(): Record<string, unknown> {
  return {
    apiVersion: PARTNER_API_VERSION,
    contractDraft: 5,
    resources: ['GET /health', 'POST /auth/token', 'GET /catalog', 'GET /shipments', 'GET /shipments/{id}', 'GET /vessel-pairs'],
    limits: { maxPage: PARTNER_MAX_PAGE, defaultPage: PARTNER_MAX_PAGE, maxVesselCodes: PARTNER_MAX_CODES, maxSapCodes: PARTNER_MAX_CODES },
    token: { ttlSeconds: 3600, scope: 'shipments:read' },
    transportModes: ['SEA', 'MIX'],
    dateTimes: 'ISO 8601 with an explicit offset (+07:00); a date-only value stays a date',
    scope: {
      rule: 'The stage shown on the KLIP Shipments page. Active = a stage before Completed or Cancelled.',
      activeStatuses: ACTIVE_STAGES,
      statuses: Object.entries(STAGE_LABELS).map(([code, label]) => ({ code, label })),
    },
    vesselMatching: {
      vesselCode: 'DHM vessel code',
      sapCode: 'supported: a shipment matches when its vessel DHM code is in vesselCode OR one of its SAP codes is in sapCode',
    },
    // The records are rebuilt from the Shipments page derivation whenever its sources change; this is the longest they can lag.
    maxStalenessSeconds: PARTNER_MAX_STALENESS_SECONDS,
  };
}
