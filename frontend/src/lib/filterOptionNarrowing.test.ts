import { describe, expect, it } from 'vitest'
import { mergeFilterOptions, narrowFilterOptions } from '@/lib/filterOptionNarrowing'

const ALL = ['CPO', 'PK', 'RBDPS', 'SHELL PALM']

describe('narrowFilterOptions', () => {
  it('shows the full list until the API has answered', () => {
    expect(narrowFilterOptions(ALL, null, [])).toEqual(ALL)
    expect(narrowFilterOptions(ALL, undefined, [])).toEqual(ALL)
  })

  it('keeps only values the table has', () => {
    expect(narrowFilterOptions(ALL, ['CPO', 'PK'], [])).toEqual(['CPO', 'PK'])
  })

  /*
   * The one that matters: a selected value must survive even when no row carries it any more, or
   * it vanishes from the list while still filtering and cannot be unticked.
   */
  it('always keeps a value that is currently selected', () => {
    expect(narrowFilterOptions(ALL, ['CPO'], ['RBDPS'])).toEqual(['CPO', 'RBDPS'])
    expect(narrowFilterOptions(ALL, [], ['SHELL PALM'])).toEqual(['SHELL PALM'])
  })

  it('matches regardless of case and surrounding space', () => {
    expect(narrowFilterOptions(ALL, [' cpo '], [])).toEqual(['CPO'])
  })

  it('preserves the catalogue order', () => {
    expect(narrowFilterOptions(ALL, ['SHELL PALM', 'CPO'], [])).toEqual(['CPO', 'SHELL PALM'])
  })
})

describe('mergeFilterOptions', () => {
  it('stays null until the API has answered, so the caller can fall back', () => {
    expect(mergeFilterOptions(null, ['A'])).toBeNull()
  })

  it('adds a selected value the API did not return, and sorts', () => {
    expect(mergeFilterOptions(['B', 'C'], ['A'])).toEqual(['A', 'B', 'C'])
  })

  it('does not duplicate a selected value the API already returned', () => {
    expect(mergeFilterOptions(['A', 'B'], ['a'])).toEqual(['A', 'B'])
  })
})
