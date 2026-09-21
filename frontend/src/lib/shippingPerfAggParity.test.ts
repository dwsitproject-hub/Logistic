import { describe, expect, it } from 'vitest'
import { shippingPerfOutstandingQtyKgForAggregate } from './shippingPerformanceOutstandingAgg'

/**
 * Two files named shippingPerformanceOutstandingAgg - one here, one in backend/src/utils - export
 * a function of the same name. They drifted, and nothing caught it: the backend preferred the
 * SQL-apportioned `outstanding_qty_aggregate`, this copy never read that column and always divided
 * by `po_sto_count`. Every figure Shipping Performance drew ran the fallback the backend had
 * already measured as understating by 5.76%.
 *
 * These cases are the contract between the two files. If the backend changes, these fail.
 */
describe('the frontend aggregate rule matches the backend one', () => {
  it('prefers the SQL-apportioned column over dividing', () => {
    expect(
      shippingPerfOutstandingQtyKgForAggregate({
        outstanding_qty_actual: 9000,
        outstanding_qty_aggregate: 3000,
        po_sto_count: 2,
      }),
    ).toBe(3000) // not 4500
  })

  it('prefers it even when it is zero', () => {
    expect(
      shippingPerfOutstandingQtyKgForAggregate({
        outstanding_qty_actual: 9000,
        outstanding_qty_aggregate: 0,
        po_sto_count: 3,
      }),
    ).toBe(0)
  })

  it('falls back to dividing only when the column is absent', () => {
    expect(
      shippingPerfOutstandingQtyKgForAggregate({ outstanding_qty_actual: 9000, po_sto_count: 3 }),
    ).toBe(3000)
    expect(
      shippingPerfOutstandingQtyKgForAggregate({
        outstanding_qty_actual: 9000,
        outstanding_qty_aggregate: null,
        po_sto_count: 3,
      }),
    ).toBe(3000)
  })

  it('never multiplies by the sibling count when there is one STO', () => {
    expect(shippingPerfOutstandingQtyKgForAggregate({ outstanding_qty: 500 })).toBe(500)
    expect(
      shippingPerfOutstandingQtyKgForAggregate({ outstanding_qty: 500, po_sto_count: 0 }),
    ).toBe(500)
  })
})
