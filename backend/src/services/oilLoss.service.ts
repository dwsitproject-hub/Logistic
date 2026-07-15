/**
 * Oil Loss page data — in-memory cache + background keep-warm.
 *
 * The two oil-loss queries scan every sap_processed_data row and evaluate ~20 JSONB
 * expressions each (~9s + ~3.5s even after CTE materialization), which made the page
 * load 40s+ cold. Caching serves the identical query results from memory; the warmer
 * pre-runs them off the request path (startup, near-TTL renewal, after invalidation).
 * Mirrors shippingPerformance.service.ts conventions.
 */

import { query } from '../database/connection';
import logger from '../utils/logger';
import { buildOilLossGainSql, buildOilLossMainSql } from '../utils/oilLossQuerySql';

export type OilLossPayload = {
  rows: Record<string, unknown>[];
  gainRow: { total_gain_kg: unknown; gain_count: unknown };
};

// Freshness is primarily event-driven (invalidateOilLossCache on SAP import / shipment
// edits). The TTL only bounds staleness from out-of-band DB changes, so it can be long;
// the warmer renews just before it so every page load — including the first after a
// quiet period — is served from memory. Renewal cost (~12s of queries per ~25 min) is
// negligible and burst-free.
const CACHE_TTL_MS = 30 * 60 * 1000;
const KEEP_WARM_CHECK_MS = 60 * 1000; // how often the warmer wakes up
const KEEP_WARM_REFRESH_AFTER_MS = 25 * 60 * 1000; // renew cache once it is this old (< TTL)

let cached: { payload: OilLossPayload; expiresAt: number } | null = null;
let refreshInFlight: Promise<OilLossPayload> | null = null;
let keepWarmTimer: NodeJS.Timeout | null = null;

/** Run both queries and repopulate the cache. Concurrent callers share one execution. */
async function refreshOilLossPayload(): Promise<OilLossPayload> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const [result, gainResult] = await Promise.all([
        query(buildOilLossMainSql()),
        query(buildOilLossGainSql()),
      ]);
      const payload: OilLossPayload = {
        rows: result.rows as Record<string, unknown>[],
        gainRow:
          (gainResult.rows[0] as OilLossPayload['gainRow']) ?? { total_gain_kg: 0, gain_count: 0 },
      };
      cached = { payload, expiresAt: Date.now() + CACHE_TTL_MS };
      return payload;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Request path: serve from memory when fresh; otherwise run the identical queries. */
export async function loadOilLossPayload(): Promise<OilLossPayload> {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }
  return refreshOilLossPayload();
}

/** After SAP imports / shipment edits — drop the cache and rebuild it off-request. */
export function invalidateOilLossCache(): void {
  cached = null;
  void warmOilLossCache();
}

/** Pre-populate the cache off the request path (startup + background warmer). */
export async function warmOilLossCache(): Promise<void> {
  try {
    await refreshOilLossPayload();
  } catch (err) {
    // Best-effort; a failed warm just means the next request runs cold.
    logger.warn('Oil loss cache warm failed', { err });
  }
}

/**
 * Keep the cache populated so page loads are served from memory. Renews shortly
 * before TTL while the page is in active use; data freshness is unchanged (cache
 * is still at most CACHE_TTL_MS old).
 */
export function startOilLossCacheWarmer(): void {
  void warmOilLossCache();
  if (keepWarmTimer) return;
  keepWarmTimer = setInterval(() => {
    if (refreshInFlight) return;
    const ageMs = cached ? CACHE_TTL_MS - (cached.expiresAt - Date.now()) : Number.POSITIVE_INFINITY;
    if (ageMs >= KEEP_WARM_REFRESH_AFTER_MS) {
      void warmOilLossCache();
    }
  }, KEEP_WARM_CHECK_MS);
  keepWarmTimer.unref?.();
}
