import { describe, expect, it } from 'vitest'
import {
  formatDateDelta,
  formatKlipSapDelta,
  formatKlipSapDisplayValue,
  formatNumberDelta,
  hasKlipSapMismatch,
  hasKlipSapValue,
  klipSapValuesEqual,
  resolveKlipSapProvenance,
  shouldShowKlipSapFooter,
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

  it('formats empty SAP as em dash without falling back to KLIP', () => {
    expect(formatKlipSapDisplayValue(null, 'date')).toBe('—')
    expect(formatKlipSapDisplayValue('', 'text')).toBe('—')
    expect(formatKlipSapDisplayValue(null, 'number')).toBe('—')
    expect(formatKlipSapDisplayValue('Ketapang', 'text')).toBe('Ketapang')
  })

  it('compares text vessel names case-insensitively', () => {
    expect(klipSapValuesEqual('Vessel B', 'vessel b', 'text')).toBe(true)
    expect(hasKlipSapMismatch('Vessel B', 'Vessel A', 'text')).toBe(true)
    expect(hasKlipSapMismatch('Vessel B', '', 'text')).toBe(false)
    expect(formatKlipSapDelta('Vessel B', 'Vessel A', 'text')).toBeNull()
  })
})

/**
 * The KLIP chip used to be unconditional, so a field the user never opened showed its SAP value
 * with "KLIP" beside it. Nothing in the data records who wrote a value; only whether it still
 * equals SAP's is knowable, and that is what the badge may claim.
 */
describe('hasKlipSapValue', () => {
  it('tells an absent value apart from one that merely matches SAP', () => {
    expect(hasKlipSapValue('', 'text')).toBe(false)
    expect(hasKlipSapValue(null, 'date')).toBe(false)
    expect(hasKlipSapValue(undefined, 'number')).toBe(false)
    expect(hasKlipSapValue('   ', 'text')).toBe(false)

    expect(hasKlipSapValue('BONTANG', 'text')).toBe(true)
    expect(hasKlipSapValue('2026-09-14', 'date')).toBe(true)
    expect(hasKlipSapValue(0, 'number')).toBe(true)
  })

  it('treats a zero as present, because a user can mean zero', () => {
    expect(hasKlipSapValue(0, 'number')).toBe(true)
    expect(hasKlipSapValue('0', 'number')).toBe(true)
  })
})

describe('resolveKlipSapProvenance', () => {
  it('hides provenance when the field is empty', () => {
    expect(resolveKlipSapProvenance({ klipValue: '', sapValue: '', format: 'date' })).toBe('none')
    expect(resolveKlipSapProvenance({ klipValue: null, sapValue: '2026-09-19', format: 'date' })).toBe(
      'none',
    )
  })

  it('treats matching SAP as sap-sourced', () => {
    expect(
      resolveKlipSapProvenance({
        klipValue: '2026-09-19',
        sapValue: '2026-09-19',
        format: 'date',
      }),
    ).toBe('sap')
    expect(shouldShowKlipSapFooter('sap', '2026-09-19', 'date')).toBe(false)
  })

  it('treats mismatch or recorded edit as klip override with SAP footer', () => {
    expect(
      resolveKlipSapProvenance({
        klipValue: '2026-09-21',
        sapValue: '2026-09-19',
        format: 'date',
      }),
    ).toBe('klip')
    expect(
      resolveKlipSapProvenance({
        klipValue: '2026-09-19',
        sapValue: '2026-09-19',
        format: 'date',
        klipEdited: true,
      }),
    ).toBe('klip')
    expect(shouldShowKlipSapFooter('klip', '2026-09-19', 'date')).toBe(true)
    expect(shouldShowKlipSapFooter('klip', '', 'date')).toBe(false)
  })

  it('treats a filled value with no SAP reference as klip without a footer', () => {
    expect(
      resolveKlipSapProvenance({
        klipValue: 'BG. TIGA JAYA',
        sapValue: '',
        format: 'text',
      }),
    ).toBe('klip')
    expect(shouldShowKlipSapFooter('klip', '', 'text')).toBe(false)
  })
})
