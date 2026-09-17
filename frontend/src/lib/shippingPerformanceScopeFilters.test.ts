import { describe, expect, it } from 'vitest'
import { applyShippingPerfSourceProductFilter } from './shippingPerformanceScopeFilters'

describe('applyShippingPerfSourceProductFilter', () => {
  const rows = [
    { id: '1', source_type: 'Intercompany', product: 'CPO' },
    { id: '2', source_type: '3rd Party', product: 'PK' },
    { id: '3', source_type: 'Inhouse', product: 'CPO Crude' },
    { id: '4', source_type: null, product: 'POME' },
  ]

  it('returns all rows when Source and Product selections are empty (All)', () => {
    expect(applyShippingPerfSourceProductFilter(rows, [], [])).toHaveLength(4)
  })

  it('filters Interco without refetch semantics (client only)', () => {
    const filtered = applyShippingPerfSourceProductFilter(rows, ['Interco'], [])
    expect(filtered.map((r) => r.id)).toEqual(['1', '3'])
  })

  it('filters Product tab with Source combined', () => {
    const filtered = applyShippingPerfSourceProductFilter(rows, ['Interco'], ['CPO'])
    expect(filtered.map((r) => r.id)).toEqual(['1', '3'])
  })

  it('excludes blank source from Interco / 3rd Party', () => {
    expect(
      applyShippingPerfSourceProductFilter(rows, ['3rd Party'], []).map((r) => r.id),
    ).toEqual(['2'])
  })
})
