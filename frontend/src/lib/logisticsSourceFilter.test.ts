import { describe, expect, it } from 'vitest'
import {
  isActiveLogisticsSourceFilter,
  LOGISTICS_SOURCE_FILTER_OPTIONS,
  normalizeLogisticsSourceFilter,
} from '@/lib/logisticsSourceFilter'

describe('logisticsSourceFilter', () => {
  it('exposes All Source / Interco / 3rd Party options', () => {
    expect(LOGISTICS_SOURCE_FILTER_OPTIONS.map((o) => o.value)).toEqual([
      'ALL',
      'Interco',
      '3rd Party',
    ])
    expect(LOGISTICS_SOURCE_FILTER_OPTIONS[0]?.label).toBe('All Source')
  })

  it('normalizes empty and unknown to ALL', () => {
    expect(normalizeLogisticsSourceFilter('')).toBe('ALL')
    expect(normalizeLogisticsSourceFilter('All')).toBe('ALL')
    expect(normalizeLogisticsSourceFilter('UNKNOWN')).toBe('ALL')
    expect(normalizeLogisticsSourceFilter('Interco')).toBe('Interco')
  })

  it('detects active source filter', () => {
    expect(isActiveLogisticsSourceFilter('ALL')).toBe(false)
    expect(isActiveLogisticsSourceFilter('Interco')).toBe(true)
  })
})
