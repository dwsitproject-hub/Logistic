import { describe, expect, it } from 'vitest'
import { deriveRoleCode, isValidRoleCode } from './roleCode'

describe('deriveRoleCode', () => {
  it('turns the names of the document roles into the codes the migration uses', () => {
    expect(deriveRoleCode('BC')).toBe('BC')
    expect(deriveRoleCode('AR UPSTREAM')).toBe('AR_UPSTREAM')
    expect(deriveRoleCode('TAX DOWNSTREAM')).toBe('TAX_DOWNSTREAM')
    expect(deriveRoleCode('  ap   downstream ')).toBe('AP_DOWNSTREAM')
  })

  it('drops digits and punctuation, spells out an ampersand, and strips accents', () => {
    expect(deriveRoleCode('Tax & Claim')).toBe('TAX_AND_CLAIM')
    expect(deriveRoleCode('AR-2 Up/stream')).toBe('AR_UP_STREAM')
    expect(deriveRoleCode('Légal')).toBe('LEGAL')
  })

  it('gives an empty code when nothing usable is left, and only valid codes pass the check', () => {
    expect(deriveRoleCode('123 !!')).toBe('')
    expect(isValidRoleCode('')).toBe(false)
    expect(isValidRoleCode('AR_UPSTREAM')).toBe(true)
    expect(isValidRoleCode('_LEADING')).toBe(false)
    expect(isValidRoleCode('lower')).toBe(false)
  })
})
