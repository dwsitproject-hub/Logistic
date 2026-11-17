/**
 * The Shipments View Table opens on newest-first and does not remember a sort between visits (the rule for every list
 * page: one backend cache key for everybody, and the startup warmers only warm that key). A sort used to be stored here;
 * a stack of up to three columns would make a stale value look as if the table had changed by itself.
 *
 * `readShipmentsCompactSort` is kept for the page prefetch, which must request what the first paint requests: the
 * default. It also clears a sort an earlier version stored.
 */
export const SHIPMENTS_COMPACT_SORT_STORAGE_KEY = 'shipments.compact.sort'

export interface ShipmentsCompactSort {
  sortKey: string
  sortDir: 'asc' | 'desc'
}

/**
 * Newest CONTRACT first (it was created_at, when KLIP first saw the row): the page opens on the contracts people are working on, the way Contracts, Contract Performance,
 * Shipping Performance and Trucking do. The startup warmers (backend/src/services/shipmentSummaryWarmer.service.ts) warm exactly this key, so the first visitor after a restart
 * is served from the cache; measured on production 2026-11-17, a cold page of this sort cost 6.9 s against 5.2 s for created_at, and a warm one about 0 s.
 */
export const DEFAULT_SHIPMENTS_COMPACT_SORT: ShipmentsCompactSort = { sortKey: 'contract_date', sortDir: 'desc' }

/** The sort the table opens on. Safe to call during SSR. */
export function readShipmentsCompactSort(): ShipmentsCompactSort {
  forgetShipmentsCompactSort()
  return { ...DEFAULT_SHIPMENTS_COMPACT_SORT }
}

/** Remove a sort stored by an earlier version. */
export function forgetShipmentsCompactSort(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(SHIPMENTS_COMPACT_SORT_STORAGE_KEY)
  } catch {
    // storage unavailable - there is nothing to forget
  }
}
