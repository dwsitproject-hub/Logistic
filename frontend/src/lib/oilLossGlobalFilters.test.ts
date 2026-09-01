import { describe, expect, it } from 'vitest'
import {
  applyOilLossGlobalFilters,
  buildOilLossPeriodOptions,
  matchesOilLossGlobalProductsMultiFilter,
  matchesOilLossGlobalTransportFilter,
  resolveOilLossPeriodDateRange,
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
  const augRef = new Date(2026, 7, 15) // 2026-08-15

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

  it('applyOilLossGlobalFilters uses dateFrom/dateTo overrides when provided', () => {
    const rows = [
      row({ contract_date: '2026-01-10' }),
      row({ contract_date: '2026-07-15' }),
    ]
    const filtered = applyOilLossGlobalFilters({
      rows,
      period: 'YTD',
      transport: 'All',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].contract_date).toBe('2026-07-15')
  })

  it('applyOilLossGlobalFilters with period MTD uses MTD window when no date overrides', () => {
    const rows = [
      row({ contract_date: '2026-07-15' }),
      row({ contract_date: '2026-08-10' }),
    ]
    const filtered = applyOilLossGlobalFilters({
      rows,
      period: 'MTD',
      transport: 'All',
      referenceDate: augRef,
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].contract_date).toBe('2026-08-10')
  })

  it('buildOilLossPeriodOptions includes YTD, MTD, prior months descending; excludes current month', () => {
    const opts = buildOilLossPeriodOptions(augRef)
    expect(opts.map((o) => o.value)).toEqual([
      'YTD',
      'MTD',
      'month-6',
      'month-5',
      'month-4',
      'month-3',
      'month-2',
      'month-1',
      'month-0',
    ])
    expect(opts.map((o) => o.label)).toEqual([
      'YTD',
      'MTD',
      'July',
      'June',
      'May',
      'April',
      'March',
      'February',
      'January',
    ])
    expect(opts.map((o) => o.value)).not.toContain('month-7')
  })

  it('buildOilLossPeriodOptions in January is only YTD and MTD', () => {
    const opts = buildOilLossPeriodOptions(new Date(2026, 0, 15))
    expect(opts.map((o) => o.value)).toEqual(['YTD', 'MTD'])
  })

  it('resolveOilLossPeriodDateRange resolves MTD and YTD', () => {
    expect(resolveOilLossPeriodDateRange('MTD', augRef)).toEqual({
      dateFrom: '2026-08-01',
      dateTo: '2026-08-15',
      label: 'MTD',
    })
    expect(resolveOilLossPeriodDateRange('YTD', augRef)).toEqual({
      dateFrom: '2026-01-01',
      dateTo: '2026-08-15',
      label: 'YTD',
    })
  })

  it('matchesOilLossGlobalTransportFilter unchanged', () => {
    expect(matchesOilLossGlobalTransportFilter(row(), 'All')).toBe(true)
  })
})
