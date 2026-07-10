import { describe, expect, it } from 'vitest'
import {
  mergeShippingPerfColumnOrder,
  mergeShippingPerfVisibleColumns,
  parseShippingPerfColumnPrefsFromApiValue,
} from './shippingPerformanceColumnPrefs'

describe('shippingPerformanceColumnPrefs', () => {
  it('merges column order without dropping unknown future keys from saved order', () => {
    const all = ['a', 'b', 'c', 'd']
    const merged = mergeShippingPerfColumnOrder(['c', 'a'], all, (order) => order)
    expect(merged).toEqual(['c', 'a', 'b', 'd'])
  })

  it('fills missing visible flags without overwriting saved choices', () => {
    const visible = mergeShippingPerfVisibleColumns(
      { a: false },
      ['a', 'b'],
      (key) => key === 'b',
    )
    expect(visible).toEqual({ a: false, b: true })
  })

  it('parses API value with per-mode blocks', () => {
    const parsed = parseShippingPerfColumnPrefsFromApiValue({
      all: { columnOrder: ['vessel_name', 'sto_number'], visibleColumns: { vessel_name: true } },
    })
    expect(parsed?.all?.columnOrder).toEqual(['vessel_name', 'sto_number'])
    expect(parsed?.all?.visibleColumns).toEqual({ vessel_name: true })
  })
})
