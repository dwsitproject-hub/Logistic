/**
 * Shipping Performance outstanding qty aggregation.
 * View Table may repeat PO-level OS on every sibling STO (display only).
 * Cards / tree / By Vessel must not multiply that remainder by STO count.
 *
 * KEEP THIS IDENTICAL TO backend/src/utils/shippingPerformanceOutstandingAgg.ts.
 *
 * It was not, and the drift was invisible because both files carry the same name and export the
 * same function. The backend preferred the SQL-apportioned `outstanding_qty_aggregate`; this copy
 * never read that column at all and always took the fallback. Every figure the page drew -
 * drilldown, cards, By Vessel - therefore ran the legacy path the backend had already measured as
 * understating by 5.76% (203,568,180 kg across 728 STOs).
 *
 * Measured on production, CPO / BONTANG / YTD: the drilldown read 76,863 MT where the same rows
 * through the backend rule come to 79,914 MT, against 81,583 MT on Shipments.
 */

export interface ShippingPerfOutstandingAggRow {
  outstanding_qty_actual?: number | null
  outstanding_qty?: number | null
  /** Already apportioned per PO in SQL (outstandingAggregateSql); safe to sum as-is. */
  outstanding_qty_aggregate?: number | null
  po_sto_count?: number | null
}

/**
 * Share of PO OS attributed to this STO for KPI sums.
 *
 * Prefer the SQL-apportioned value: it divides each PO's OS by how many STOs THAT PO spans.
 * The legacy fallback divides the STO's whole summed OS by one `po_sto_count`, which is the STO's
 * MAX over its POs - that understates every PO spanning fewer STOs than the widest one. It is
 * kept only for rows that predate the column.
 */
export function shippingPerfOutstandingQtyKgForAggregate(
  row: ShippingPerfOutstandingAggRow,
): number {
  const apportioned = Number(row.outstanding_qty_aggregate)
  if (row.outstanding_qty_aggregate != null && Number.isFinite(apportioned)) {
    return apportioned
  }
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
