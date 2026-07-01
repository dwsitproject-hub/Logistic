import { describe, expect, it } from 'vitest'
import { toSapDisplayNumber } from './sapDisplayNumber'

describe('toSapDisplayNumber', () => {
  it('preserves null for missing SAP values', () => {
    expect(toSapDisplayNumber(null)).toBe(null)
    expect(toSapDisplayNumber(undefined)).toBe(null)
    expect(toSapDisplayNumber('')).toBe(null)
    expect(toSapDisplayNumber('   ')).toBe(null)
  })

  it('preserves real numbers including zero', () => {
    expect(toSapDisplayNumber(0)).toBe(0)
    expect(toSapDisplayNumber('1234.5')).toBe(1234.5)
  })

  it('returns null for non-numeric strings', () => {
    expect(toSapDisplayNumber('abc')).toBe(null)
  })
})
