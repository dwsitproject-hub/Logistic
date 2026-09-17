import { describe, expect, it } from 'vitest'
import {
  formatContractDateScopeLabel,
  periodRangeMatchesDates,
} from '@/components/performance/PerformanceContractDateControl'
import { resolvePerformancePeriodDateRange } from '@/lib/performancePeriodFilters'

describe('PerformanceContractDateControl helpers', () => {
  const augRef = new Date(2026, 7, 15)
  const resolve = (period: string) =>
    resolvePerformancePeriodDateRange(period as 'YTD' | 'MTD', augRef)

  it('periodRangeMatchesDates compares inclusive ISO bounds', () => {
    const ytd = resolve('YTD')
    expect(periodRangeMatchesDates(ytd, '2026-01-01', '2026-08-15')).toBe(true)
    expect(periodRangeMatchesDates(ytd, '2026-01-01', '2026-08-14')).toBe(false)
  })

  it('formatContractDateScopeLabel uses preset label when dates match', () => {
    const ytd = resolve('YTD')
    expect(formatContractDateScopeLabel('YTD', ytd.dateFrom, ytd.dateTo, resolve)).toBe('YTD')
    expect(
      formatContractDateScopeLabel('YTD', ytd.dateFrom, ytd.dateTo, resolve, { prefix: true }),
    ).toBe('Contract date: YTD')
  })

  it('formatContractDateScopeLabel uses date range when custom', () => {
    expect(
      formatContractDateScopeLabel('YTD', '2026-02-01', '2026-02-28', resolve, { prefix: true }),
    ).toBe('Contract date: 2026-02-01 to 2026-02-28')
    expect(formatContractDateScopeLabel('YTD', '2026-02-01', '2026-02-28', resolve)).toBe(
      '2026-02-01 to 2026-02-28',
    )
  })
})
