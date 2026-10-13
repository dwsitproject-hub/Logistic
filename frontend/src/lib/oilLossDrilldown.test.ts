import { describe, expect, it } from 'vitest'
import {
  applyOilLossDrilldownFilters,
  buildNextOilLossDrilldownSelection,
  buildOilLossDrilldownTree,
  countUniqueOilLossContracts,
  EMPTY_OIL_LOSS_DRILLDOWN_FILTERS,
  formatOilLossDrilldownPath,
  groupLabelForRow,
  OIL_LOSS_DRILLDOWN_CATEGORIES,
  oilLossDrilldownColumnSubtitle,
  sumOilLossKgFromRows,
} from '@/lib/oilLossDrilldown'
import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'

function voyage(overrides: Partial<OilLossSourceRow>): OilLossSourceRow {
  return {
    id: 'r',
    transport_mode: 'SEA',
    incoterm: 'FOB',
    product: 'CPO',
    vessel_name: 'MT. GIAT ARMADA 02',
    transporter: 'MT. GIAT ARMADA 02',
    loading_location: 'POM KENDAWANGAN',
    supplier: 'Supp A',
    quantity_delivery: 100_000,
    quantity_received: 90_000,
    ...overrides,
  }
}

describe('oilLossDrilldown levels', () => {
  it('is Product > Vessel > Loading Port > Supplier', () => {
    expect(OIL_LOSS_DRILLDOWN_CATEGORIES.map((c) => c.title)).toEqual(['Product', 'Vessel', 'Loading Port', 'Supplier'])
    expect(OIL_LOSS_DRILLDOWN_CATEGORIES.map((c) => c.level)).toEqual(['product', 'vessel', 'loadingPort', 'supplier'])
  })

  it('no longer has Region/Plant, Incoterm or Transporter columns', () => {
    const levels = OIL_LOSS_DRILLDOWN_CATEGORIES.map((c) => c.level as string)
    for (const gone of ['plant', 'incoterm', 'transporter']) expect(levels).not.toContain(gone)
  })

  it('labels a row by vessel name, falling back to the transporter, and by an upper-cased loading port', () => {
    expect(groupLabelForRow(voyage({ vessel_name: 'MT. A' }), 'vessel')).toBe('MT. A')
    expect(groupLabelForRow(voyage({ vessel_name: '', transporter: 'MT. B' }), 'vessel')).toBe('MT. B')
    expect(groupLabelForRow(voyage({ vessel_name: '', transporter: '' }), 'vessel')).toBe('Blank')
    expect(groupLabelForRow(voyage({ loading_location: ' pom  kendawangan ' }), 'loadingPort')).toBe('POM KENDAWANGAN')
    expect(groupLabelForRow(voyage({ loading_location: null }), 'loadingPort')).toBe('Blank')
  })

  it('column subtitles say what to pick first', () => {
    const f = EMPTY_OIL_LOSS_DRILLDOWN_FILTERS
    expect(oilLossDrilldownColumnSubtitle('vessel', f)).toBe('Pick product first')
    expect(oilLossDrilldownColumnSubtitle('loadingPort', { ...f, product: 'CPO' })).toBe('Pick vessel first')
    expect(oilLossDrilldownColumnSubtitle('supplier', { ...f, product: 'CPO', vessel: 'V' })).toBe('Pick loading port first')
    expect(oilLossDrilldownColumnSubtitle('supplier', { product: 'CPO', vessel: 'V', loadingPort: 'P', supplier: null })).toBe(
      'Under CPO › V › P',
    )
  })

  it('picking a level clears the levels below it and keeps the ones above', () => {
    const full = { product: 'CPO', vessel: 'V', loadingPort: 'P', supplier: 'S' }
    expect(buildNextOilLossDrilldownSelection(full, 'vessel', 'V2')).toEqual({
      product: 'CPO',
      vessel: 'V2',
      loadingPort: null,
      supplier: null,
    })
    expect(buildNextOilLossDrilldownSelection(full, 'loadingPort', 'P2')).toEqual({
      product: 'CPO',
      vessel: 'V',
      loadingPort: 'P2',
      supplier: null,
    })
    expect(buildNextOilLossDrilldownSelection(full, 'product', 'PK')).toEqual({
      product: 'PK',
      vessel: null,
      loadingPort: null,
      supplier: null,
    })
    expect(formatOilLossDrilldownPath(full)).toBe('CPO › V › P › S')
  })
})

describe('oilLossDrilldown tree', () => {
  const rows: OilLossSourceRow[] = [
    voyage({ id: '1', sto_number: 'STO-1', vessel_name: 'MT. A', loading_location: 'PORT 1', supplier: 'Supp A', quantity_delivery: 100_000, quantity_received: 90_000 }),
    voyage({ id: '2', sto_number: 'STO-2', vessel_name: 'MT. A', loading_location: 'PORT 2', supplier: 'Supp B', quantity_delivery: 200_000, quantity_received: 190_000 }),
    voyage({ id: '3', sto_number: 'STO-3', vessel_name: 'MT. B', loading_location: 'PORT 1', supplier: 'Supp A', quantity_delivery: 100_000, quantity_received: 100_000 }),
    voyage({ id: '4', sto_number: 'STO-4', product: 'PK', vessel_name: 'MT. A', loading_location: 'PORT 1', supplier: 'Supp A', quantity_delivery: 50_000, quantity_received: 49_000 }),
  ]

  it('nests Product > Vessel > Loading Port > Supplier', () => {
    const tree = buildOilLossDrilldownTree(rows)
    const cpo = tree.find((n) => n.key === 'CPO')!
    expect(cpo.contractCount).toBe(3)
    const vesselA = cpo.children.find((n) => n.key === 'MT. A')!
    expect(vesselA.contractCount).toBe(2)
    expect(vesselA.children.map((n) => n.key).sort()).toEqual(['PORT 1', 'PORT 2'])
    const port1 = vesselA.children.find((n) => n.key === 'PORT 1')!
    expect(port1.children.map((n) => n.key)).toEqual(['Supp A'])
    // STO-1: (90-100)/100 = -10%, the only voyage of MT. A at PORT 1
    expect(port1.avgLossPct).toBeCloseTo(-10, 4)
    // the same vessel under another product is a separate branch
    expect(tree.find((n) => n.key === 'PK')!.children.map((n) => n.key)).toEqual(['MT. A'])
  })

  it('a node averages the Loss % of its voyages once each (unweighted)', () => {
    const cpo = buildOilLossDrilldownTree(rows).find((n) => n.key === 'CPO')!
    // -10%, -5%, 0% -> -5%
    expect(cpo.avgLossPct).toBeCloseTo(-5, 4)
    expect(cpo.children.find((n) => n.key === 'MT. A')!.avgLossPct).toBeCloseTo(-7.5, 4)
  })

  it('a multi-PO STO is one voyage: one sample, summed quantities', () => {
    const multiPo: OilLossSourceRow[] = [
      voyage({ id: 'a', sto_number: 'STO-9', contract_number: 'CN-1', quantity_delivery: 100_000, quantity_received: 90_000 }),
      voyage({ id: 'b', sto_number: 'STO-9', contract_number: 'CN-2', quantity_delivery: 200_000, quantity_received: 190_000 }),
    ]
    const tree = buildOilLossDrilldownTree(multiPo)
    expect(tree[0].contractCount).toBe(1)
    expect(tree[0].avgLossPct).toBeCloseTo((-20_000 / 300_000) * 100, 4)
    expect(countUniqueOilLossContracts(multiPo)).toBe(1)
    expect(sumOilLossKgFromRows(multiPo)).toBe(-20_000)
  })

  it('a voyage keeps the vessel and loading port of its rows after the merge', () => {
    const tree = buildOilLossDrilldownTree([
      voyage({ id: 'a', sto_number: 'STO-9', contract_number: 'CN-1' }),
      voyage({ id: 'b', sto_number: 'STO-9', contract_number: 'CN-2' }),
    ])
    expect(tree[0].children[0].key).toBe('MT. GIAT ARMADA 02')
    expect(tree[0].children[0].children[0].key).toBe('POM KENDAWANGAN')
  })
})

describe('oilLossDrilldown row filter (what the cards, table and history see after a pick)', () => {
  const rows: OilLossSourceRow[] = [
    voyage({ id: '1', vessel_name: 'MT. A', loading_location: 'PORT 1', supplier: 'Supp A' }),
    voyage({ id: '2', vessel_name: 'MT. A', loading_location: 'PORT 2', supplier: 'Supp B' }),
    voyage({ id: '3', vessel_name: 'MT. B', loading_location: 'PORT 1', supplier: 'Supp A' }),
  ]

  it('returns every row when nothing is picked', () => {
    expect(applyOilLossDrilldownFilters(rows, EMPTY_OIL_LOSS_DRILLDOWN_FILTERS)).toBe(rows)
  })

  it('narrows by vessel, then loading port, then supplier', () => {
    const ids = (f: Partial<typeof EMPTY_OIL_LOSS_DRILLDOWN_FILTERS>) =>
      applyOilLossDrilldownFilters(rows, { ...EMPTY_OIL_LOSS_DRILLDOWN_FILTERS, ...f }).map((r) => r.id)
    expect(ids({ vessel: 'MT. A' })).toEqual(['1', '2'])
    expect(ids({ vessel: 'MT. A', loadingPort: 'PORT 2' })).toEqual(['2'])
    expect(ids({ loadingPort: 'PORT 1', supplier: 'Supp A' })).toEqual(['1', '3'])
  })
})

describe('oilLossDrilldown: a voyage with nothing received is not a 100% loss', () => {
  // The table and the R1-Loss cards show "-" for it (Qty Delivery and Qty Receive must both be above zero); the drilldown said -100%.
  const notReceived = voyage({ id: 'n', sto_number: 'STO-N', vessel_name: 'MT. N', quantity_delivery: 2_999_000, quantity_received: 0 })
  const received = voyage({ id: 'r', sto_number: 'STO-R', vessel_name: 'MT. N', quantity_delivery: 100_000, quantity_received: 90_000 })

  it('has no average of its own, but is still counted as a contract', () => {
    const [cpo] = buildOilLossDrilldownTree([notReceived])
    expect(cpo.contractCount).toBe(1)
    expect(cpo.avgLossPct).toBeNull()
    expect(cpo.children[0].avgLossPct).toBeNull()
  })

  it('does not drag the average of a node that also has a measurable voyage', () => {
    const [cpo] = buildOilLossDrilldownTree([notReceived, received])
    expect(cpo.contractCount).toBe(2)
    expect(cpo.avgLossPct).toBeCloseTo(-10, 4)
  })

  it('adds nothing to the summed loss, and a zero delivery is still not measurable', () => {
    expect(sumOilLossKgFromRows([notReceived])).toBe(0)
    expect(sumOilLossKgFromRows([notReceived, received])).toBe(-10_000)
    const [cpo] = buildOilLossDrilldownTree([voyage({ id: 'z', sto_number: 'STO-Z', quantity_delivery: 0, quantity_received: 50_000 })])
    expect(cpo.avgLossPct).toBeNull()
  })
})
