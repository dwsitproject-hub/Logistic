import { describe, expect, it } from 'vitest'
import {
  matchesOilLossDischargePortFilter,
  oilLossDischargePortLabel,
  oilLossDischargePortOptions,
} from '@/lib/oilLossDischargePort'
import { applyOilLossGlobalFilters } from '@/lib/oilLossGlobalFilters'

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
    expect(matchesOilLossDischargePortFilter({ unloading_location: '' }, ['Blank'])).toBe(true)
    expect(matchesOilLossDischargePortFilter({ unloading_location: 'A' }, ['Blank'])).toBe(false)
  })

  it('PORT BONTANG, Port of Bontang and BONTANG are one port, as on the Shipments list', () => {
    const rows = [{ unloading_location: 'BONTANG' }, { unloading_location: 'PORT OF BONTANG' }, { unloading_location: 'Port Bontang' }]
    expect(rows.every((r) => matchesOilLossDischargePortFilter(r, ['BONTANG']))).toBe(true)
    expect(rows.every((r) => matchesOilLossDischargePortFilter(r, ['PORT BONTANG']))).toBe(true)
    expect(matchesOilLossDischargePortFilter({ unloading_location: 'DUMAI' }, ['BONTANG'])).toBe(false)
    // the dropdown lists the port once
    expect(oilLossDischargePortOptions(rows, [])).toHaveLength(1)
  })

  it('lists every port the rows have once, sorted, with Blank last', () => {
    const rows = [
      { unloading_location: 'DUMAI' },
      { unloading_location: 'bontang' },
      { unloading_location: '' },
      { unloading_location: null },
    ]
    expect(oilLossDischargePortOptions(rows, [])).toEqual(['BONTANG', 'DUMAI', 'Blank'])
  })

  it('keeps a picked port listed when no row has it, without duplicating one that does', () => {
    expect(oilLossDischargePortOptions([{ unloading_location: 'DUMAI' }], ['KIJING'])).toEqual(['DUMAI', 'KIJING'])
    expect(oilLossDischargePortOptions([{ unloading_location: 'DUMAI' }], ['dumai'])).toEqual(['DUMAI'])
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
    expect(ids({ selectedDischargePorts: ['Blank'] })).toEqual(['no-discharge'])
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
