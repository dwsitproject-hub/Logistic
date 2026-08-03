import { describe, expect, it } from 'vitest'
import {
  applyOilLossGlobalFilters,
  matchesOilLossGlobalProductsMultiFilter,
  matchesOilLossGlobalTransportFilter,
} from '@/lib/oilLossGlobalFilters'
import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'

function row(overrides: Partial<OilLossSourceRow> = {}): OilLossSourceRow {
  return {
    contract_date: '2026-07-15',
    product: 'CPO',
    group_plant: 'PLANT-A',
    incoterm: 'CIF',
    transport_mode: 'SEA',
    ...overrides,
  } as OilLossSourceRow
}

describe('oilLossGlobalFilters', () => {
  it('matchesOilLossGlobalProductsMultiFilter uses OR semantics', () => {
    expect(matchesOilLossGlobalProductsMultiFilter(row({ product: 'CPO' }), ['CPO', 'PK'])).toBe(true)
    expect(matchesOilLossGlobalProductsMultiFilter(row({ product: 'PK' }), ['CPO', 'PK'])).toBe(true)
    expect(matchesOilLossGlobalProductsMultiFilter(row({ product: 'POME' }), ['CPO', 'PK'])).toBe(false)
  })

  it('empty product selection matches all products', () => {
    expect(matchesOilLossGlobalProductsMultiFilter(row({ product: 'POME' }), [])).toBe(true)
  })

  it('applyOilLossGlobalFilters filters by product multi and plant', () => {
    const rows = [
      row({ product: 'CPO', group_plant: 'PLANT-A' }),
      row({ product: 'PK', group_plant: 'PLANT-B' }),
    ]
    const filtered = applyOilLossGlobalFilters({
      rows,
      period: 'YTD',
      transport: 'All',
      selectedProducts: ['CPO'],
      selectedGroupPlants: ['PLANT-A'],
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].product).toBe('CPO')
  })

  it('matchesOilLossGlobalTransportFilter unchanged', () => {
    expect(matchesOilLossGlobalTransportFilter(row(), 'All')).toBe(true)
  })
})
