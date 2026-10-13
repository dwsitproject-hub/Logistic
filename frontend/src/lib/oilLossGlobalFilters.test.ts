import { describe, expect, it } from 'vitest'
import {
  applyOilLossGlobalFilters,
  buildOilLossPeriodOptions,
  matchesOilLossGlobalProductsMultiFilter,
  matchesOilLossGlobalIncotermFilter,
  oilLossProductOptions,
  resolveOilLossPeriodDateRange,
} from '@/lib/oilLossGlobalFilters'
import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'

function row(overrides: Partial<OilLossSourceRow> = {}): OilLossSourceRow {
  return {
    contract_date: '2026-07-15',
    product: 'CPO',
    group_plant: 'PLANT-A',
    incoterm: 'FOB',
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

  it('the POME option matches POME and WASTE OIL (POME) rows alike, and nothing else that merely contains POME', () => {
    expect(matchesOilLossGlobalProductsMultiFilter(row({ product: 'POME' }), ['POME'])).toBe(true)
    expect(matchesOilLossGlobalProductsMultiFilter(row({ product: 'WASTE OIL (POME)' }), ['POME'])).toBe(true)
    expect(matchesOilLossGlobalProductsMultiFilter(row({ product: 'RPOME' }), ['POME'])).toBe(false)
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
      selectedProducts: ['CPO'],
      selectedGroupPlants: ['PLANT-A'],
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].product).toBe('CPO')
  })

  it('matches Region/Plant destinasi case-insensitively and ignores Blank', () => {
    const rows = [
      row({ product: 'CPO', group_plant: 'Bontang', plant_site: 'Bontang' }),
      row({ product: 'CPO', group_plant: 'Blank', plant_site: 'Blank' }),
    ]
    const filtered = applyOilLossGlobalFilters({
      rows,
      period: 'YTD',
      selectedGroupPlants: ['BONTANG', 'Blank'],
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].plant_site || filtered[0].group_plant).toBe('Bontang')
  })

  it('applyOilLossGlobalFilters uses dateFrom/dateTo overrides when provided', () => {
    const rows = [
      row({ contract_date: '2026-01-10' }),
      row({ contract_date: '2026-07-15' }),
    ]
    const filtered = applyOilLossGlobalFilters({
      rows,
      period: 'YTD',
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

  it('counts FOB transactions only: CIF, CFR and the trucking incoterms are out', () => {
    expect(matchesOilLossGlobalIncotermFilter(row({ incoterm: 'FOB' }))).toBe(true)
    expect(matchesOilLossGlobalIncotermFilter(row({ incoterm: ' fob ' }))).toBe(true)
    for (const incoterm of ['CIF', 'CFR', 'FRC', 'LCO', '', null]) {
      expect(matchesOilLossGlobalIncotermFilter(row({ incoterm: incoterm as string | null }))).toBe(false)
    }
  })

  it('applyOilLossGlobalFilters drops every non-FOB row', () => {
    const rows = [
      row({ id: 'fob', incoterm: 'FOB' }),
      row({ id: 'cif', incoterm: 'CIF' }),
      row({ id: 'cfr', incoterm: 'CFR' }),
      row({ id: 'frc', incoterm: 'FRC', transport_mode: 'LAND' }),
    ]
    expect(applyOilLossGlobalFilters({ rows, period: 'YTD' }).map((r) => r.id)).toEqual(['fob'])
  })

  it('applyOilLossGlobalFilters filters by loading port, case-insensitively, with Blank for a row that has none', () => {
    const rows = [
      row({ id: 'a', loading_location: 'POM KENDAWANGAN' }),
      row({ id: 'b', loading_location: ' pom  kendawangan ' }),
      row({ id: 'c', loading_location: 'PORT TELUK TAPANG' }),
      row({ id: 'd', loading_location: '' }),
    ]
    const ids = (selectedLoadingPorts: string[]) =>
      applyOilLossGlobalFilters({ rows, period: 'YTD', selectedLoadingPorts }).map((r) => r.id)
    expect(ids([])).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(['Pom Kendawangan'])).toEqual(['a', 'b'])
    expect(ids(['PORT TELUK TAPANG', 'Blank'])).toEqual(['c', 'd'])
  })

  it('loading port, product and region/plant combine (AND), so the cards, drilldown and table see one row set', () => {
    const rows = [
      row({ id: 'keep', product: 'CPO', group_plant: 'PLANT-A', loading_location: 'PORT A' }),
      row({ id: 'other-port', product: 'CPO', group_plant: 'PLANT-A', loading_location: 'PORT B' }),
      row({ id: 'other-product', product: 'PK', group_plant: 'PLANT-A', loading_location: 'PORT A' }),
      row({ id: 'other-plant', product: 'CPO', group_plant: 'PLANT-B', loading_location: 'PORT A' }),
    ]
    const out = applyOilLossGlobalFilters({
      rows,
      period: 'YTD',
      selectedProducts: ['CPO'],
      selectedGroupPlants: ['PLANT-A'],
      selectedLoadingPorts: ['PORT A'],
    })
    expect(out.map((r) => r.id)).toEqual(['keep'])
  })
})

describe('oilLossProductOptions', () => {
  const rows = ['CPO', 'PK', 'POME', 'WASTE OIL (POME)', 'SHELL PALM', 'UCO', 'RPO', 'RBDPS', 'UCO', '', null].map((product) => ({ product }))

  it('offers every product the rows have, not only CPO / PK / POME / SHELL PALM', () => {
    expect(oilLossProductOptions(rows, [])).toEqual(['CPO', 'PK', 'POME', 'RBDPS', 'RPO', 'SHELL PALM', 'UCO'])
  })

  it('merges POME and WASTE OIL (POME) into one option', () => {
    expect(oilLossProductOptions([{ product: 'WASTE OIL (POME)' }, { product: 'POME' }], [])).toEqual(['POME'])
  })

  it('keeps a picked product listed and checked in its own spelling, even when no row has it', () => {
    expect(oilLossProductOptions([{ product: 'CPO' }], ['Shell Palm'])).toEqual(['CPO', 'Shell Palm'])
    expect(oilLossProductOptions([{ product: 'SHELL PALM' }], ['Shell Palm'])).toEqual(['Shell Palm'])
  })

  it('shows the fallback list until there are rows or a selection', () => {
    expect(oilLossProductOptions([], [])).toEqual(['CPO', 'PK', 'POME', 'SHELL PALM'])
    expect(oilLossProductOptions([], [], ['CPO', 'UCO'])).toEqual(['CPO', 'UCO'])
  })

  it('the POME option matches POME and WASTE OIL (POME) rows, and a saved Shell Palm selection matches SHELL PALM rows', () => {
    expect(matchesOilLossGlobalProductsMultiFilter(row({ product: 'WASTE OIL (POME)' }), ['POME'])).toBe(true)
    expect(matchesOilLossGlobalProductsMultiFilter(row({ product: 'SHELL PALM' }), ['Shell Palm'])).toBe(true)
    expect(matchesOilLossGlobalProductsMultiFilter(row({ product: 'UCO' }), ['CPO'])).toBe(false)
  })
})
