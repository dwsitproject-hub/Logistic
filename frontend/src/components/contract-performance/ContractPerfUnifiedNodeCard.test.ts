import { describe, expect, it } from 'vitest'
import {
  buildSegmentCardTooltip,
  formatSegmentCardAvgTrade,
  formatSegmentCardQtyMt,
} from './ContractPerfUnifiedNodeCard'

describe('ContractPerfUnifiedNodeCard formatters', () => {
  it('formatSegmentCardQtyMt shows MT with grouping', () => {
    expect(formatSegmentCardQtyMt(1_235_702_000)).toBe('1,235,702 MT')
  })

  it('buildSegmentCardTooltip includes contract count and avg trade', () => {
    const tip = buildSegmentCardTooltip({
      count: 2949,
      avgTradeDays: 19.5,
      totalQtyKg: 1_235_702_000,
    })
    expect(tip).toContain('Total Contract: 2,949')
    expect(tip).toContain('Avg Trade: 19.5 days')
  })

  it('formatSegmentCardAvgTrade handles null', () => {
    expect(formatSegmentCardAvgTrade(null)).toBe('—')
  })
})
