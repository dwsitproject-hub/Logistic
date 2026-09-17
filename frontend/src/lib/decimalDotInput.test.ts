import { describe, expect, it, vi } from 'vitest'
import {
  blockCommaDecimalKeyDown,
  isBlockedDecimalSeparatorKey,
  parseDecimalDotInput,
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
