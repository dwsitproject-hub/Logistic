/**
 * Oil Loss page data — memory cache over the database snapshot.
 *
 * The SAP scan lives in oilLossSnapshot.service (rebuilt off the request, swapped in one
 * transaction). This module only serves that stored row set: from memory when warm, otherwise
 * a SELECT. A process restart no longer recomputes sap_processed_data on the first page load.
 */

import logger from '../utils/logger';
import {
  loadOilLossPayloadFromSnapshot,
  oilLossSnapshotNeedsRebuild,
  readOilLossSnapshotMeta,
  refreshOilLossSnapshot,
  scheduleOilLossSnapshotRefresh,
} from './oilLossSnapshot.service';

export type OilLossPayload = {
  rows: Record<string, unknown>[];
  gainRow: { total_gain_kg: unknown; gain_count: unknown };
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const KEEP_WARM_CHECK_MS = 60 * 1000;
const KEEP_WARM_REFRESH_AFTER_MS = 25 * 60 * 1000;

let cached: { payload: OilLossPayload; expiresAt: number } | null = null;
let keepWarmTimer: NodeJS.Timeout | null = null;

function emptyPayload(): OilLossPayload {
  return { rows: [], gainRow: { total_gain_kg: 0, gain_count: 0 } };
}

function storePayload(payload: OilLossPayload): OilLossPayload {
  cached = { payload, expiresAt: Date.now() + CACHE_TTL_MS };
  return payload;
}

/** Fill memory from the snapshot table. No-op until the snapshot has been built once. */
export async function rememberOilLossPayloadFromSnapshot(): Promise<OilLossPayload | null> {
  const payload = await loadOilLossPayloadFromSnapshot();
  if (!payload) return null;
  return storePayload(payload);
}

/**
 * Request path. Memory when warm. Otherwise the snapshot, including a stale one.
 * The live SAP queries run only inside the snapshot rebuild. The first build (no
 * refreshed_at yet) is the only case that waits.
 */
export async function loadOilLossPayload(): Promise<OilLossPayload> {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  let meta: Awaited<ReturnType<typeof readOilLossSnapshotMeta>> = null;
  try {
    meta = await readOilLossSnapshotMeta();
  } catch (err) {
    logger.warn('Oil loss snapshot meta read failed', { err });
    return cached?.payload ?? emptyPayload();
  }

  if (!meta?.refreshedAt) {
    try {
      await refreshOilLossSnapshot();
    } catch (err) {
      logger.warn('Oil loss initial snapshot build failed', { err });
      return cached?.payload ?? emptyPayload();
    }
    return (await rememberOilLossPayloadFromSnapshot()) ?? emptyPayload();
  }

  if (oilLossSnapshotNeedsRebuild(meta)) {
    void refreshOilLossSnapshot().catch((err) => {
      logger.warn('Background oil loss snapshot refresh failed', { err });
    });
  }

  try {
    return (await rememberOilLossPayloadFromSnapshot()) ?? cached?.payload ?? emptyPayload();
  } catch (err) {
    logger.warn('Oil loss snapshot read failed', { err });
    return cached?.payload ?? emptyPayload();
  }
}

/** Shipment, trucking, and presence edits — keep serving the last snapshot while it rebuilds. */
export function invalidateOilLossCache(): void {
  scheduleOilLossSnapshotRefresh();
}

/** Load the snapshot into memory. Does not scan SAP. */
export async function warmOilLossCache(): Promise<void> {
  try {
    await rememberOilLossPayloadFromSnapshot();
  } catch (err) {
    logger.warn('Oil loss cache warm failed', { err });
  }
}

/**
 * Startup queue job. Only reads the snapshot table so it does not compete with the
 * Shipments / Shipping Performance / Trucking warmers. A stale or missing snapshot is
 * rebuilt from server startup, after qty_move, not from here.
 */
export function startOilLossCacheWarmer(): Promise<void> {
  const initialWarm = warmOilLossCache();
  if (keepWarmTimer) return initialWarm;
  keepWarmTimer = setInterval(() => {
    const ageMs = cached ? CACHE_TTL_MS - (cached.expiresAt - Date.now()) : Number.POSITIVE_INFINITY;
    if (ageMs >= KEEP_WARM_REFRESH_AFTER_MS) {
      void warmOilLossCache();
    }
  }, KEEP_WARM_CHECK_MS);
  keepWarmTimer.unref?.();
  return initialWarm;
}
