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
 * WHY THIS KEEPS ITSELF WARM
 *
 * The first version had a 5-minute TTL, no refresh-ahead, and a startup warmer that ran once.
 * Building the hydrate scope takes 206s. So five minutes after boot the entry expired, nothing
 * rebuilt it, and the next status-card click paid 12s of SQL and only *then* started a 206s
 * background load - during which every further click paid 12s again. In steady state the cache
 * was cold more often than warm, and the rebuild was triggered by a user rather than by the
 * system.
 *
 * Refreshing at a 5-minute TTL is not the fix either: 206s of work every 240s is an 86% duty
 * cycle on the heaviest query in the system. The TTL was the wrong dial. Freshness here comes
 * from *invalidation* - a shipment write, a trucking write or a SAP import - not from a clock, so
 * the TTL only has to cover changes arriving outside those paths. At a 60-minute TTL refreshed at
 * 50 minutes the duty cycle is about 7%, and the entry is essentially always warm.
 *
 * One warm cycle serves both needs: the timer runs it on a schedule, and an invalidation schedules
 * it too (debounced, so a bulk write does not start one rebuild per row). It reloads only what is
 * missing or near expiry, one scope at a time, so it never puts two heavy queries in flight -
 * the same rule the startup queue follows.
 */

import { registerListCacheInvalidator } from '../utils/listCacheRegistry';
import logger from '../utils/logger';

export type RowSetRow = Record<string, unknown>;
export type ScopeQuery = Record<string, string>;

interface Entry {
  rows: RowSetRow[];
  expiresAt: number;
  loadedAt: number;
}

/** A scope worth keeping warm. Survives invalidation - that is what makes a rebuild possible. */
interface WarmScope {
  scopeQuery: ScopeQuery;
  lastReadAt: number;
  /** Primed by the startup warmer: kept warm even if nobody reads it, because that is its job. */
  pinned: boolean;
}

const ROW_SET_CACHE = new Map<string, Entry>();
const IN_FLIGHT = new Map<string, Promise<RowSetRow[]>>();
const WARM_SCOPES = new Map<string, WarmScope>();

/** Only has to cover changes that arrive outside the invalidation paths - see the note above. */
const TTL_MS = 60 * 60 * 1000;
/** Renew before expiry so a read never finds the entry gone. Must stay below TTL_MS. */
const REFRESH_AFTER_MS = 50 * 60 * 1000;
/** How often the warm cycle wakes up. Same cadence as the other keep-warm timers. */
const KEEP_WARM_CHECK_MS = 60 * 1000;
/**
 * An unpinned scope (a filter combination some user tried) stops being refreshed once nobody has
 * read it for this long, so an abandoned toolbar state does not cost a reload every hour. A guess,
 * not a measurement - worth revisiting once the 206s load cost is understood.
 */
const KEEP_WARM_MAX_IDLE_MS = 3 * 60 * 60 * 1000;
/** A bulk write fires one invalidation per row; coalesce them into a single rebuild. */
const REBUILD_DEBOUNCE_MS = 5 * 1000;
/** A scope is a date window plus toolbar state; a handful covers real use without hoarding. */
const MAX_ENTRIES = 8;

/**
 * Bumped by every invalidation.
 *
 * A load that started before a write committed can finish after it, and would then store rows
 * that predate the write into a cache the write had just cleared. Storing is therefore guarded on
 * the epoch being unchanged since the load began. This was already possible before the rebuild
 * below existed - the background load on the request path had the same race.
 */
let cacheEpoch = 0;

let reloadScopeRows: ((scopeQuery: ScopeQuery) => Promise<RowSetRow[]>) | null = null;
let keepWarmTimer: NodeJS.Timeout | null = null;
let rebuildTimer: NodeJS.Timeout | null = null;
let cycleRunning = false;
let cyclePending = false;

export function getCachedShipmentRowSet(key: string): RowSetRow[] | null {
  const hit = ROW_SET_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) {
    ROW_SET_CACHE.delete(key);
    return null;
  }
  const scope = WARM_SCOPES.get(key);
  if (scope) scope.lastReadAt = Date.now();
  return hit.rows;
}

function evictIfNeeded(): void {
  if (ROW_SET_CACHE.size <= MAX_ENTRIES) return;
  const oldest = [...ROW_SET_CACHE.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
  if (oldest) {
    ROW_SET_CACHE.delete(oldest[0]);
    WARM_SCOPES.delete(oldest[0]);
  }
}

/**
 * Record a scope as worth keeping warm, and keep that list small.
 *
 * Every scope in here is reloaded by the warm cycle, and one reload is the most expensive query
 * on the page - so the list cannot be allowed to grow with each filter combination a user tries.
 * It is capped at MAX_ENTRIES, dropping the least recently read scope. Pinned scopes (the startup
 * warmer's own) are never dropped: they are the ones a status-card click actually depends on.
 */
function rememberScope(key: string, scopeQuery: ScopeQuery, pinned: boolean): void {
  const existing = WARM_SCOPES.get(key);
  if (existing) {
    existing.lastReadAt = Date.now();
    existing.pinned = existing.pinned || pinned;
    return;
  }
  WARM_SCOPES.set(key, { scopeQuery, lastReadAt: Date.now(), pinned });

  while (WARM_SCOPES.size > MAX_ENTRIES) {
    const coldest = [...WARM_SCOPES.entries()]
      .filter(([, scope]) => !scope.pinned)
      .sort((a, b) => a[1].lastReadAt - b[1].lastReadAt)[0];
    /* Only pinned scopes left: they are all load-bearing, so keep them and stop trimming. */
    if (!coldest) break;
    WARM_SCOPES.delete(coldest[0]);
    ROW_SET_CACHE.delete(coldest[0]);
  }
}

/**
 * Load once per scope, de-duplicating concurrent callers.
 *
 * Without the in-flight map the four requests a single page load fires would each start their own
 * copy of the same scope query - the stampede the per-page caches already guard against.
 *
 * `scopeQuery` is stored so the warm cycle can reload this scope later without a request. It has
 * to be the plain query object, never a closure over an Express request: holding one of those for
 * an hour would keep the whole request alive and replay it against a socket that is long gone.
 *
 * `force` is what makes refresh-ahead work at all. Without it the warm cycle came straight back
 * out of the cache-hit branch below - the entry it wanted to renew was still valid, which is the
 * entire point of renewing early - so nothing was ever refreshed until the entry had fully
 * expired, exactly the cold gap this cache exists to close. Concurrent-caller de-duplication
 * still applies, so a forced reload never doubles up with one already running.
 */
export async function loadShipmentRowSet(
  key: string,
  scopeQuery: ScopeQuery,
  load: () => Promise<RowSetRow[]>,
  options: { pinned?: boolean; force?: boolean } = {},
): Promise<RowSetRow[]> {
  rememberScope(key, scopeQuery, options.pinned === true);

  if (options.force !== true) {
    const cached = getCachedShipmentRowSet(key);
    if (cached) return cached;
  }

  const inFlight = IN_FLIGHT.get(key);
  if (inFlight) return inFlight;

  const epochAtStart = cacheEpoch;
  const run = load()
    .then((rows) => {
      /*
       * Two ways a finished load is no longer wanted, and both mean: do not store it.
       *
       * The epoch moved - a write landed while this was running, so these rows predate the edit.
       * Or the scope is gone from WARM_SCOPES - the user moved on to another filter and this one
       * was trimmed, so caching it would keep a superseded scope alive and let it push a live one
       * out of the cache. The query itself cannot be called back once Postgres is running it;
       * what this prevents is superseded loads *accumulating* in the cache.
       */
      if (epochAtStart === cacheEpoch && WARM_SCOPES.has(key)) {
        ROW_SET_CACHE.set(key, { rows, expiresAt: Date.now() + TTL_MS, loadedAt: Date.now() });
        evictIfNeeded();
      }
      return rows;
    })
    .finally(() => {
      IN_FLIGHT.delete(key);
    });
  IN_FLIGHT.set(key, run);
  return run;
}

/**
 * The loader the warm cycle uses: a scope query in, rows out, with no request behind it.
 *
 * Registered at startup by the Shipments warmer, which already builds a synthetic request for
 * exactly this purpose. Until it is registered the cache behaves as it did before - cleared by
 * invalidation, reloaded by whichever request next misses.
 */
export function setShipmentRowSetReloader(
  fn: (scopeQuery: ScopeQuery) => Promise<RowSetRow[]>,
): void {
  reloadScopeRows = fn;
}

function scopesNeedingReload(now: number): Array<{ key: string; scopeQuery: ScopeQuery }> {
  const due: Array<{ key: string; scopeQuery: ScopeQuery }> = [];
  for (const [key, scope] of [...WARM_SCOPES.entries()]) {
    if (!scope.pinned && now - scope.lastReadAt > KEEP_WARM_MAX_IDLE_MS) {
      WARM_SCOPES.delete(key);
      ROW_SET_CACHE.delete(key);
      continue;
    }
    const entry = ROW_SET_CACHE.get(key);
    if (!entry || now - entry.loadedAt >= REFRESH_AFTER_MS) {
      due.push({ key, scopeQuery: scope.scopeQuery });
    }
  }
  return due;
}

/**
 * Reload every scope that is missing or near expiry, one at a time.
 *
 * Sequential on purpose: two of these in flight is two of the most expensive queries in the
 * system competing, which is the mistake the startup queue exists to avoid. Re-entrant calls
 * collapse into one trailing run so a burst of invalidations cannot stack up cycles.
 */
export async function runShipmentRowSetWarmCycle(reason: string): Promise<void> {
  if (!reloadScopeRows) return;
  if (cycleRunning) {
    cyclePending = true;
    return;
  }
  cycleRunning = true;
  try {
    const due = scopesNeedingReload(Date.now());
    for (const { key, scopeQuery } of due) {
      const startedAt = Date.now();
      const reload = reloadScopeRows;
      if (!reload) break;
      /*
       * Re-checked per scope, not trusted from the snapshot above. One reload can take minutes,
       * and in that time the user may have moved to a different filter (this scope trimmed) or a
       * request may have loaded it already. Either way, starting it now would be work nobody
       * wants - the queue is cut rather than run to the end.
       */
      const scope = WARM_SCOPES.get(key);
      if (!scope) continue;
      const current = ROW_SET_CACHE.get(key);
      if (current && Date.now() - current.loadedAt < REFRESH_AFTER_MS) continue;
      try {
        const rows = await loadShipmentRowSet(key, scopeQuery, () => reload(scopeQuery), {
          force: true,
        });
        logger.info('Shipments row set warmed', {
          reason,
          rows: rows.length,
          ms: Date.now() - startedAt,
        });
      } catch (error) {
        // Best-effort, exactly like the startup warmers: a failed reload just means the next
        // request runs on SQL, which is what it would have done anyway.
        logger.warn('Shipments row set warm failed', { reason, error });
      }
    }
  } finally {
    cycleRunning = false;
    if (cyclePending) {
      cyclePending = false;
      void runShipmentRowSetWarmCycle(`${reason}+pending`);
    }
  }
}

/** Start the periodic refresh-ahead. Idempotent, so a second call is harmless. */
export function startShipmentRowSetKeepWarm(): void {
  if (keepWarmTimer) return;
  keepWarmTimer = setInterval(() => {
    void runShipmentRowSetWarmCycle('keep-warm');
  }, KEEP_WARM_CHECK_MS);
  // Do not keep the event loop alive solely for the warmer.
  keepWarmTimer.unref?.();
}

export function stopShipmentRowSetKeepWarm(): void {
  if (keepWarmTimer) {
    clearInterval(keepWarmTimer);
    keepWarmTimer = null;
  }
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
    rebuildTimer = null;
  }
}

/**
 * Clear on a write, then rebuild in the background.
 *
 * Clearing is not negotiable: after an edit, serving the previous rows would hide the user's own
 * change. But clearing alone left the next status click on the 12s SQL path for however long it
 * took someone to trigger a reload, so the rebuild is scheduled here instead of waiting for a
 * user. Requests during the rebuild fall back to SQL exactly as they do today.
 */
export function invalidateShipmentRowSetCache(): void {
  cacheEpoch += 1;
  ROW_SET_CACHE.clear();
  if (WARM_SCOPES.size === 0 || !reloadScopeRows) return;
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    void runShipmentRowSetWarmCycle('after-write');
  }, REBUILD_DEBOUNCE_MS);
  rebuildTimer.unref?.();
}

registerListCacheInvalidator(invalidateShipmentRowSetCache);

/** Diagnostics only - never used to decide behaviour. */
export function shipmentRowSetCacheStats(): {
  entries: number;
  keys: string[];
  warmScopes: number;
  pinnedScopes: number;
} {
  return {
    entries: ROW_SET_CACHE.size,
    keys: [...ROW_SET_CACHE.keys()],
    warmScopes: WARM_SCOPES.size,
    pinnedScopes: [...WARM_SCOPES.values()].filter((s) => s.pinned).length,
  };
}

/** Tests only: drop every entry, scope and timer so cases cannot leak into each other. */
export function resetShipmentRowSetCacheForTests(): void {
  ROW_SET_CACHE.clear();
  IN_FLIGHT.clear();
  WARM_SCOPES.clear();
  stopShipmentRowSetKeepWarm();
  reloadScopeRows = null;
  cycleRunning = false;
  cyclePending = false;
  cacheEpoch = 0;
}

export function logShipmentRowSetHit(key: string, rows: number, derivedMs: number): void {
  logger.debug('Shipments page derived from a cached row set', {
    key: key.slice(0, 120),
    rows,
    derivedMs,
  });
}
