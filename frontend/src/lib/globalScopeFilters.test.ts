import { describe, expect, it } from 'vitest'
import {
  alignSelectedToRegionSiteOptions,
  filterRegionSiteOptions,
  isBlankFilterOption,
  rowMatchesToolbarMultiFilters,
  scopeGroupKeyParts,
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

describe('alignSelectedToRegionSiteOptions', () => {
  it('rewrites stored labels onto the option casing and drops Blank', () => {
    expect(
      alignSelectedToRegionSiteOptions(['tanjung pura', 'Blank', 'Tarakan'], ['TANJUNG PURA', 'BONTANG']),
    ).toEqual(['TANJUNG PURA', 'Tarakan'])
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

describe('rowMatchesToolbarMultiFilters Region/Plant', () => {
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

describe('scopeGroupKeyParts', () => {
  it('splits a comma-joined value and keeps a single one whole', () => {
    expect(scopeGroupKeyParts('SUP A, SUP B')).toEqual(['SUP A', 'SUP B'])
    expect(scopeGroupKeyParts('SUP A')).toEqual(['SUP A'])
  })

  it('reports an empty value as Blank rather than as no values', () => {
    expect(scopeGroupKeyParts('')).toEqual(['Blank'])
    expect(scopeGroupKeyParts(null)).toEqual(['Blank'])
    expect(scopeGroupKeyParts(' , ')).toEqual(['Blank'])
  })
})

describe('rowMatchesToolbarMultiFilters — multi-valued supplier and group', () => {
  /*
   * Shipping Performance groups by STO, and 298 of 10,477 STOs span contracts with different
   * suppliers; the API joins those into one string. Before this, ticking either supplier hid the
   * row - real cargo disappearing from the cards and the table with no explanation.
   */
  it('keeps a two-supplier STO when either of its suppliers is selected', () => {
    const row = { supplier: 'SUP A, SUP B' }
    expect(rowMatchesToolbarMultiFilters(row, { selectedSuppliers: ['SUP A'] })).toBe(true)
    expect(rowMatchesToolbarMultiFilters(row, { selectedSuppliers: ['SUP B'] })).toBe(true)
    expect(rowMatchesToolbarMultiFilters(row, { selectedSuppliers: ['SUP C'] })).toBe(false)
  })

  it('applies the same rule to Group Supplier', () => {
    const row = { group_name: 'GROUP ONE, GROUP TWO' }
    expect(rowMatchesToolbarMultiFilters(row, { selectedGroups: ['GROUP TWO'] })).toBe(true)
    expect(rowMatchesToolbarMultiFilters(row, { selectedGroups: ['GROUP THREE'] })).toBe(false)
  })

  it('still matches a single-valued supplier exactly', () => {
    expect(
      rowMatchesToolbarMultiFilters({ supplier: 'SUP A' }, { selectedSuppliers: ['SUP A'] }),
    ).toBe(true)
    expect(
      rowMatchesToolbarMultiFilters({ supplier: 'SUP AB' }, { selectedSuppliers: ['SUP A'] }),
    ).toBe(false)
  })
})
