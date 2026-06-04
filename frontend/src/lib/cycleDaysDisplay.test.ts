import { describe, expect, it } from 'vitest'
import { CYCLE_DAYS_NEUTRAL_CLASS, formatAvgDays, statusCardAvgDaysClass } from './cycleDaysDisplay'

describe('formatAvgDays', () => {
  it('returns - days when average is null (no valid samples)', () => {
    expect(formatAvgDays(null)).toBe('- days')
    expect(formatAvgDays(undefined)).toBe('- days')
  })

  it('formats numeric averages', () => {
    expect(formatAvgDays(5)).toBe('5 days')
    expect(formatAvgDays(1)).toBe('1 day')
    expect(formatAvgDays(0)).toBe('0 days')
  })
})

describe('statusCardAvgDaysClass', () => {
  it('uses neutral class when average is missing', () => {
    expect(statusCardAvgDaysClass(null, true)).toBe(CYCLE_DAYS_NEUTRAL_CLASS)
  })
})
