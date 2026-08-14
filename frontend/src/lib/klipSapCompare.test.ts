import { describe, expect, it } from 'vitest'
import {
  formatDateDelta,
  formatKlipSapDelta,
  formatNumberDelta,
  hasKlipSapMismatch,
  klipSapValuesEqual,
} from './klipSapCompare'

describe('klipSapCompare', () => {
  it('detects date mismatch', () => {
    expect(klipSapValuesEqual('2026-07-05', '2026-07-03', 'date')).toBe(false)
    expect(hasKlipSapMismatch('2026-07-05', '2026-07-03', 'date')).toBe(true)
  })

  it('formats date delta in days', () => {
    expect(formatDateDelta('2026-07-05', '2026-07-03')).toBe('+2d')
    expect(formatKlipSapDelta('2026-07-01', '2026-07-03', 'date')).toBe('-2d')
  })

  it('detects number mismatch', () => {
    expect(klipSapValuesEqual(0.52, 0.48, 'number')).toBe(false)
    expect(formatNumberDelta(0.52, 0.48)).toBe('+0.04')
  })

  it('treats empty SAP as no mismatch highlight', () => {
    expect(hasKlipSapMismatch('2026-07-05', '', 'date')).toBe(false)
    expect(hasKlipSapMismatch(0.5, null, 'number')).toBe(false)
  })

  it('compares text vessel names case-insensitively', () => {
    expect(klipSapValuesEqual('Vessel B', 'vessel b', 'text')).toBe(true)
    expect(hasKlipSapMismatch('Vessel B', 'Vessel A', 'text')).toBe(true)
    expect(hasKlipSapMismatch('Vessel B', '', 'text')).toBe(false)
    expect(formatKlipSapDelta('Vessel B', 'Vessel A', 'text')).toBeNull()
  })
})
