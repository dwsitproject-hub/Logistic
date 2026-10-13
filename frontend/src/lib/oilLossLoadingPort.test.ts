import { describe, expect, it } from 'vitest'
import {
  filterOilLossPageRows,
  isOilLossPageIncoterm,
} from '@/lib/oilLossEligibility'
import {
  matchesOilLossLoadingPortFilter,
  oilLossLoadingPortLabel,
  oilLossLoadingPortOptions,
} from '@/lib/oilLossLoadingPort'

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
    expect(matchesOilLossLoadingPortFilter({ loading_location: '' }, ['Blank'])).toBe(true)
    expect(matchesOilLossLoadingPortFilter({ loading_location: 'A' }, ['Blank'])).toBe(false)
  })

  it('lists every port the rows have once, sorted, with Blank last', () => {
    const rows = [
      { loading_location: 'PORT B' },
      { loading_location: 'port a' },
      { loading_location: 'PORT A' },
      { loading_location: '' },
      { loading_location: null },
    ]
    expect(oilLossLoadingPortOptions(rows, [])).toEqual(['PORT A', 'PORT B', 'Blank'])
  })

  it('keeps a picked port listed when no row has it, without duplicating one that does', () => {
    expect(oilLossLoadingPortOptions([{ loading_location: 'PORT A' }], ['PORT Z'])).toEqual(['PORT A', 'PORT Z'])
    expect(oilLossLoadingPortOptions([{ loading_location: 'PORT A' }], ['port a'])).toEqual(['port a'])
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
