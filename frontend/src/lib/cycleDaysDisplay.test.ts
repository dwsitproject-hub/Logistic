import { describe, expect, it } from 'vitest'
import {
  CYCLE_DAYS_NEUTRAL_CLASS,
  formatAvgDays,
  formatAvgDaysCompact,
  statusCardAvgDaysClass,
} from './cycleDaysDisplay'

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

describe('formatAvgDaysCompact', () => {
  it('uses a short d unit for wrap metrics', () => {
    expect(formatAvgDaysCompact(12)).toBe('12 d')
    expect(formatAvgDaysCompact(1)).toBe('1 d')
    expect(formatAvgDaysCompact(null)).toBe('-')
  })
})

describe('statusCardAvgDaysClass', () => {
  it('uses neutral class when average is missing', () => {
    expect(statusCardAvgDaysClass(null, true)).toBe(CYCLE_DAYS_NEUTRAL_CLASS)
  })
})
