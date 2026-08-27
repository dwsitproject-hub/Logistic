export const SHIPMENTS_COMPACT_SORT_STORAGE_KEY = 'shipments.compact.sort'

export interface ShipmentsCompactSort {
  sortKey: string
  sortDir: 'asc' | 'desc'
}

const DEFAULT_SORT: ShipmentsCompactSort = { sortKey: 'created_at', sortDir: 'desc' }

function normalizeSortDir(value: unknown): 'asc' | 'desc' {
  return String(value ?? '').toLowerCase() === 'asc' ? 'asc' : 'desc'
}

/** Persisted compact-table sort. Safe to call during SSR (returns default). */
export function readShipmentsCompactSort(): ShipmentsCompactSort {
  if (typeof window === 'undefined') return { ...DEFAULT_SORT }
  try {
    const stored = window.localStorage.getItem(SHIPMENTS_COMPACT_SORT_STORAGE_KEY)
    if (!stored) return { ...DEFAULT_SORT }
    const parsed = JSON.parse(stored) as { key?: unknown; dir?: unknown }
    const sortKey = String(parsed.key ?? '').trim() || DEFAULT_SORT.sortKey
    return { sortKey, sortDir: normalizeSortDir(parsed.dir) }
  } catch {
    return { ...DEFAULT_SORT }
  }
}

export function writeShipmentsCompactSort(sortKey: string, sortDir: 'asc' | 'desc'): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    SHIPMENTS_COMPACT_SORT_STORAGE_KEY,
    JSON.stringify({ key: sortKey, dir: sortDir }),
  )
}
