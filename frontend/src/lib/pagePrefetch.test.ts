import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPagePrefetchRequests } from './pagePrefetch'
import { SHIPMENTS_COMPACT_SORT_STORAGE_KEY } from './shipmentsCompactSort'

function installMemoryLocalStorage() {
  const store = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
  vi.stubGlobal('window', { localStorage })
}

describe('buildPagePrefetchRequests /shipments', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefetches only the list shell, not summaryOnly', () => {
    const requests = buildPagePrefetchRequests('/shipments')
    expect(requests).toHaveLength(1)
    expect(requests[0].cacheKey).toContain('/shipments?')
    expect(requests[0].cacheKey).toContain('skipSapJoin=true')
    expect(requests[0].cacheKey).toContain('includeSummary=false')
    expect(requests[0].cacheKey).not.toContain('summaryOnly')
  })

  it('uses the persisted compact sort so hover cache matches the first paint', () => {
    window.localStorage.setItem(
      SHIPMENTS_COMPACT_SORT_STORAGE_KEY,
      JSON.stringify({ key: 'vessel_name', dir: 'asc' }),
    )
    const requests = buildPagePrefetchRequests('/shipments')
    expect(requests[0].cacheKey).toContain('sortKey=vessel_name')
    expect(requests[0].cacheKey).toContain('sortDir=asc')
  })
})
