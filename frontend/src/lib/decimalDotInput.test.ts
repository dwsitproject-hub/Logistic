import { describe, expect, it, vi } from 'vitest'
import {
  blockCommaDecimalKeyDown,
  decimalDraftToValue,
  isBlockedDecimalSeparatorKey,
  parseDecimalDotInput,
  resolveDecimalDraftDisplay,
  sanitizeDecimalDotInput,
} from './decimalDotInput'

describe('sanitizeDecimalDotInput', () => {
  it('allows empty, integers, and single-dot decimals', () => {
    expect(sanitizeDecimalDotInput('')).toBe('')
    expect(sanitizeDecimalDotInput('1000')).toBe('1000')
    expect(sanitizeDecimalDotInput('1000.38')).toBe('1000.38')
    expect(sanitizeDecimalDotInput('.5')).toBe('.5')
    expect(sanitizeDecimalDotInput('1000.')).toBe('1000.')
  })

  it('rejects comma and invalid characters', () => {
    expect(sanitizeDecimalDotInput('1000,38')).toBeNull()
    expect(sanitizeDecimalDotInput('1,000.38')).toBeNull()
    expect(sanitizeDecimalDotInput('12a')).toBeNull()
    expect(sanitizeDecimalDotInput('1.2.3')).toBeNull()
  })
})

describe('parseDecimalDotInput', () => {
  it('parses dot decimals and rejects comma locale input', () => {
    expect(parseDecimalDotInput('1000.38')).toBe(1000.38)
    expect(parseDecimalDotInput('1000,38')).toBeNull()
    expect(parseDecimalDotInput('')).toBeNull()
    expect(parseDecimalDotInput('.')).toBeNull()
  })
})

describe('comma key blocking', () => {
  it('flags comma keys', () => {
    expect(isBlockedDecimalSeparatorKey(',')).toBe(true)
    expect(isBlockedDecimalSeparatorKey('.')).toBe(false)
    expect(isBlockedDecimalSeparatorKey('1')).toBe(false)
  })

  it('preventDefault on comma keydown', () => {
    const preventDefault = vi.fn()
    blockCommaDecimalKeyDown({ key: ',', preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    const preventDot = vi.fn()
    blockCommaDecimalKeyDown({ key: '.', preventDefault: preventDot })
    expect(preventDot).not.toHaveBeenCalled()
  })
})

describe('resolveDecimalDraftDisplay', () => {
  it('keeps a trailing dot, which parses to the same number as the text before it', () => {
    expect(resolveDecimalDraftDisplay('12.', 12)).toBe('12.')
    expect(resolveDecimalDraftDisplay('0.', 0)).toBe('0.')
  })

  it('keeps zeros typed on the way to a decimal (1.0 -> 1.05)', () => {
    expect(resolveDecimalDraftDisplay('1.0', 1)).toBe('1.0')
    expect(resolveDecimalDraftDisplay('1.05', 1.05)).toBe('1.05')
    expect(resolveDecimalDraftDisplay('1.50', 1.5)).toBe('1.50')
  })

  it('keeps a leading dot', () => {
    expect(resolveDecimalDraftDisplay('.', null)).toBe('.')
    expect(resolveDecimalDraftDisplay('.5', 0.5)).toBe('.5')
  })

  it('shows the value when the form changed it away from the draft', () => {
    expect(resolveDecimalDraftDisplay('12.', 40)).toBe('40')
    expect(resolveDecimalDraftDisplay('12.', null)).toBe('')
    expect(resolveDecimalDraftDisplay(null, 7.25)).toBe('7.25')
    expect(resolveDecimalDraftDisplay(null, null)).toBe('')
  })

  it('treats a cleared field as the value the form stores for empty', () => {
    expect(resolveDecimalDraftDisplay('', 0, 0)).toBe('')
    expect(resolveDecimalDraftDisplay('.', 0, 0)).toBe('.')
    // without emptyAs a cleared draft means null, so a stored 0 is shown as 0
    expect(resolveDecimalDraftDisplay('', 0)).toBe('0')
  })

  it('survives the kg <-> MT round trip rounding', () => {
    const mt = 1.005
    const kg = mt * 1000 // 1004.9999999999999
    expect(resolveDecimalDraftDisplay('1.005', kg / 1000)).toBe('1.005')
  })
})

describe('decimalDraftToValue', () => {
  it('parses, and maps empty or a lone dot to emptyAs', () => {
    expect(decimalDraftToValue('12.5')).toBe(12.5)
    expect(decimalDraftToValue('')).toBeNull()
    expect(decimalDraftToValue('.', 0)).toBe(0)
    expect(decimalDraftToValue('', 0)).toBe(0)
  })
})
