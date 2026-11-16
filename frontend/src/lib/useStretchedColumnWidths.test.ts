import { describe, expect, it } from 'vitest'
import { stretchColumnWidths } from './useStretchedColumnWidths'

describe('stretchColumnWidths', () => {
  it('leaves the compact widths alone when the room is not larger than they add up to', () => {
    expect(stretchColumnWidths([100, 200, 100], 400)).toEqual([100, 200, 100])
    expect(stretchColumnWidths([100, 200, 100], 300)).toEqual([100, 200, 100])
  })

  it('spreads the leftover in proportion to each column and ends exactly at the edge', () => {
    const out = stretchColumnWidths([100, 200, 100], 801)
    expect(out.reduce((a, b) => a + b, 0)).toBe(800)
    expect(out[1]).toBeGreaterThan(out[0])
    expect(out[0]).toBeGreaterThan(100)
  })

  it('keeps the fixed part (Actions, Rank) out of the stretch', () => {
    const out = stretchColumnWidths([100, 100], 600, 56)
    expect(out.reduce((a, b) => a + b, 0) + 56).toBe(599)
  })

  it('does nothing for no columns or an unmeasured room', () => {
    expect(stretchColumnWidths([], 500)).toEqual([])
    expect(stretchColumnWidths([100, 100], Number.NaN)).toEqual([100, 100])
  })
})
