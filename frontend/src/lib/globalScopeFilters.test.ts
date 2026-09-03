import { describe, expect, it } from 'vitest'
import {
  filterRegionSiteOptions,
  isBlankFilterOption,
  rowMatchesToolbarMultiFilters,
  valueInRegionSiteList,
} from '@/lib/globalScopeFilters'

describe('filterRegionSiteOptions', () => {
  it('drops Blank, empty, and whitespace and collapses case duplicates', () => {
    expect(filterRegionSiteOptions(['BONTANG', 'Blank', '', '  ', 'bontang', 'Tarakan'])).toEqual([
      'BONTANG',
      'Tarakan',
    ])
  })
})

describe('valueInRegionSiteList', () => {
  it('matches destinasi case-insensitively and excludes Blank rows when a dest is selected', () => {
    expect(valueInRegionSiteList('Bontang', ['BONTANG'])).toBe(true)
    expect(valueInRegionSiteList('Blank', ['BONTANG'])).toBe(false)
    expect(valueInRegionSiteList('', ['BONTANG'])).toBe(false)
    expect(valueInRegionSiteList('BONTANG', [])).toBe(true)
  })
})

describe('rowMatchesToolbarMultiFilters Region/Site', () => {
  it('matches plant_site against selected destinasi without treating Blank as a filter value', () => {
    expect(
      rowMatchesToolbarMultiFilters(
        { plant_site: 'Bontang' },
        { selectedGroupPlants: ['BONTANG', 'Blank'] },
      ),
    ).toBe(true)
    expect(
      rowMatchesToolbarMultiFilters({ plant_site: 'Blank' }, { selectedGroupPlants: ['BONTANG'] }),
    ).toBe(false)
  })
})

describe('isBlankFilterOption', () => {
  it('treats blank/empty/whitespace as hidden filter options', () => {
    expect(isBlankFilterOption('Blank')).toBe(true)
    expect(isBlankFilterOption('  ')).toBe(true)
    expect(isBlankFilterOption('BONTANG')).toBe(false)
  })
})
