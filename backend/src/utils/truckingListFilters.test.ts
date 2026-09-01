import { describe, expect, it } from 'vitest'
import { appendTruckingSourceTypeFilter } from './truckingListFilters'

describe('appendTruckingSourceTypeFilter', () => {
  it('returns empty SQL for ALL', () => {
    const result = appendTruckingSourceTypeFilter('ALL', 4)
    expect(result.sql).toBe('')
    expect(result.params).toEqual([])
    expect(result.nextIndex).toBe(4)
  })

  it('filters Interco on c.source_type', () => {
    const result = appendTruckingSourceTypeFilter('Interco', 4)
    expect(result.sql).toContain('c.source_type')
    expect(result.sql).toMatch(/INTERCO|INHOUSE/)
    expect(result.params).toEqual([])
    expect(result.nextIndex).toBe(4)
  })

  it('filters 3rd Party on c.source_type', () => {
    const result = appendTruckingSourceTypeFilter('3rd Party', 4)
    expect(result.sql).toContain('c.source_type')
    expect(result.sql).toMatch(/3RD.*PARTY/)
  })
})
