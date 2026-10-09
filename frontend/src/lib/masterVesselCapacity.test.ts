import { describe, expect, it } from 'vitest'
import { formatVesselCapacity } from './masterVesselColumns'

describe('formatVesselCapacity', () => {
  it('drops the .00 the NUMERIC column adds and groups thousands', () => {
    expect(formatVesselCapacity('2500.00')).toBe('2,500')
    expect(formatVesselCapacity(2500)).toBe('2,500')
    expect(formatVesselCapacity('12000.00')).toBe('12,000')
  })

  it('keeps a real decimal part', () => {
    expect(formatVesselCapacity('2500.50')).toBe('2,500.5')
    expect(formatVesselCapacity('2500.25')).toBe('2,500.25')
  })

  it('shows a dash for empty or non-numeric values', () => {
    expect(formatVesselCapacity(null)).toBe('-')
    expect(formatVesselCapacity('')).toBe('-')
    expect(formatVesselCapacity('n/a')).toBe('n/a')
  })
})
