import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  buildCacheKey,
  cachedGet,
  clearClientDataCache,
  CLIENT_CACHE_GC_MS,
  CLIENT_CACHE_STALE_MS,
  invalidateClientCacheByPathPrefix,
  invalidateMissingEtaAlertCache,
  isCacheFresh,
  MISSING_ETA_ALERT_CACHE_KEY,
  peekCache,
  prefetchGet,
  subscribeMissingEtaAlertRefresh,
} from './clientDataCache'

describe('buildCacheKey', () => {
  it('sorts query params and strips _ts', () => {
    const a = buildCacheKey('get', '/shipments?limit=20&page=1&_ts=999')
    const b = buildCacheKey('GET', '/shipments?page=1&limit=20')
    expect(a).toBe(b)
  })
})

describe('cachedGet', () => {
  beforeEach(() => {
    clearClientDataCache()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns cached data without calling fetcher when fresh', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true })
    const key = buildCacheKey('GET', '/oil-loss')

    await cachedGet(key, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)

    const second = await cachedGet(key, fetcher)
    expect(second.fromCache).toBe(true)
    expect(second.revalidating).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('revalidates in background when stale', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockResolvedValueOnce({ v: 2 })
    const key = buildCacheKey('GET', '/trucking?limit=20')

    await cachedGet(key, fetcher)
    vi.advanceTimersByTime(CLIENT_CACHE_STALE_MS + 1)

    const onRevalidate = vi.fn()
    const result = await cachedGet(key, fetcher, { onRevalidate })
    expect(result.data).toEqual({ v: 1 })
    expect(result.revalidating).toBe(true)

    await vi.runAllTimersAsync()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(onRevalidate).toHaveBeenCalledWith({ v: 2 })
  })

  it('drops expired entries on peek', async () => {
    const key = buildCacheKey('GET', '/contracts?page=1')
    await cachedGet(key, async () => ({ rows: [] }))
    vi.advanceTimersByTime(CLIENT_CACHE_GC_MS + 1)
    expect(peekCache(key)).toBeNull()
  })

  it('force bypasses fresh cache', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ v: 1 }).mockResolvedValueOnce({ v: 2 })
    const key = buildCacheKey('GET', '/contracts?page=1')
    await cachedGet(key, fetcher)
    const forced = await cachedGet(key, fetcher, { force: true })
    expect(forced.data).toEqual({ v: 2 })
    expect(forced.fromCache).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('force bypasses hung inFlight promise', async () => {
    let resolveFirst: ((value: { v: number }) => void) | undefined
    const first = new Promise<{ v: number }>((resolve) => {
      resolveFirst = resolve
    })
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({ v: 2 })
    const key = buildCacheKey('GET', '/shipments?search=1016010973')

    const pending = cachedGet(key, fetcher)
    const forced = await cachedGet(key, fetcher, { force: true })

    expect(forced.data).toEqual({ v: 2 })
    expect(fetcher).toHaveBeenCalledTimes(2)

    resolveFirst?.({ v: 1 })
    await pending
  })
})

describe('prefetchGet', () => {
  beforeEach(() => {
    clearClientDataCache()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips prefetch when cache is fresh', async () => {
    const fetcher = vi.fn().mockResolvedValue(1)
    const key = buildCacheKey('GET', '/oil-loss')
    await cachedGet(key, fetcher)
    prefetchGet(key, fetcher)
    await vi.runAllTimersAsync()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(isCacheFresh(key)).toBe(true)
  })
})

describe('invalidateClientCacheByPathPrefix', () => {
  beforeEach(() => {
    clearClientDataCache()
  })

  it('removes all GET entries for a path prefix', async () => {
    const contractsKey = buildCacheKey('GET', '/contracts?page=1')
    const shipmentsKey = buildCacheKey('GET', '/shipments?page=1')
    await cachedGet(contractsKey, async () => ({ rows: [1] }))
    await cachedGet(shipmentsKey, async () => ({ rows: [2] }))
    invalidateClientCacheByPathPrefix('/contracts')
    expect(peekCache(contractsKey)).toBeNull()
    expect(peekCache(shipmentsKey)).not.toBeNull()
  })
})

describe('invalidateMissingEtaAlertCache', () => {
  beforeEach(() => {
    clearClientDataCache()
  })

  it('removes missing ETA alert cache entry', async () => {
    await cachedGet(MISSING_ETA_ALERT_CACHE_KEY, async () => ({
      total: 5,
      items: [],
      scopedAsStaff: false,
      visible: true,
    }))
    expect(peekCache(MISSING_ETA_ALERT_CACHE_KEY)).not.toBeNull()
    invalidateMissingEtaAlertCache()
    expect(peekCache(MISSING_ETA_ALERT_CACHE_KEY)).toBeNull()
  })

  it('notifies subscribers on invalidation', async () => {
    await cachedGet(MISSING_ETA_ALERT_CACHE_KEY, async () => ({
      total: 1,
      items: [],
      scopedAsStaff: false,
      visible: true,
    }))
    const listener = vi.fn()
    const unsubscribe = subscribeMissingEtaAlertRefresh(listener)
    invalidateMissingEtaAlertCache()
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    invalidateMissingEtaAlertCache()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
