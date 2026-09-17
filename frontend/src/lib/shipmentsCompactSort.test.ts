import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readShipmentsCompactSort,
  SHIPMENTS_COMPACT_SORT_STORAGE_KEY,
  writeShipmentsCompactSort,
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

describe('readShipmentsCompactSort', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to created_at desc when nothing is stored', () => {
    expect(readShipmentsCompactSort()).toEqual({ sortKey: 'created_at', sortDir: 'desc' })
  })

  it('restores vessel_name asc from compact sort storage', () => {
    window.localStorage.setItem(
      SHIPMENTS_COMPACT_SORT_STORAGE_KEY,
      JSON.stringify({ key: 'vessel_name', dir: 'asc' }),
    )
    expect(readShipmentsCompactSort()).toEqual({ sortKey: 'vessel_name', sortDir: 'asc' })
  })

  it('treats unknown dir as desc', () => {
    window.localStorage.setItem(
      SHIPMENTS_COMPACT_SORT_STORAGE_KEY,
      JSON.stringify({ key: 'supplier', dir: 'sideways' }),
    )
    expect(readShipmentsCompactSort()).toEqual({ sortKey: 'supplier', sortDir: 'desc' })
  })
})

describe('writeShipmentsCompactSort', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips through localStorage', () => {
    writeShipmentsCompactSort('vessel_name', 'asc')
    expect(readShipmentsCompactSort()).toEqual({ sortKey: 'vessel_name', sortDir: 'asc' })
  })
})
