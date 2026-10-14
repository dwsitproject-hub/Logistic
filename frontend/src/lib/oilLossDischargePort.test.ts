import { describe, expect, it } from 'vitest'
import {
  matchesOilLossDischargePortFilter,
  oilLossDischargePortLabel,
  oilLossDischargePortOptions,
} from '@/lib/oilLossDischargePort'
import { applyOilLossGlobalFilters } from '@/lib/oilLossGlobalFilters'
import { createDischargePortResolver } from '@/lib/dischargePortFilter'

const row = (over: Record<string, unknown>) => ({
  id: 'x',
  incoterm: 'FOB',
  contract_date: new Date().getFullYear() + '-01-15',
  ...over,
}) as never

describe('oilLossDischargePort', () => {
  it('one port, one label: trimmed, single-spaced, upper-cased; no port is Blank', () => {
    expect(oilLossDischargePortLabel({ unloading_location: '  Port   Bontang ' })).toBe('PORT BONTANG')
    expect(oilLossDischargePortLabel({ unloading_location: '' })).toBe('Blank')
    expect(oilLossDischargePortLabel({ unloading_location: null })).toBe('Blank')
    expect(oilLossDischargePortLabel({})).toBe('Blank')
  })

  it('an empty pick matches everything; otherwise any picked port matches', () => {
    expect(matchesOilLossDischargePortFilter({ unloading_location: 'A' }, [])).toBe(true)
    expect(matchesOilLossDischargePortFilter({ unloading_location: 'a' }, ['A', 'B'])).toBe(true)
    expect(matchesOilLossDischargePortFilter({ unloading_location: 'C' }, ['A', 'B'])).toBe(false)
    // Blank is no pick any more: a remembered one is dropped, and a row with no port is found by no port
    expect(matchesOilLossDischargePortFilter({ unloading_location: '' }, ['Blank'])).toBe(true)
    expect(matchesOilLossDischargePortFilter({ unloading_location: '' }, ['A'])).toBe(false)
  })

  it('PORT BONTANG, Port of Bontang and BONTANG are one port, as on the Shipments list', () => {
    const rows = [{ unloading_location: 'BONTANG' }, { unloading_location: 'PORT OF BONTANG' }, { unloading_location: 'Port Bontang' }]
    expect(rows.every((r) => matchesOilLossDischargePortFilter(r, ['BONTANG']))).toBe(true)
    expect(rows.every((r) => matchesOilLossDischargePortFilter(r, ['PORT BONTANG']))).toBe(true)
    expect(matchesOilLossDischargePortFilter({ unloading_location: 'DUMAI' }, ['BONTANG'])).toBe(false)
    // the dropdown lists the port once
    expect(oilLossDischargePortOptions(rows, [])).toHaveLength(1)
  })

  it('lists every port the rows have once, sorted, without Blank', () => {
    const rows = [
      { unloading_location: 'DUMAI' },
      { unloading_location: 'bontang' },
      { unloading_location: '' },
      { unloading_location: null },
    ]
    expect(oilLossDischargePortOptions(rows, [])).toEqual(['BONTANG', 'DUMAI'])
  })

  it('keeps a picked port listed when no row has it, without duplicating one that does', () => {
    expect(oilLossDischargePortOptions([{ unloading_location: 'DUMAI' }], ['KIJING'])).toEqual(['DUMAI', 'KIJING'])
    expect(oilLossDischargePortOptions([{ unloading_location: 'DUMAI' }], ['dumai'])).toEqual(['DUMAI'])
  })
})

describe('Oil Loss discharge port through the Master Port mapping', () => {
  const resolver = createDischargePortResolver([
    { identity: 'BONTANG', canonical: 'PORT BONTANG' },
    { identity: 'EUP EDIBLE OIL BONTANG', canonical: 'PORT BONTANG' },
  ])
  const rows = [
    row({ id: 'plant', unloading_location: 'EUP EDIBLE OIL BONTANG' }),
    row({ id: 'port', unloading_location: 'PORT BONTANG' }),
    row({ id: 'other', unloading_location: 'DUMAI' }),
  ]

  it('lists the Master Port once and filters every text that maps to it', () => {
    expect(oilLossDischargePortOptions(rows as never[], [], resolver)).toEqual(['PORT BONTANG'])
    const ids = (selectedDischargePorts: string[], r = resolver) =>
      applyOilLossGlobalFilters({ rows: rows as never[], period: 'YTD', selectedDischargePorts, dischargePortResolver: r }).map((x) => x.id)
    expect(ids(['PORT BONTANG'])).toEqual(['plant', 'port'])
    // before the map has loaded the plant name is a port of its own
    expect(ids(['PORT BONTANG'], null as never)).toEqual(['port'])
  })

  it('a text with no Master Port is not offered and not found by a pick (the row stays in the table)', () => {
    const unmapped = [...rows, row({ id: 'trading', unloading_location: 'EUP TRADING PLANT' })]
    expect(oilLossDischargePortOptions(unmapped as never[], [], resolver)).toEqual(['PORT BONTANG'])
    const ids = (selectedDischargePorts: string[]) =>
      applyOilLossGlobalFilters({ rows: unmapped as never[], period: 'YTD', selectedDischargePorts, dischargePortResolver: resolver }).map((x) => x.id)
    expect(ids([])).toEqual(['plant', 'port', 'other', 'trading'])
    expect(ids(['PORT BONTANG'])).toEqual(['plant', 'port'])
  })
})

describe('applyOilLossGlobalFilters with a discharge port', () => {
  it('filters by discharge port and combines (AND) with region/plant, product and loading port', () => {
    const rows = [
      row({ id: 'keep', product: 'CPO', group_plant: 'PLANT-A', loading_location: 'PORT A', unloading_location: 'DUMAI' }),
      row({ id: 'other-discharge', product: 'CPO', group_plant: 'PLANT-A', loading_location: 'PORT A', unloading_location: 'BONTANG' }),
      row({ id: 'other-plant', product: 'CPO', group_plant: 'PLANT-B', loading_location: 'PORT A', unloading_location: 'DUMAI' }),
      row({ id: 'no-discharge', product: 'CPO', group_plant: 'PLANT-A', loading_location: 'PORT A', unloading_location: '' }),
    ]
    const ids = (extra: Record<string, unknown>) =>
      applyOilLossGlobalFilters({ rows, period: 'YTD', ...extra }).map((r) => r.id)
    expect(ids({})).toEqual(['keep', 'other-discharge', 'other-plant', 'no-discharge'])
    expect(ids({ selectedDischargePorts: ['dumai'] })).toEqual(['keep', 'other-plant'])
    expect(ids({ selectedDischargePorts: ['Blank'] })).toEqual(['keep', 'other-discharge', 'other-plant', 'no-discharge'])
    expect(
      ids({
        selectedDischargePorts: ['DUMAI'],
        selectedGroupPlants: ['PLANT-A'],
        selectedProducts: ['CPO'],
        selectedLoadingPorts: ['PORT A'],
      }),
    ).toEqual(['keep'])
  })
})
