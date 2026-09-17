/**
 * Shipping Performance outstanding qty aggregation.
 * View Table may repeat PO-level OS on every sibling STO (display only).
 * Cards / tree / By Vessel must not multiply that remainder by STO count.
 */

export interface ShippingPerfOutstandingAggRow {
  outstanding_qty_actual?: number | null
  outstanding_qty?: number | null
  po_sto_count?: number | null
}

/** Share of PO OS attributed to this STO for KPI sums. */
export function shippingPerfOutstandingQtyKgForAggregate(
  row: ShippingPerfOutstandingAggRow,
): number {
  const qty = Number(row.outstanding_qty_actual ?? row.outstanding_qty ?? 0) || 0
  const n = Number(row.po_sto_count ?? 1)
  const siblings = Number.isFinite(n) && n > 1 ? n : 1
  return qty / siblings
}

export function sumShippingPerfOutstandingQtyKg(
  rows: ReadonlyArray<ShippingPerfOutstandingAggRow>,
): number {
  return rows.reduce((sum, row) => sum + shippingPerfOutstandingQtyKgForAggregate(row), 0)
}
