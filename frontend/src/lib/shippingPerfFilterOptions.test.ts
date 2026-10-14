import { describe, expect, it } from 'vitest'
import { contractPerfProductOptions } from '@/lib/contractPerformanceFilters'
import { shippingPerfAvailableValues } from '@/lib/shippingPerfFilterOptions'
import { createDischargePortResolver } from '@/lib/dischargePortFilter'

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
  selectedDischargePorts: [],
  selectedSuppliers: [],
  selectedSupplierGroups: [],
  selectedPlanningStatuses: [],
}

describe('Shipping Performance Discharge Port filter', () => {
  const rows = [
    { product: 'CPO', incoterm: 'FOB', plant_site: 'BONTANG', supplier: 'SUP A', port_of_discharge: 'PORT BONTANG', status: 'PLANNED' },
    // same port, other spelling and carried by the SAP side: SAP is the port the table shows
    { product: 'PK', incoterm: 'CIF', plant_site: 'BONTANG', supplier: 'SUP B', sap_vessel_discharge_port: 'Bontang', port_of_discharge: 'DUMAI', status: 'SAILED' },
    { product: 'CPO', incoterm: 'CIF', plant_site: 'BATAM', supplier: 'SUP C', port_of_discharge: 'KIJING', status: 'PLANNED' },
    { product: 'UCO', incoterm: 'FOB', plant_site: 'BATAM', supplier: 'SUP D', port_of_discharge: 'Blank', status: 'PLANNED' },
  ]

  it('offers each port once, spelling variants as one, and no Blank (a row with no port cannot be found through this filter)', () => {
    expect(shippingPerfAvailableValues(rows, NONE).dischargePorts).toEqual(['KIJING', 'PORT BONTANG'])
  })

  it('a picked port narrows the OTHER lists, by the port the table shows (SAP first)', () => {
    const v = shippingPerfAvailableValues(rows, { ...NONE, selectedDischargePorts: ['BONTANG'] })
    expect(v.products).toEqual(['CPO', 'PK'])
    expect(v.incoterms).toEqual(['CIF', 'FOB'])
    expect(v.groupPlants).toEqual(['BONTANG'])
    expect(v.suppliers).toEqual(['SUP A', 'SUP B'])
  })

  it('does not narrow the port list by its own filter', () => {
    const v = shippingPerfAvailableValues(rows, { ...NONE, selectedDischargePorts: ['KIJING'] })
    expect(v.dischargePorts).toEqual(['KIJING', 'PORT BONTANG'])
  })

  it('the other filters narrow the port list', () => {
    expect(shippingPerfAvailableValues(rows, { ...NONE, selectedGroupPlants: ['BATAM'] }).dischargePorts).toEqual(['KIJING'])
    expect(shippingPerfAvailableValues(rows, { ...NONE, selectedProducts: ['PK'] }).dischargePorts).toEqual(['BONTANG'])
  })

  it('keeps a picked port listed when the other filters leave it no row', () => {
    const v = shippingPerfAvailableValues(rows, { ...NONE, selectedDischargePorts: ['TANJUNG PURA'], selectedGroupPlants: ['BATAM'] })
    expect(v.dischargePorts).toEqual(['KIJING', 'TANJUNG PURA'])
  })

  it('a remembered Blank pick means nothing now: it narrows nothing', () => {
    const v = shippingPerfAvailableValues(rows, { ...NONE, selectedDischargePorts: ['Blank'] })
    expect(v.products).toEqual(['CPO', 'PK', 'UCO'])
  })

  describe('through the Master Port mapping', () => {
    const resolver = createDischargePortResolver([
      { identity: 'BONTANG', canonical: 'PORT BONTANG' },
      { identity: 'EUP EDIBLE OIL BONTANG', canonical: 'PORT BONTANG' },
    ])
    const mapped = [
      { product: 'CPO', incoterm: 'FOB', plant_site: 'BONTANG', supplier: 'SUP A', sap_vessel_discharge_port: 'EUP EDIBLE OIL BONTANG', status: 'PLANNED' },
      { product: 'PK', incoterm: 'CIF', plant_site: 'BONTANG', supplier: 'SUP B', port_of_discharge: 'BONTANG', status: 'PLANNED' },
      { product: 'UCO', incoterm: 'FOB', plant_site: 'BATAM', supplier: 'SUP C', sap_vessel_discharge_port: 'EUP TRADING PLANT', status: 'PLANNED' },
    ]

    it('lists the Master Port once, and not the plant name nobody mapped', () => {
      expect(shippingPerfAvailableValues(mapped, { ...NONE, dischargePortResolver: resolver }).dischargePorts).toEqual(['PORT BONTANG'])
      // without the map the plant name is a port of its own
      expect(shippingPerfAvailableValues(mapped, NONE).dischargePorts).toEqual(['BONTANG', 'EUP EDIBLE OIL BONTANG', 'EUP TRADING PLANT'])
    })

    it('a Master Port pick narrows the other lists to the rows of every text that maps to it', () => {
      const v = shippingPerfAvailableValues(mapped, { ...NONE, selectedDischargePorts: ['PORT BONTANG'], dischargePortResolver: resolver })
      expect(v.products).toEqual(['CPO', 'PK'])
      expect(v.suppliers).toEqual(['SUP A', 'SUP B'])
    })
  })
})

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
