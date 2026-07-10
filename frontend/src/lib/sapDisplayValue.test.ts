import { describe, expect, it } from 'vitest'
import {
  formatOperationalTableTextDisplay,
  formatSapDisplayNumber,
  formatSapDisplayValue,
  formatSapQtyMtDisplay,
  formatVesselTableDisplay,
  isEmptySapDisplayValue,
  isEmptySapNumericValue,
  shouldPreserveOperationalTableTextCasing,
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

  it('uppercases vessel names for view tables', () => {
    expect(formatVesselTableDisplay('Mv Pacific Star')).toBe('MV PACIFIC STAR')
    expect(formatVesselTableDisplay(null)).toBe('-')
    expect(formatVesselTableDisplay('Unknown')).toBe('-')
  })

  it('uppercases operational view-table text', () => {
    expect(formatOperationalTableTextDisplay('Port Bontang')).toBe('PORT BONTANG')
    expect(formatOperationalTableTextDisplay(null)).toBe('-')
    expect(formatOperationalTableTextDisplay('Unknown')).toBe('-')
  })

  it('preserves casing for status and LT/SPOT columns', () => {
    expect(shouldPreserveOperationalTableTextCasing('lt_spot')).toBe(true)
    expect(shouldPreserveOperationalTableTextCasing('status')).toBe(true)
    expect(shouldPreserveOperationalTableTextCasing('product')).toBe(false)
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
