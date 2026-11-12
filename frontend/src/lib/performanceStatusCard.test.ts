import { describe, expect, it } from 'vitest'
import { onTimeLateSplit } from './performanceStatusCard'

describe('onTimeLateSplit', () => {
  it('rounds the labels the way the old badges did and keeps the exact share for the bar', () => {
    const s = onTimeLateSplit(56, 44)
    expect(s.onTimeLabel).toBe('56%')
    expect(s.lateLabel).toBe('44%')
    expect(s.onTimeWidth).toBeCloseTo(56, 5)
    expect(s.onTimeWidth + s.lateWidth).toBeCloseTo(100, 5)
  })

  it('says N/A and draws nothing when no contract is in the card', () => {
    expect(onTimeLateSplit(0, 0)).toEqual({ onTimeLabel: 'N/A', lateLabel: 'N/A', onTimeWidth: 0, lateWidth: 0 })
  })

  it('treats a missing or negative count as zero', () => {
    expect(onTimeLateSplit(Number.NaN, 5).onTimeLabel).toBe('0%')
    expect(onTimeLateSplit(-3, 5).lateWidth).toBe(100)
  })

  it('shows a single side as 100%', () => {
    const s = onTimeLateSplit(10, 0)
    expect(s.onTimeLabel).toBe('100%')
    expect(s.lateLabel).toBe('0%')
  })
})
