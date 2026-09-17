import { describe, expect, it } from 'vitest'
import {
  buildPerformancePeriodOptions,
  normalizePerformancePeriodKey,
  parsePerformanceContractDateList,
  resolvePerformancePeriodDateRange,
  rowMatchesPerformancePeriod,
  rowMatchesPerformancePeriodAnyDate,
} from '@/lib/performancePeriodFilters'

describe('performancePeriodFilters', () => {
  const augRef = new Date(2026, 7, 3) // 2026-08-03

  it('builds YTD, MTD, then months descending through January', () => {
    const opts = buildPerformancePeriodOptions(augRef)
    expect(opts.map((o) => o.value)).toEqual([
      'YTD',
      'MTD',
      'MONTH_07',
      'MONTH_06',
      'MONTH_05',
      'MONTH_04',
      'MONTH_03',
      'MONTH_02',
      'MONTH_01',
    ])
    expect(opts.map((o) => o.label)).toEqual([
      'YTD',
      'MTD',
      'July',
      'June',
      'May',
      'April',
      'March',
      'February',
      'January',
    ])
  })

  it('builds only YTD and MTD in January', () => {
    const janRef = new Date(2026, 0, 15)
    const opts = buildPerformancePeriodOptions(janRef)
    expect(opts.map((o) => o.value)).toEqual(['YTD', 'MTD'])
  })

  it('builds February and January only in March', () => {
    const marRef = new Date(2026, 2, 10)
    const opts = buildPerformancePeriodOptions(marRef)
    expect(opts.map((o) => o.value)).toEqual(['YTD', 'MTD', 'MONTH_02', 'MONTH_01'])
    expect(opts.slice(2).map((o) => o.label)).toEqual(['February', 'January'])
  })

  it('resolves YTD from Jan 1 to today', () => {
    expect(resolvePerformancePeriodDateRange('YTD', augRef)).toEqual({
      dateFrom: '2026-01-01',
      dateTo: '2026-08-03',
      label: 'YTD',
    })
  })

  it('resolves MTD from 1st of month to today', () => {
    expect(resolvePerformancePeriodDateRange('MTD', augRef)).toEqual({
      dateFrom: '2026-08-01',
      dateTo: '2026-08-03',
      label: 'MTD',
    })
  })

  it('resolves MONTH_07 as full July', () => {
    expect(resolvePerformancePeriodDateRange('MONTH_07', augRef)).toEqual({
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      label: 'July',
    })
  })

  it('resolves MONTH_01 as full January', () => {
    expect(resolvePerformancePeriodDateRange('MONTH_01', augRef)).toEqual({
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      label: 'January',
    })
  })

  it('normalizes legacy CURRENT_MONTH to YTD', () => {
    expect(normalizePerformancePeriodKey('CURRENT_MONTH')).toBe('YTD')
  })

  it('rowMatchesPerformancePeriod is inclusive', () => {
    expect(rowMatchesPerformancePeriod('2026-07-01', '2026-07-01', '2026-07-31')).toBe(true)
    expect(rowMatchesPerformancePeriod('2026-08-01', '2026-07-01', '2026-07-31')).toBe(false)
    expect(rowMatchesPerformancePeriod(null, '2026-07-01', '2026-07-31')).toBe(false)
  })

  it('parsePerformanceContractDateList returns sorted distinct ISO dates', () => {
    expect(parsePerformanceContractDateList('2026-06-19, 2026-06-12, 2026-06-26, 2026-06-19')).toEqual([
      '2026-06-12',
      '2026-06-19',
      '2026-06-26',
    ])
  })

  it('rowMatchesPerformancePeriodAnyDate matches if any date is in range', () => {
    const multi = '2026-06-12, 2026-06-19, 2026-06-26'
    expect(rowMatchesPerformancePeriodAnyDate(multi, '2026-06-15', '2026-06-20')).toBe(true)
    expect(rowMatchesPerformancePeriodAnyDate(multi, '2026-07-01', '2026-07-31')).toBe(false)
    expect(rowMatchesPerformancePeriodAnyDate('2026-06-19', '2026-06-01', '2026-06-30')).toBe(true)
    expect(rowMatchesPerformancePeriodAnyDate('', '2026-06-01', '2026-06-30')).toBe(false)
  })
})
