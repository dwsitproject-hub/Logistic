import { describe, expect, it } from 'vitest'
import { formatProductList, topGroupVendorRollups, type GroupVendorSourceRow } from './claimGroupVendorRollup'

const line = (
  group: string | null,
  vendor: string,
  product: string,
  qty: number,
  amount: number,
): GroupVendorSourceRow => ({
  group_vendor: group,
  vendor,
  product,
  qty_claim: qty,
  amount_after_tax_idr: amount,
})

describe('topGroupVendorRollups', () => {
  it('rolls a group up, lists every product, and ranks by amount after tax', () => {
    const rows = topGroupVendorRollups([
      line('APICAL', 'SUPRA', 'CPO', 400, 1),
      line('INTERCO', 'LAWANA', 'CPO', 10, 20),
      line('INTERCO', 'LAWANA', 'PK', 5, 30),
      line('INTERCO', 'OTHER', 'CPO', 1, 5),
      line(null, 'MAXIMA', 'CPO', 100, 9),
    ])
    expect(rows.map((r) => r.label)).toEqual(['INTERCO', '-', 'APICAL'])
    expect(rows[0].amount_after_tax_idr).toBe(55)
    expect(rows[0].qty_claim).toBe(16)
    expect(rows[0].products).toEqual(['CPO', 'PK'])
    expect(rows[0].vendors.map((v) => v.vendor)).toEqual(['LAWANA', 'OTHER'])
    expect(rows[0].vendors[0].products).toEqual(['CPO', 'PK'])
    expect(formatProductList(rows[0].products)).toBe('CPO, PK')
    expect(formatProductList([])).toBe('-')
  })

  it('keeps only the five groups with the largest amount', () => {
    const rows = topGroupVendorRollups(
      ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => line(name, name, 'CPO', 1, (i + 1) * 10)),
    )
    expect(rows.map((r) => r.label)).toEqual(['F', 'E', 'D', 'C', 'B'])
  })
})
