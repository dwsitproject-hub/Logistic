import { describe, expect, it } from 'vitest'
import { filterMultiValues, multiValuePillLabel, multiValuesOf, multiValueSortKey, multiValueText, sortMultiValues } from './multiValueCell'

describe('multiValueSortKey', () => {
  it('drops a leading PT, with or without the dot and spaces', () => {
    expect(multiValueSortKey('PT. KPBN')).toBe('kpbn')
    expect(multiValueSortKey('PT ENERGI OLEO PERSADA')).toBe('energi oleo persada')
    expect(multiValueSortKey('pt.AGRO HILIR')).toBe('agro hilir')
  })
  it('keeps names that merely start with the letters PT, and a PT that is not at the start', () => {
    expect(multiValueSortKey('PTPN III')).toBe('ptpn iii')
    expect(multiValueSortKey('SPC PT HOLDING')).toBe('spc pt holding')
  })
})

describe('sortMultiValues', () => {
  it('sorts A-Z ignoring PT, so PT. companies are not all grouped under P', () => {
    expect(
      sortMultiValues(['PT. SEMESTA BUANA', 'PMC GENERAL HO JAKARTA', 'PT. AGRO HILIR ULTIMA INVESTAMA', 'RFI GENERAL HO JAKARTA', 'PT. KPBN']),
    ).toEqual(['PT. AGRO HILIR ULTIMA INVESTAMA', 'PT. KPBN', 'PMC GENERAL HO JAKARTA', 'RFI GENERAL HO JAKARTA', 'PT. SEMESTA BUANA'])
  })
  it('trims, drops empty and "-" entries and repeats (case-insensitive)', () => {
    expect(sortMultiValues(['  B ', 'a', '', '-', null, undefined, 'b'])).toEqual(['a', 'B'])
  })
  it('orders numbers naturally and is stable for equal names', () => {
    expect(sortMultiValues(['Tank 10', 'Tank 2'])).toEqual(['Tank 2', 'Tank 10'])
    expect(sortMultiValues(['PT. KPBN', 'KPBN'])).toEqual(['KPBN', 'PT. KPBN'])
  })
})

describe('multiValuesOf', () => {
  it('uses the list the API sent, even when a name holds a comma', () => {
    expect(multiValuesOf(['PT. FOO, TBK', 'PT. BAR'], 'PT. BAR, PT. FOO, TBK')).toEqual(['PT. BAR', 'PT. FOO, TBK'])
  })
  it('falls back to splitting the text when there is no list', () => {
    expect(multiValuesOf(undefined, 'PT. B; PT. A, PT. C')).toEqual(['PT. A', 'PT. B', 'PT. C'])
    expect(multiValuesOf(null, null)).toEqual([])
  })
})

describe('text and labels', () => {
  it('joins the sorted values, "-" for none', () => {
    expect(multiValueText(['a', 'b'])).toBe('a, b')
    expect(multiValueText([])).toBe('-')
  })
  it('builds the pill label', () => {
    expect(multiValuePillLabel(20, 'companies')).toBe('20 companies')
  })
})

describe('filterMultiValues', () => {
  const values = ['PT. AGRO HILIR', 'PT. KPBN', 'RFI GENERAL HO JAKARTA']
  it('matches anywhere, case-insensitive, and keeps the order', () => {
    expect(filterMultiValues(values, 'jakarta')).toEqual(['RFI GENERAL HO JAKARTA'])
    expect(filterMultiValues(values, '  ')).toEqual(values)
  })
  it('finds a company without typing the PT prefix, and nothing for a miss', () => {
    expect(filterMultiValues(values, 'pt kpbn')).toEqual(['PT. KPBN'])
    expect(filterMultiValues(values, 'kpbn')).toEqual(['PT. KPBN'])
    expect(filterMultiValues(values, 'zzz')).toEqual([])
  })
})
