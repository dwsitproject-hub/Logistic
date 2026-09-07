/**
 * Shipping Performance outstanding qty aggregation.
 * View Table may repeat PO-level OS on every sibling STO (display only).
 * Cards / tree / By Vessel must not multiply that remainder by STO count.
 */

export interface ShippingPerfOutstandingAggRow {
  outstanding_qty_actual?: number | null;
  outstanding_qty?: number | null;
  /** Already apportioned per PO in SQL (outstandingAggregateSql); safe to sum as-is. */
  outstanding_qty_aggregate?: number | null;
  po_sto_count?: number | null;
}

/**
 * Share of PO OS attributed to this STO for KPI sums.
 *
 * Prefer the SQL-apportioned value: it divides each PO's OS by how many STOs THAT PO spans.
 * The legacy fallback divides the STO's whole summed OS by one `po_sto_count`, which is the
 * STO's MAX over its POs - that understated every PO spanning fewer STOs than the widest one
 * by 5.76% (203,568,180 kg) over 728 STOs. It is kept only for rows that predate the column.
 */
export function shippingPerfOutstandingQtyKgForAggregate(
  row: ShippingPerfOutstandingAggRow,
): number {
  const apportioned = Number(row.outstanding_qty_aggregate);
  if (row.outstanding_qty_aggregate != null && Number.isFinite(apportioned)) {
    return apportioned;
  }
  const qty = Number(row.outstanding_qty_actual ?? row.outstanding_qty ?? 0) || 0;
  const n = Number(row.po_sto_count ?? 1);
  const siblings = Number.isFinite(n) && n > 1 ? n : 1;
  return qty / siblings;
}

export function sumShippingPerfOutstandingQtyKg(
  rows: ReadonlyArray<ShippingPerfOutstandingAggRow>,
): number {
  return rows.reduce((sum, row) => sum + shippingPerfOutstandingQtyKgForAggregate(row), 0);
}
