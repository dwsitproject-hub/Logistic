import { describe, expect, it } from 'vitest'
import {
  formatSapDisplayNumber,
  formatSapDisplayValue,
  formatSapQtyMtDisplay,
  isEmptySapDisplayValue,
  isEmptySapNumericValue,
} from './sapDisplayValue'

describe('sapDisplayValue', () => {
  it('treats nullish and SAP placeholders as empty', () => {
    expect(isEmptySapDisplayValue(null)).toBe(true)
    expect(isEmptySapDisplayValue(undefined)).toBe(true)
    expect(isEmptySapDisplayValue('')).toBe(true)
    expect(isEmptySapDisplayValue('  ')).toBe(true)
    expect(isEmptySapDisplayValue('Unknown')).toBe(true)
    expect(isEmptySapDisplayValue('BLANK')).toBe(true)
    expect(isEmptySapDisplayValue('null')).toBe(true)
  })

  it('formats empty values as hyphen', () => {
    expect(formatSapDisplayValue(null)).toBe('-')
    expect(formatSapDisplayValue('Unknown')).toBe('-')
    expect(formatSapDisplayValue('Blank')).toBe('-')
  })

  it('preserves real SAP text', () => {
    expect(formatSapDisplayValue('PORT BONTANG')).toBe('PORT BONTANG')
    expect(formatSapDisplayValue('  WASTE OIL  ')).toBe('WASTE OIL')
  })

  it('treats nullish numeric SAP values as empty', () => {
    expect(isEmptySapNumericValue(null)).toBe(true)
    expect(isEmptySapNumericValue(undefined)).toBe(true)
    expect(isEmptySapNumericValue('')).toBe(true)
    expect(isEmptySapNumericValue('abc')).toBe(true)
    expect(isEmptySapNumericValue(0)).toBe(false)
  })

  it('formats missing numeric SAP values as hyphen', () => {
    expect(formatSapDisplayNumber(null)).toBe('-')
    expect(formatSapDisplayNumber(undefined)).toBe('-')
    expect(formatSapDisplayNumber('')).toBe('-')
    expect(formatSapDisplayNumber(0)).toBe('0')
    expect(formatSapDisplayNumber(1234.5)).toBe('1,234.5')
  })

  it('formats missing SAP qty as hyphen', () => {
    expect(formatSapQtyMtDisplay(null)).toBe('-')
    expect(formatSapQtyMtDisplay(1000)).toBe('1 MT')
  })
})
