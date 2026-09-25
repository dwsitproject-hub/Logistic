import { describe, expect, it } from 'vitest'
import {
  normalizePlanningStatusSelection,
  planningStatusParamValue,
} from '@/lib/planningStatus'

describe('normalizePlanningStatusSelection', () => {
  it('keeps a single value, spelled as the UI spells it', () => {
    expect(normalizePlanningStatusSelection(['Planned'])).toEqual(['Planned'])
    expect(normalizePlanningStatusSelection(['Unplanned'])).toEqual(['Unplanned'])
  })

  /*
   * Both ticked means "no filter" - a completed contract is in neither bucket, so `Planned OR
   * Unplanned` would drop every finished row rather than mean "everything". Keeping both ticked
   * left the box reading "2 selected (OR)" while the page filtered nothing.
   */
  it('collapses both values to no selection', () => {
    expect(normalizePlanningStatusSelection(['Planned', 'Unplanned'])).toEqual([])
    expect(normalizePlanningStatusSelection(['Unplanned', 'Planned'])).toEqual([])
  })

  it('ignores duplicates, casing and anything unrecognised', () => {
    expect(normalizePlanningStatusSelection(['planned', 'PLANNED'])).toEqual(['Planned'])
    expect(normalizePlanningStatusSelection(['Completed'])).toEqual([])
    expect(normalizePlanningStatusSelection([])).toEqual([])
  })

  it('agrees with what the API param builder would send', () => {
    for (const selection of [['Planned'], ['Unplanned'], ['Planned', 'Unplanned'], []]) {
      const collapsed = normalizePlanningStatusSelection(selection)
      expect(planningStatusParamValue(collapsed)).toBe(planningStatusParamValue(selection))
    }
  })
})
