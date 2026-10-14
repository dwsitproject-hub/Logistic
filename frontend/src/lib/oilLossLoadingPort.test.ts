import { describe, expect, it } from 'vitest'
import {
  filterOilLossPageRows,
  isOilLossPageIncoterm,
} from '@/lib/oilLossEligibility'
import {
  isOilLossTruckRow,
  matchesOilLossLoadingPortFilter,
  oilLossDrawnLocation,
  oilLossLoadingPortLabel,
  oilLossLoadingPortOptions,
} from '@/lib/oilLossLoadingPort'
import { createDischargePortResolver } from '@/lib/dischargePortFilter'
import { setPortDisplayResolver } from '@/lib/portDisplay'

describe('oilLossLoadingPort', () => {
  it('one port, one label: trimmed, single-spaced, upper-cased', () => {
    expect(oilLossLoadingPortLabel({ loading_location: '  Pom   Kendawangan ' })).toBe('POM KENDAWANGAN')
    expect(oilLossLoadingPortLabel({ loading_location: '' })).toBe('Blank')
    expect(oilLossLoadingPortLabel({ loading_location: null })).toBe('Blank')
    expect(oilLossLoadingPortLabel({})).toBe('Blank')
  })

  it('an empty pick matches everything; otherwise any picked port matches', () => {
    expect(matchesOilLossLoadingPortFilter({ loading_location: 'A' }, [])).toBe(true)
    expect(matchesOilLossLoadingPortFilter({ loading_location: 'a' }, ['A', 'B'])).toBe(true)
    expect(matchesOilLossLoadingPortFilter({ loading_location: 'C' }, ['A', 'B'])).toBe(false)
    // Blank is no pick any more: a remembered one is dropped, and a row with no port is found by no port
    expect(matchesOilLossLoadingPortFilter({ loading_location: '' }, ['Blank'])).toBe(true)
    expect(matchesOilLossLoadingPortFilter({ loading_location: '' }, ['A'])).toBe(false)
  })

  it('lists every port the rows have once, sorted, without Blank', () => {
    const rows = [
      { loading_location: 'PORT B' },
      { loading_location: 'port a' },
      { loading_location: 'PORT A' },
      { loading_location: '' },
      { loading_location: null },
    ]
    expect(oilLossLoadingPortOptions(rows, [])).toEqual(['PORT A', 'PORT B'])
  })

  it('keeps a picked port listed when no row has it, without duplicating one that does', () => {
    expect(oilLossLoadingPortOptions([{ loading_location: 'PORT A' }], ['PORT Z'])).toEqual(['PORT A', 'PORT Z'])
    expect(oilLossLoadingPortOptions([{ loading_location: 'PORT A' }], ['port a'])).toEqual(['PORT A'])
  })
})

describe('Oil Loss page incoterm rule', () => {
  it('is FOB only', () => {
    expect(isOilLossPageIncoterm('FOB')).toBe(true)
    expect(isOilLossPageIncoterm(' fob')).toBe(true)
    for (const other of ['CIF', 'CFR', 'FRC', 'LCO', '', null, undefined]) {
      expect(isOilLossPageIncoterm(other)).toBe(false)
    }
  })

  it('filterOilLossPageRows keeps the FOB rows and nothing else', () => {
    const rows = [{ incoterm: 'FOB' }, { incoterm: 'CIF' }, { incoterm: 'FRC' }, { incoterm: 'fob' }]
    expect(filterOilLossPageRows(rows)).toEqual([{ incoterm: 'FOB' }, { incoterm: 'fob' }])
  })
})

describe('Oil Loss loading port through the Master Port', () => {
  const resolver = createDischargePortResolver([
    { identity: 'BONEMANJING', canonical: 'PORT BONE MANJING' },
    { identity: 'ASIKE', canonical: 'PORT ASIKE' },
  ])
  const sea = (text: string) => ({ transport_mode: 'SEA', loading_location: text })
  const truck = (text: string) => ({ transport_mode: 'LAND', loading_location: text })

  it('lists only Master Ports, once each, from vessel rows; a mill nobody mapped and every truck row are not offered', () => {
    const rows = [sea('PORT OF BONEMANJING'), sea('Port Asike'), sea('PORT ASIKE'), sea('PKS MAJU KALIMANTAN'), truck('PORT ASIKE'), sea('')]
    expect(oilLossLoadingPortOptions(rows, [], resolver)).toEqual(['PORT ASIKE', 'PORT BONE MANJING'])
  })

  it('a pick finds the vessel rows whose text is that Master Port, never a text with none, never a truck row', () => {
    expect(matchesOilLossLoadingPortFilter(sea('PORT OF BONEMANJING'), ['PORT BONE MANJING'], resolver)).toBe(true)
    expect(matchesOilLossLoadingPortFilter(sea('PKS MAJU KALIMANTAN'), ['PORT BONE MANJING'], resolver)).toBe(false)
    expect(matchesOilLossLoadingPortFilter(sea('PKS MAJU KALIMANTAN'), ['PKS MAJU KALIMANTAN'], resolver)).toBe(false)
    expect(matchesOilLossLoadingPortFilter(truck('PORT ASIKE'), ['PORT ASIKE'], resolver)).toBe(false)
    expect(matchesOilLossLoadingPortFilter(truck('PORT ASIKE'), [], resolver)).toBe(true)
  })

  it('a truck row is the row the SAP mode says is LAND; a row with no mode is read as a vessel row', () => {
    expect(isOilLossTruckRow({ transport_mode: 'LAND' })).toBe(true)
    expect(isOilLossTruckRow({ transport_mode: ' land ' })).toBe(true)
    expect(isOilLossTruckRow({ transport_mode: 'SEA' })).toBe(false)
    expect(isOilLossTruckRow({})).toBe(false)
  })

  it('the drilldown label and the drawn location are the Master Port for a vessel row, the original text otherwise', () => {
    setPortDisplayResolver(resolver)
    try {
      expect(oilLossLoadingPortLabel(sea('PORT OF BONEMANJING'))).toBe('PORT BONE MANJING')
      expect(oilLossLoadingPortLabel(sea('PKS MAJU KALIMANTAN'))).toBe('PKS MAJU KALIMANTAN')
      expect(oilLossLoadingPortLabel(truck('PORT OF BONEMANJING'))).toBe('PORT OF BONEMANJING')
      expect(oilLossLoadingPortLabel({ loading_location: '' })).toBe('Blank')
      expect(oilLossDrawnLocation({ transport_mode: 'SEA', loading_location: 'PORT OF BONEMANJING' }, 'loading_location')).toBe('PORT BONE MANJING')
      expect(oilLossDrawnLocation({ transport_mode: 'LAND', unloading_location: 'PORT OF BONEMANJING' }, 'unloading_location')).toBe('PORT OF BONEMANJING')
      expect(oilLossDrawnLocation({ transport_mode: 'SEA', unloading_location: null }, 'unloading_location')).toBeNull()
    } finally {
      setPortDisplayResolver(null)
    }
  })
})
