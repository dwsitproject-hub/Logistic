/**
 * In-memory client-side API response cache (stale-while-revalidate).
 * staleTime: 5 min — serve cached data instantly; revalidate in background when stale.
 * gcTime: 30 min — drop entries after this age or when over capacity.
 */

export const CLIENT_CACHE_STALE_MS = 5 * 60 * 1000
export const CLIENT_CACHE_GC_MS = 30 * 60 * 1000
const MAX_ENTRIES = 100

type CacheEntry<T> = {
  data: T
  fetchedAt: number
}

const store = new Map<string, CacheEntry<unknown>>()
const inFlight = new Map<string, Promise<unknown>>()
/** AbortController for each in-flight fetch, keyed the same as `inFlight` - lets replaceInFlight
 * actually cancel the superseded network request instead of only forgetting about it (see
 * fetchAndStore). Populated only for callers that opt into the `(signal) => ...` fetcher shape. */
const inFlightControllers = new Map<string, AbortController>()

/** Normalize URL query (sorted keys, strip cache-bust params) for stable cache keys. */
export function buildCacheKey(method: string, url: string): string {
  const [path, query = ''] = url.split('?')
  const params = new URLSearchParams(query)
  params.delete('_ts')
  const sorted = [...params.entries()].sort(
    (a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]),
  )
  const normalized = new URLSearchParams()
  for (const [k, v] of sorted) normalized.append(k, v)
  const q = normalized.toString()
  return `${method.toUpperCase()}:${path}${q ? `?${q}` : ''}`
}

function isStale(entry: CacheEntry<unknown>): boolean {
  return Date.now() - entry.fetchedAt > CLIENT_CACHE_STALE_MS
}

function isExpired(entry: CacheEntry<unknown>): boolean {
  return Date.now() - entry.fetchedAt > CLIENT_CACHE_GC_MS
}

function evictExpiredAndOverflow(): void {
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    if (now - entry.fetchedAt > CLIENT_CACHE_GC_MS) store.delete(key)
  }
  if (store.size <= MAX_ENTRIES) return
  const oldest = [...store.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)
  const excess = store.size - MAX_ENTRIES
  for (let i = 0; i < excess; i++) store.delete(oldest[i][0])
}

async function fetchAndStore<T>(
  cacheKey: string,
  fetcher: (signal?: AbortSignal) => Promise<T>,
  options?: { replaceInFlight?: boolean },
): Promise<T> {
  const existing = inFlight.get(cacheKey)
  if (existing && !options?.replaceInFlight) return existing as Promise<T>
  if (options?.replaceInFlight) {
    // Actually cancel the superseded request (not just stop tracking it) - without this, every
    // forced refetch (filter change, explicit reload) left the previous network call - and the
    // backend query behind it - running to completion unabandoned. Observed live piling up 8-13
    // duplicate multi-minute queries on the Contract Performance page (2026-09-03).
    inFlightControllers.get(cacheKey)?.abort()
    inFlightControllers.delete(cacheKey)
    inFlight.delete(cacheKey)
  }

  const controller = new AbortController()
  inFlightControllers.set(cacheKey, controller)

  const promise = fetcher(controller.signal)
    .then((data) => {
      store.set(cacheKey, { data, fetchedAt: Date.now() })
      evictExpiredAndOverflow()
      return data
    })
    .finally(() => {
      inFlight.delete(cacheKey)
      if (inFlightControllers.get(cacheKey) === controller) inFlightControllers.delete(cacheKey)
    })

  inFlight.set(cacheKey, promise)
  return promise
}

export function peekCache<T>(cacheKey: string): T | null {
  const entry = store.get(cacheKey)
  if (!entry || isExpired(entry)) {
    if (entry) store.delete(cacheKey)
    return null
  }
  return entry.data as T
}

/** True when entry exists, not garbage-collected, and within stale window. */
export function isCacheFresh(cacheKey: string): boolean {
  const entry = store.get(cacheKey)
  return !!entry && !isExpired(entry) && !isStale(entry)
}

export type CachedGetResult<T> = {
  data: T
  fromCache: boolean
  /** Background network refresh started (stale cache served). */
  revalidating: boolean
}

export async function cachedGet<T>(
  cacheKey: string,
  fetcher: (signal?: AbortSignal) => Promise<T>,
  options?: {
    force?: boolean
    onRevalidate?: (data: T) => void
  },
): Promise<CachedGetResult<T>> {
  const entry = store.get(cacheKey)
  const expired = !entry || isExpired(entry)

  if (!expired && !options?.force) {
    if (!isStale(entry!)) {
      return { data: entry!.data as T, fromCache: true, revalidating: false }
    }
    void fetchAndStore(cacheKey, fetcher)
      .then((data) => options?.onRevalidate?.(data))
      .catch(() => {})
    return { data: entry!.data as T, fromCache: true, revalidating: true }
  }

  const data = await fetchAndStore(cacheKey, fetcher, { replaceInFlight: options?.force })
  return { data, fromCache: false, revalidating: false }
}

const prefetchCooldown = new Map<string, number>()
export const PREFETCH_COOLDOWN_MS = 60 * 1000

/** Fire-and-forget prefetch; respects fresh cache and per-key cooldown. */
export function prefetchGet(cacheKey: string, fetcher: () => Promise<unknown>): void {
  if (isCacheFresh(cacheKey)) return
  const last = prefetchCooldown.get(cacheKey) ?? 0
  if (Date.now() - last < PREFETCH_COOLDOWN_MS) return
  prefetchCooldown.set(cacheKey, Date.now())
  void fetchAndStore(cacheKey, fetcher).catch(() => {})
}

const hrefPrefetchAt = new Map<string, number>()

export const MISSING_ETA_ALERT_CACHE_KEY = buildCacheKey(
  'GET',
  '/alerts/missing-eta-cargo-readiness',
)

const missingEtaAlertSubscribers = new Set<() => void>()

/** Subscribe to missing ETA cache invalidation (e.g. header bell force-refetch). */
export function subscribeMissingEtaAlertRefresh(listener: () => void): () => void {
  missingEtaAlertSubscribers.add(listener)
  return () => {
    missingEtaAlertSubscribers.delete(listener)
  }
}

function notifyMissingEtaAlertSubscribers(): void {
  for (const listener of missingEtaAlertSubscribers) {
    try {
      listener()
    } catch {
      // Non-blocking: subscriber errors must not break invalidation.
    }
  }
}

/** Drop missing ETA alert cache and notify mounted bell to refetch. */
export function invalidateMissingEtaAlertCache(): void {
  store.delete(MISSING_ETA_ALERT_CACHE_KEY)
  inFlight.delete(MISSING_ETA_ALERT_CACHE_KEY)
  notifyMissingEtaAlertSubscribers()
}

/** Clear all cached API responses and prefetch cooldowns (e.g. on logout). */
export function clearClientDataCache(): void {
  store.clear()
  inFlight.clear()
  prefetchCooldown.clear()
  hrefPrefetchAt.clear()
  missingEtaAlertSubscribers.clear()
}

/** Drop cached GET responses whose path starts with the given prefix (e.g. `/contracts`). */
export function invalidateClientCacheByPathPrefix(pathPrefix: string): void {
  const normalized = pathPrefix.startsWith('/') ? pathPrefix : `/${pathPrefix}`
  const needle = `GET:${normalized}`
  for (const key of store.keys()) {
    if (key.startsWith(needle)) store.delete(key)
  }
}

/** After shipment/trucking create or edit — bust list caches so tables reflect mutations immediately. */
export function invalidateLogisticsListCaches(): void {
  invalidateClientCacheByPathPrefix('/contracts')
  invalidateClientCacheByPathPrefix('/shipments')
  invalidateClientCacheByPathPrefix('/trucking')
}

export type PrefetchRequest = {
  cacheKey: string
  fetch: () => Promise<unknown>
}

/** Prefetch all default requests for a navigation href (once per cooldown window). */
export function prefetchNavigationRequests(href: string, requests: PrefetchRequest[]): void {
  const last = hrefPrefetchAt.get(href) ?? 0
  if (Date.now() - last < PREFETCH_COOLDOWN_MS) return
  hrefPrefetchAt.set(href, Date.now())
  for (const req of requests) {
    prefetchGet(req.cacheKey, req.fetch)
  }
}
