import { describe, expect, it } from 'vitest'
import { contractPerfProductOptions } from '@/lib/contractPerformanceFilters'
import { shippingPerfAvailableValues } from '@/lib/shippingPerfFilterOptions'

const ROWS = [
  { product: 'CPO', incoterm: 'FOB', plant_site: 'BONTANG', supplier: 'SUP A', group_name: 'G1', source_type: 'SAP', status: 'PLANNED' },
  { product: 'PK', incoterm: 'CIF', plant_site: 'BATAM', supplier: 'SUP B', group_name: 'G2', source_type: 'SAP', status: 'COMPLETED' },
  { product: 'CPO', incoterm: 'CIF', plant_site: 'BATAM', supplier: 'SUP C, SUP D', group_name: 'G2', source_type: 'SAP', status: 'SAILED' },
]

const NONE = {
  selectedSources: [],
  selectedProducts: [],
  selectedIncoterms: [],
  selectedGroupPlants: [],
  selectedSuppliers: [],
  selectedSupplierGroups: [],
  selectedPlanningStatuses: [],
}

describe('shippingPerfAvailableValues', () => {
  it('offers everything when nothing is selected', () => {
    const v = shippingPerfAvailableValues(ROWS, NONE)
    expect(v.products).toEqual(['CPO', 'PK'])
    expect(v.incoterms).toEqual(['CIF', 'FOB'])
    expect(v.groupPlants).toEqual(['BATAM', 'BONTANG'])
  })

  it('narrows the other lists to what the selection leaves', () => {
    const v = shippingPerfAvailableValues(ROWS, { ...NONE, selectedGroupPlants: ['BONTANG'] })
    expect(v.incoterms).toEqual(['FOB'])
    expect(v.suppliers).toEqual(['SUP A'])
    expect(v.supplierGroups).toEqual(['G1'])
  })

  /*
   * The trap: a list must not be narrowed by its own filter, or picking one value makes every
   * other value disappear and a second one can never be added.
   */
  it('does not narrow a list by its own filter', () => {
    const v = shippingPerfAvailableValues(ROWS, { ...NONE, selectedGroupPlants: ['BONTANG'] })
    expect(v.groupPlants).toEqual(['BATAM', 'BONTANG'])
  })

  it('splits a row that carries several suppliers', () => {
    const v = shippingPerfAvailableValues(ROWS, { ...NONE, selectedIncoterms: ['CIF'] })
    expect(v.suppliers).toEqual(['SUP B', 'SUP C', 'SUP D'])
  })

  it('lets a finished row through the Planning Status filter', () => {
    const v = shippingPerfAvailableValues(ROWS, { ...NONE, selectedPlanningStatuses: ['Planned'] })
    // PLANNED and SAILED count as planned, and the COMPLETED row passes untouched rather than
    // being dropped - Planned and Unplanned describe work still ahead, so a finished shipment is
    // outside the question. Its PK therefore stays on offer.
    expect(v.products).toEqual(['CPO', 'PK'])
    expect(v.supplierGroups).toEqual(['G1', 'G2'])
  })

  it('returns empty lists for an empty dataset rather than throwing', () => {
    expect(shippingPerfAvailableValues([], NONE).products).toEqual([])
  })
})

describe('Shipping Performance Product dropdown', () => {
  const base = { source_type: 'SAP', incoterm: 'FOB', plant_site: 'BONTANG', supplier: 'S', group_name: 'G', status: 'PLANNED' }
  const rows = ['CPO', 'PK', 'POME', 'SHELL PALM', 'UCO', 'RPO', 'RBDPS', 'UCO'].map((product) => ({ ...base, product }))

  it('offers every product the rows have, not only CPO / PK / POME / Shell Palm', () => {
    const available = shippingPerfAvailableValues(rows, NONE)
    expect(contractPerfProductOptions(available.products, [])).toEqual(
      ['CPO', 'PK', 'POME', 'RBDPS', 'RPO', 'Shell Palm', 'UCO'].sort((a, b) => a.localeCompare(b)),
    )
  })

  it('keeps a picked product in the list even when the other filters hide its rows', () => {
    const available = shippingPerfAvailableValues(rows.filter((r) => r.product === 'CPO'), NONE)
    expect(contractPerfProductOptions(available.products, ['UCO'])).toEqual(['CPO', 'UCO'])
  })

  it('shows the four fixed labels until there are rows to derive from', () => {
    expect(contractPerfProductOptions(null, [])).toEqual(['CPO', 'PK', 'POME', 'Shell Palm'])
  })
})
