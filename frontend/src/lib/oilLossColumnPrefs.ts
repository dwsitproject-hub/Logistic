/**
 * Oil Loss Section 3 — per-user column visibility + order (all views).
 */

export const OIL_LOSS_COLUMN_PREFS_USER_KEY = 'oil_loss.compact.view.v1'

export type OilLossViewModePref = 'all_contract' | 'by_transporter' | 'by_supplier'

export interface OilLossViewColumnPrefValue {
  visibleColumnIds: string[]
  columnOrderIds: string[]
}

export type OilLossColumnPrefsByView = Partial<
  Record<OilLossViewModePref, OilLossViewColumnPrefValue>
>

export function parseOilLossColumnPrefsFromApiValue(value: unknown): OilLossColumnPrefsByView | null {
  if (!value || typeof value !== 'object') return null
  const root = value as Record<string, unknown>
  const out: OilLossColumnPrefsByView = {}
  for (const mode of ['all_contract', 'by_transporter', 'by_supplier'] as const) {
    const block = root[mode]
    if (!block || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    const visibleRaw = record.visibleColumnIds ?? record.visible
    const orderRaw = record.columnOrderIds ?? record.order
    const visibleColumnIds = Array.isArray(visibleRaw) ? visibleRaw.map(String) : []
    const columnOrderIds = Array.isArray(orderRaw) ? orderRaw.map(String) : []
    if (visibleColumnIds.length > 0 || columnOrderIds.length > 0) {
      out[mode] = { visibleColumnIds, columnOrderIds }
    }
  }
  return Object.keys(out).length > 0 ? out : null
}
