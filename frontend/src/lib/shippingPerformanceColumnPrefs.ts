/**
 * Persisted column layout for Shipping Performance Section 3 table.
 */

export type ShippingPerfTableViewMode = 'all' | 'by_vessel'

export interface ShippingPerfColumnPrefs {
  columnOrder: string[]
  visibleColumns: Record<string, boolean>
}

export type ShippingPerfColumnPrefsByMode = Record<
  ShippingPerfTableViewMode,
  ShippingPerfColumnPrefs
>

export const SHIPPING_PERF_COLUMN_PREFS_STORAGE_KEY =
  'shipping_performance.tableColumns.v1'

export const SHIPPING_PERF_COLUMN_PREFS_USER_KEY =
  'shipping_performance.compact.view.v1'

export function mergeShippingPerfColumnOrder(
  order: readonly string[],
  allColumnKeys: readonly string[],
  ensureOrderForMode: (merged: string[]) => string[],
): string[] {
  const known = new Set(allColumnKeys)
  const deduped = order.filter((key) => known.has(key))
  const missing = allColumnKeys.filter((key) => !deduped.includes(key))
  return ensureOrderForMode([...deduped, ...missing])
}

/** Fill missing column keys with defaults; never overwrite keys the user already set. */
export function mergeShippingPerfVisibleColumns(
  visible: Record<string, boolean>,
  allColumnKeys: readonly string[],
  defaultVisibleForKey: (key: string) => boolean,
): Record<string, boolean> {
  const next: Record<string, boolean> = { ...visible }
  for (const key of allColumnKeys) {
    if (!(key in next)) {
      next[key] = defaultVisibleForKey(key)
    }
  }
  return next
}

export function readShippingPerfColumnPrefsFromStorage(): Partial<ShippingPerfColumnPrefsByMode> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(SHIPPING_PERF_COLUMN_PREFS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ShippingPerfColumnPrefsByMode>
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function writeShippingPerfColumnPrefsToStorage(prefs: ShippingPerfColumnPrefsByMode): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SHIPPING_PERF_COLUMN_PREFS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* ignore quota errors */
  }
}

export function parseShippingPerfColumnPrefsFromApiValue(
  value: unknown,
): Partial<ShippingPerfColumnPrefsByMode> | null {
  if (!value || typeof value !== 'object') return null
  const root = value as Record<string, unknown>
  const out: Partial<ShippingPerfColumnPrefsByMode> = {}

  for (const mode of ['all', 'by_vessel'] as const) {
    const block = root[mode]
    if (!block || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    const columnOrder = Array.isArray(record.columnOrder)
      ? record.columnOrder.map(String)
      : Array.isArray(record.columnOrderIds)
        ? record.columnOrderIds.map(String)
        : null
    const visibleRaw = record.visibleColumns ?? record.visible
    const visibleColumns =
      visibleRaw && typeof visibleRaw === 'object' && !Array.isArray(visibleRaw)
        ? Object.fromEntries(
            Object.entries(visibleRaw as Record<string, unknown>).map(([k, v]) => [k, Boolean(v)]),
          )
        : null
    if (columnOrder || visibleColumns) {
      out[mode] = {
        columnOrder: columnOrder ?? [],
        visibleColumns: visibleColumns ?? {},
      }
    }
  }

  return Object.keys(out).length > 0 ? out : null
}
