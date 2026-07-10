import { describe, expect, it } from 'vitest'
import {
  formatPlanningTemplateDateHeader,
  parsePlanningTemplateDateText,
} from './planningTemplateDateFormat'

describe('planningTemplateDateFormat', () => {
  it('formats date column headers as D-MMM', () => {
    expect(formatPlanningTemplateDateHeader('2026-07-06')).toBe('6-Jul')
    expect(formatPlanningTemplateDateHeader('2026-06-01')).toBe('1-Jun')
  })

  it('formats contract dates with year as D-MMM-YYYY', () => {
    expect(formatPlanningTemplateDateHeader('2026-07-06', { includeYear: true })).toBe('6-Jul-2026')
    expect(formatPlanningTemplateDateHeader('2026-05-01', { includeYear: true })).toBe('1-May-2026')
  })

  it('parses D-MMM-YYYY and D-MMM headers', () => {
    expect(parsePlanningTemplateDateText('6-Jul-2026')).toBe('2026-07-06')
    expect(parsePlanningTemplateDateText('1-Jun', '2026-06-10')).toBe('2026-06-01')
    expect(parsePlanningTemplateDateText('2-Jun', '2026-06-10')).toBe('2026-06-02')
  })

  it('returns null for non-planning date text', () => {
    expect(parsePlanningTemplateDateText('Contract Date')).toBeNull()
    expect(parsePlanningTemplateDateText('')).toBeNull()
  })
})
