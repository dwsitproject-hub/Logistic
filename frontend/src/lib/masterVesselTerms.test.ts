import { describe, expect, it } from 'vitest'
import { charterTypeFromMasterTerms } from './masterVesselTerms'

describe('charterTypeFromMasterTerms', () => {
  it('maps V/C and T/C terms', () => {
    expect(charterTypeFromMasterTerms('V/C')).toBe('V/C')
    expect(charterTypeFromMasterTerms('T/C')).toBe('T/C')
    expect(charterTypeFromMasterTerms('t/c')).toBe('T/C')
  })

  it('returns empty for missing or invalid terms', () => {
    expect(charterTypeFromMasterTerms(null)).toBe('')
    expect(charterTypeFromMasterTerms('')).toBe('')
    expect(charterTypeFromMasterTerms('CIF')).toBe('')
  })
})
