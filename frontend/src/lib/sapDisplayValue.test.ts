import { describe, expect, it } from 'vitest'
import { formatSapDisplayValue, isEmptySapDisplayValue } from './sapDisplayValue'

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
})
