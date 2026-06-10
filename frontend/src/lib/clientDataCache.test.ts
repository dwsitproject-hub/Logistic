import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  buildCacheKey,
  cachedGet,
  clearClientDataCache,
  CLIENT_CACHE_GC_MS,
  CLIENT_CACHE_STALE_MS,
  isCacheFresh,
  peekCache,
  prefetchGet,
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
