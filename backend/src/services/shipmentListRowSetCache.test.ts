import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedShipmentRowSet,
  invalidateShipmentRowSetCache,
  loadShipmentRowSet,
  runShipmentRowSetWarmCycle,
  setShipmentRowSetReloader,
  shipmentRowSetCacheStats,
  resetShipmentRowSetCacheForTests,
  type RowSetRow,
  type ScopeQuery,
} from './shipmentListRowSetCache';

/**
 * The row set costs 206s to build, so who rebuilds it and when is the whole point of this cache.
 * Before this, a 5-minute TTL expired it and nothing rebuilt it until a user clicked a status
 * card - which paid 12s of SQL and only then started the load. These lock the two properties
 * that fixed that: the warm cycle reloads without any request, and a write clears immediately
 * but schedules its own rebuild.
 */
const SCOPE: ScopeQuery = { dateFrom: '2026-01-01', dateTo: '2026-09-10', skipSapJoin: 'false' };
const KEY = 'scope-a';

function rows(tag: string): RowSetRow[] {
  return [{ id: 1, tag }];
}

describe('shipmentListRowSetCache', () => {
  beforeEach(() => {
    resetShipmentRowSetCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetShipmentRowSetCacheForTests();
  });

  it('serves a loaded scope and de-duplicates concurrent loads', async () => {
    const load = vi.fn(async () => rows('first'));
    const [a, b] = await Promise.all([
      loadShipmentRowSet(KEY, SCOPE, load),
      loadShipmentRowSet(KEY, SCOPE, load),
    ]);
    expect(a).toEqual(rows('first'));
    expect(b).toEqual(rows('first'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(getCachedShipmentRowSet(KEY)).toEqual(rows('first'));
  });

  it('a write clears the rows immediately - stale rows would hide the user own edit', async () => {
    await loadShipmentRowSet(KEY, SCOPE, async () => rows('before'));
    invalidateShipmentRowSetCache();
    expect(getCachedShipmentRowSet(KEY)).toBeNull();
  });

  it('the warm cycle rebuilds a cleared scope with no request behind it', async () => {
    await loadShipmentRowSet(KEY, SCOPE, async () => rows('before'), { pinned: true });
    invalidateShipmentRowSetCache();

    const reload = vi.fn(async () => rows('after'));
    setShipmentRowSetReloader(reload);
    await runShipmentRowSetWarmCycle('test');

    expect(reload).toHaveBeenCalledTimes(1);
    // The reloader is handed the stored scope query, never a closure over a finished request.
    expect(reload).toHaveBeenCalledWith(SCOPE);
    expect(getCachedShipmentRowSet(KEY)).toEqual(rows('after'));
  });

  it('does nothing when no reloader is registered, leaving the old behaviour intact', async () => {
    await loadShipmentRowSet(KEY, SCOPE, async () => rows('before'), { pinned: true });
    invalidateShipmentRowSetCache();
    await runShipmentRowSetWarmCycle('test');
    expect(getCachedShipmentRowSet(KEY)).toBeNull();
  });

  it('leaves a fresh scope alone, so the cycle is not a reload every minute', async () => {
    const reload = vi.fn(async () => rows('reloaded'));
    setShipmentRowSetReloader(reload);
    await loadShipmentRowSet(KEY, SCOPE, async () => rows('fresh'), { pinned: true });

    await runShipmentRowSetWarmCycle('test');

    expect(reload).not.toHaveBeenCalled();
    expect(getCachedShipmentRowSet(KEY)).toEqual(rows('fresh'));
  });

  it('refreshes ahead of the TTL, so a read never finds the entry gone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
    const reload = vi.fn(async () => rows('refreshed'));
    setShipmentRowSetReloader(reload);
    await loadShipmentRowSet(KEY, SCOPE, async () => rows('original'), { pinned: true });

    // 51 minutes: past the 50-minute refresh point, still inside the 60-minute TTL.
    vi.setSystemTime(new Date('2026-09-10T00:51:00Z'));
    expect(getCachedShipmentRowSet(KEY)).toEqual(rows('original'));

    await runShipmentRowSetWarmCycle('test');

    expect(reload).toHaveBeenCalledTimes(1);
    expect(getCachedShipmentRowSet(KEY)).toEqual(rows('refreshed'));
  });

  it('keeps refreshing a pinned scope but drops an abandoned one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
    const reload = vi.fn(async (scope: ScopeQuery) => rows(String(scope.skipSapJoin)));
    setShipmentRowSetReloader(reload);

    await loadShipmentRowSet('pinned', SCOPE, async () => rows('p'), { pinned: true });
    await loadShipmentRowSet('adhoc', { ...SCOPE, plant: 'Bontang' }, async () => rows('a'));
    expect(shipmentRowSetCacheStats().warmScopes).toBe(2);

    // Four hours with nobody reading either: past the 3-hour idle window.
    vi.setSystemTime(new Date('2026-09-10T04:00:00Z'));
    await runShipmentRowSetWarmCycle('test');

    const stats = shipmentRowSetCacheStats();
    expect(stats.warmScopes).toBe(1);
    expect(stats.pinnedScopes).toBe(1);
    expect(stats.keys).toEqual(['pinned']);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('caps the warm list so a user cycling filters cannot queue up reloads', async () => {
    await loadShipmentRowSet('pinned', SCOPE, async () => rows('p'), { pinned: true });
    // Twelve ad-hoc scopes against a cap of 8 - one reload each would be catastrophic.
    for (let i = 0; i < 12; i += 1) {
      await loadShipmentRowSet(`adhoc-${i}`, { ...SCOPE, plant: `P${i}` }, async () => rows('a'));
    }

    const stats = shipmentRowSetCacheStats();
    expect(stats.warmScopes).toBeLessThanOrEqual(8);
    // The startup warmer's scope is load-bearing and must survive the trimming.
    expect(stats.pinnedScopes).toBe(1);
    expect(getCachedShipmentRowSet('pinned')).toEqual(rows('p'));
    // The most recent ad-hoc scope is kept; the oldest are gone.
    expect(getCachedShipmentRowSet('adhoc-11')).toEqual(rows('a'));
    expect(getCachedShipmentRowSet('adhoc-0')).toBeNull();
  });

  it('drops a superseded scope even when its load was already running', async () => {
    let release: (value: RowSetRow[]) => void = () => {};
    const pending = new Promise<RowSetRow[]>((resolve) => {
      release = resolve;
    });

    await loadShipmentRowSet('pinned', SCOPE, async () => rows('p'), { pinned: true });
    // A filter the user then moved away from: its load is still in flight.
    const superseded = loadShipmentRowSet('adhoc-old', { ...SCOPE, plant: 'A' }, () => pending);
    // Enough new filters to push it out of the warm list while it is still loading.
    for (let i = 0; i < 12; i += 1) {
      await loadShipmentRowSet(`adhoc-${i}`, { ...SCOPE, plant: `P${i}` }, async () => rows('a'));
    }
    release(rows('too-late'));
    await superseded;

    // It finished, but nothing kept it: a superseded scope must not sit in the cache.
    expect(getCachedShipmentRowSet('adhoc-old')).toBeNull();
    expect(shipmentRowSetCacheStats().warmScopes).toBeLessThanOrEqual(8);
  });

  it('cuts the rest of the cycle when a scope is superseded mid-run', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));

    let releaseFirst: (value: RowSetRow[]) => void = () => {};
    const first = new Promise<RowSetRow[]>((resolve) => {
      releaseFirst = resolve;
    });
    const seen: string[] = [];
    setShipmentRowSetReloader((scope) => {
      seen.push(String(scope.plant ?? 'default'));
      return seen.length === 1 ? first : Promise.resolve(rows('later'));
    });

    await loadShipmentRowSet('pinned', SCOPE, async () => rows('p'), { pinned: true });
    await loadShipmentRowSet('adhoc', { ...SCOPE, plant: 'Bontang' }, async () => rows('a'));
    invalidateShipmentRowSetCache();

    const running = runShipmentRowSetWarmCycle('test');
    /*
     * While the first reload is in flight the user files enough new filters to evict the second
     * scope from the warm list. The cycle must skip it rather than spend minutes on it.
     */
    for (let i = 0; i < 12; i += 1) {
      await loadShipmentRowSet(`new-${i}`, { ...SCOPE, plant: `N${i}` }, async () => rows('n'));
    }
    releaseFirst(rows('done'));
    await running;

    expect(seen).not.toContain('Bontang');
  });

  it('discards a load that a write overtook, instead of storing pre-write rows', async () => {
    let release: (value: RowSetRow[]) => void = () => {};
    const pending = new Promise<RowSetRow[]>((resolve) => {
      release = resolve;
    });

    const inFlight = loadShipmentRowSet(KEY, SCOPE, () => pending);
    // The write lands while the load is still running - its rows predate the edit.
    invalidateShipmentRowSetCache();
    release(rows('pre-write'));
    await inFlight;

    expect(getCachedShipmentRowSet(KEY)).toBeNull();
  });

  it('collapses a burst of cycles into one trailing run', async () => {
    let releaseFirst: (value: RowSetRow[]) => void = () => {};
    const first = new Promise<RowSetRow[]>((resolve) => {
      releaseFirst = resolve;
    });
    const reload = vi.fn().mockReturnValueOnce(first).mockResolvedValue(rows('second'));
    setShipmentRowSetReloader(reload as unknown as (s: ScopeQuery) => Promise<RowSetRow[]>);

    await loadShipmentRowSet(KEY, SCOPE, async () => rows('seed'), { pinned: true });
    invalidateShipmentRowSetCache();

    const running = runShipmentRowSetWarmCycle('one');
    // Two more arrive while the first is still loading; they must not each start their own.
    void runShipmentRowSetWarmCycle('two');
    void runShipmentRowSetWarmCycle('three');
    releaseFirst(rows('first'));
    await running;

    // One load for the cycle, plus at most one trailing run - never one per call.
    expect(reload.mock.calls.length).toBeLessThanOrEqual(2);
    expect(getCachedShipmentRowSet(KEY)).not.toBeNull();
  });
});
