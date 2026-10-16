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
  /** True while a snapshot rebuild is still in flight. The rows are the last committed set. */
  snapshotStale?: boolean;
  snapshotRefreshedAt?: string | null;
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const KEEP_WARM_CHECK_MS = 60 * 1000;
const KEEP_WARM_REFRESH_AFTER_MS = 25 * 60 * 1000;

let cached: { payload: OilLossPayload; expiresAt: number; refreshedAtMs: number | null } | null = null;
let keepWarmTimer: NodeJS.Timeout | null = null;

function emptyPayload(): OilLossPayload {
  return { rows: [], gainRow: { total_gain_kg: 0, gain_count: 0 } };
}

function storePayload(payload: OilLossPayload, refreshedAtMs: number | null): OilLossPayload {
  cached = { payload, expiresAt: Date.now() + CACHE_TTL_MS, refreshedAtMs };
  return payload;
}

function withSnapshotFreshness(
  payload: OilLossPayload,
  meta: { isStale: boolean; refreshedAt: Date | null } | null,
): OilLossPayload {
  return {
    ...payload,
    snapshotStale: meta?.isStale ?? true,
    snapshotRefreshedAt: meta?.refreshedAt ? meta.refreshedAt.toISOString() : null,
  };
}

/**
 * Put a saved SFAL / SFBD on the row of the in-memory payload the page is served from, without a query and without a lock: instant, and it holds through a rebuild
 * that is still running (the rows the rebuild commits are built after the edit). The row's id is the shipment row View Shipment opens; no row, no change.
 * Quantities are kg; null or 0 is no quantity, as in the snapshot (NULLIF(sfal_qty, 0)).
 */
export function patchCachedOilLossSfalSfbd(shipmentId: string, sfalKg: unknown, sfbdKg: unknown): boolean {
  if (!cached) return false;
  const id = String(shipmentId ?? '').trim();
  const kg = (v: unknown): number | null => {
    const n = v == null || v === '' ? null : Number(v);
    return n == null || !Number.isFinite(n) || n === 0 ? null : n;
  };
  let hit = false;
  const rows = cached.payload.rows.map((row) => {
    if (String(row.id ?? '') !== id || String(row.transport_mode ?? '').toUpperCase() !== 'SEA') return row;
    hit = true;
    return { ...row, quantity_sfal: kg(sfalKg), quantity_sfbd: kg(sfbdKg) };
  });
  if (hit) cached = { ...cached, payload: { ...cached.payload, rows } };
  return hit;
}

/** Fill memory from the snapshot table. No-op until the snapshot has been built once. */
export async function rememberOilLossPayloadFromSnapshot(): Promise<OilLossPayload | null> {
  const payload = await loadOilLossPayloadFromSnapshot();
  if (!payload) return null;
  const meta = await readOilLossSnapshotMeta();
  return storePayload(payload, meta?.refreshedAt ? meta.refreshedAt.getTime() : null);
}

/**
 * Request path. Memory when warm. Otherwise the snapshot, including a stale one.
 * The live SAP queries run only inside the snapshot rebuild. The first build (no
 * refreshed_at yet) is the only case that waits.
 */
export async function loadOilLossPayload(): Promise<OilLossPayload> {
  let meta: Awaited<ReturnType<typeof readOilLossSnapshotMeta>> = null;
  try {
    meta = await readOilLossSnapshotMeta();
  } catch (err) {
    logger.warn('Oil loss snapshot meta read failed', { err });
    return cached?.payload ?? emptyPayload();
  }

  const refreshedAtMs = meta?.refreshedAt ? meta.refreshedAt.getTime() : null;
  // Same committed snapshot already in memory. A newer refreshed_at means the rebuild committed.
  if (
    cached
    && cached.expiresAt > Date.now()
    && cached.refreshedAtMs === refreshedAtMs
  ) {
    return withSnapshotFreshness(cached.payload, meta);
  }

  if (!meta?.refreshedAt) {
    try {
      await refreshOilLossSnapshot();
    } catch (err) {
      logger.warn('Oil loss initial snapshot build failed', { err });
      return withSnapshotFreshness(cached?.payload ?? emptyPayload(), meta);
    }
    const built = await rememberOilLossPayloadFromSnapshot();
    return withSnapshotFreshness(built ?? cached?.payload ?? emptyPayload(), await readOilLossSnapshotMeta());
  }

  if (oilLossSnapshotNeedsRebuild(meta)) {
    void refreshOilLossSnapshot().catch((err) => {
      logger.warn('Background oil loss snapshot refresh failed', { err });
    });
  }

  try {
    const loaded = await rememberOilLossPayloadFromSnapshot();
    return withSnapshotFreshness(loaded ?? cached?.payload ?? emptyPayload(), meta);
  } catch (err) {
    logger.warn('Oil loss snapshot read failed', { err });
    return withSnapshotFreshness(cached?.payload ?? emptyPayload(), meta);
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
