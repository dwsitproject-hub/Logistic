import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetShipmentsCompactSort,
  readShipmentsCompactSort,
  SHIPMENTS_COMPACT_SORT_STORAGE_KEY,
} from './shipmentsCompactSort'

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
  return store
}

describe('Shipments table forgets its sort', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is created_at desc when nothing is stored', () => {
    expect(readShipmentsCompactSort()).toEqual({ sortKey: 'created_at', sortDir: 'desc' })
  })

  it('ignores a sort stored by an earlier version, and removes it', () => {
    window.localStorage.setItem(
      SHIPMENTS_COMPACT_SORT_STORAGE_KEY,
      JSON.stringify({ key: 'vessel_name', dir: 'asc' }),
    )
    expect(readShipmentsCompactSort()).toEqual({ sortKey: 'created_at', sortDir: 'desc' })
    expect(window.localStorage.getItem(SHIPMENTS_COMPACT_SORT_STORAGE_KEY)).toBeNull()
  })

  it('forgetShipmentsCompactSort clears the stored value', () => {
    window.localStorage.setItem(SHIPMENTS_COMPACT_SORT_STORAGE_KEY, '{"key":"supplier","dir":"asc"}')
    forgetShipmentsCompactSort()
    expect(window.localStorage.getItem(SHIPMENTS_COMPACT_SORT_STORAGE_KEY)).toBeNull()
  })

  it('is safe where there is no window (server render)', () => {
    vi.unstubAllGlobals()
    expect(() => forgetShipmentsCompactSort()).not.toThrow()
    expect(readShipmentsCompactSort()).toEqual({ sortKey: 'created_at', sortDir: 'desc' })
  })
})
