import { describe, expect, it } from 'vitest'
import {
  shippingPerfOutstandingQtyKgForAggregate,
  sumShippingPerfOutstandingQtyKg,
} from './shippingPerformanceOutstandingAgg'

describe('shippingPerfOutstandingQtyKgForAggregate', () => {
  it('keeps full OS when the PO has a single STO', () => {
    expect(
      shippingPerfOutstandingQtyKgForAggregate({
        outstanding_qty_actual: 40_000,
        po_sto_count: 1,
      }),
    ).toBe(40_000)
  })

  it('splits PO OS across sibling STOs so three 40 MT rows still sum to 40 MT', () => {
    const rows = [
      { outstanding_qty_actual: 40_000, po_sto_count: 3 },
      { outstanding_qty_actual: 40_000, po_sto_count: 3 },
      { outstanding_qty_actual: 40_000, po_sto_count: 3 },
    ]
    expect(shippingPerfOutstandingQtyKgForAggregate(rows[0]!)).toBeCloseTo(40_000 / 3)
    expect(sumShippingPerfOutstandingQtyKg(rows)).toBeCloseTo(40_000)
  })

  it('treats missing po_sto_count as a single STO', () => {
    expect(shippingPerfOutstandingQtyKgForAggregate({ outstanding_qty_actual: 10_000 })).toBe(
      10_000,
    )
  })
})
