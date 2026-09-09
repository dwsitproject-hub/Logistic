/**
 * One loaded row set per scope, so a toolbar change does not mean another query.
 *
 * The list's own PAGE_CACHE is keyed by (filters x status x sort x page), which is why clicking a
 * status card or adding a product filter cost 4-12s each even with a warm cache - every
 * combination is its own key. This cache is keyed by *scope* only: the date window, skipSapJoin,
 * and the filters that genuinely change which rows exist (plant, search, sto/contract/vessel/port
 * and the toolbar filters applied inside the SQL). Status, sort, page and the column filters
 * `shipmentListNodePaging` can mirror are deliberately absent from the key - those are derived
 * from the row set instead.
 *
 * The row set is small: 668 rows for the default YTD scope, 1,363 grouped rows for all time.
 *
 * Invalidation is the same as every other list cache: registered with listCacheRegistry, so a
 * shipment write, a trucking write or a SAP import clears it immediately rather than leaving it
 * to the TTL.
 */

import { registerListCacheInvalidator } from '../utils/listCacheRegistry';
import logger from '../utils/logger';

export type RowSetRow = Record<string, unknown>;

interface Entry {
  rows: RowSetRow[];
  expiresAt: number;
}

const ROW_SET_CACHE = new Map<string, Entry>();
const IN_FLIGHT = new Map<string, Promise<RowSetRow[]>>();

/** Same window the list's other caches use, so freshness is one rule, not several. */
const TTL_MS = 5 * 60 * 1000;
/** A scope is a date window plus toolbar state; a handful covers real use without hoarding. */
const MAX_ENTRIES = 8;

export function getCachedShipmentRowSet(key: string): RowSetRow[] | null {
  const hit = ROW_SET_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) {
    ROW_SET_CACHE.delete(key);
    return null;
  }
  return hit.rows;
}

function evictIfNeeded(): void {
  if (ROW_SET_CACHE.size <= MAX_ENTRIES) return;
  const oldest = [...ROW_SET_CACHE.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
  if (oldest) ROW_SET_CACHE.delete(oldest[0]);
}

/**
 * Load once per scope, de-duplicating concurrent callers.
 *
 * Without the in-flight map the four requests a single page load fires would each start their own
 * copy of the same scope query - the stampede the per-page caches already guard against.
 */
export async function loadShipmentRowSet(
  key: string,
  load: () => Promise<RowSetRow[]>,
): Promise<RowSetRow[]> {
  const cached = getCachedShipmentRowSet(key);
  if (cached) return cached;

  const inFlight = IN_FLIGHT.get(key);
  if (inFlight) return inFlight;

  const run = load()
    .then((rows) => {
      ROW_SET_CACHE.set(key, { rows, expiresAt: Date.now() + TTL_MS });
      evictIfNeeded();
      return rows;
    })
    .finally(() => {
      IN_FLIGHT.delete(key);
    });
  IN_FLIGHT.set(key, run);
  return run;
}

export function invalidateShipmentRowSetCache(): void {
  ROW_SET_CACHE.clear();
}

registerListCacheInvalidator(invalidateShipmentRowSetCache);

/** Diagnostics only - never used to decide behaviour. */
export function shipmentRowSetCacheStats(): { entries: number; keys: string[] } {
  return { entries: ROW_SET_CACHE.size, keys: [...ROW_SET_CACHE.keys()] };
}

export function logShipmentRowSetHit(key: string, rows: number, derivedMs: number): void {
  logger.debug('Shipments page derived from a cached row set', {
    key: key.slice(0, 120),
    rows,
    derivedMs,
  });
}
