import { describe, expect, it } from 'vitest'
import { exportHeaderWithUnit, exportNumberCell, kgToMtCell, kgToMtNumber, parseExportNumber } from './exportNumbers'

describe('exportNumbers', () => {
  it('parses pg numeric strings, grouped numbers and rejects the rest', () => {
    expect(parseExportNumber('3002849.00')).toBe(3002849)
    expect(parseExportNumber('1,234.5')).toBe(1234.5)
    expect(parseExportNumber(7)).toBe(7)
    expect(parseExportNumber('')).toBeNull()
    expect(parseExportNumber(null)).toBeNull()
    expect(parseExportNumber('-')).toBeNull()
    expect(parseExportNumber('12 MT')).toBeNull()
  })

  it('exportNumberCell is a number, or an empty cell when missing', () => {
    expect(exportNumberCell('2.5')).toBe(2.5)
    expect(exportNumberCell(0)).toBe(0)
    expect(exportNumberCell(undefined)).toBe('')
  })

  it('kg to MT is exact (no whole-MT rounding), 0 when missing, negative stays negative', () => {
    expect(kgToMtNumber(205780)).toBe(205.78)
    expect(kgToMtNumber('3002849.00')).toBe(3002.849)
    expect(kgToMtNumber(null)).toBe(0)
    expect(kgToMtNumber(-60)).toBe(-0.06)
    expect(kgToMtCell(null)).toBe('')
    expect(kgToMtCell(0)).toBe(0)
  })

  it('puts the unit in the header once', () => {
    expect(exportHeaderWithUnit('Contract Qty', 'MT')).toBe('Contract Qty (MT)')
    expect(exportHeaderWithUnit('Contract Qty')).toBe('Contract Qty')
    expect(exportHeaderWithUnit('Gain/Loss Amount (Kg)', 'Kg')).toBe('Gain/Loss Amount (Kg)')
    expect(exportHeaderWithUnit('Gain/Loss %', '%')).toBe('Gain/Loss %')
    expect(exportHeaderWithUnit('Estimated NM', 'NM')).toBe('Estimated NM')
    expect(exportHeaderWithUnit('Vessel Draft', 'm')).toBe('Vessel Draft (m)')
    expect(exportHeaderWithUnit('Freight (IDR/Kg)', 'Kg')).toBe('Freight (IDR/Kg)')
  })
})
