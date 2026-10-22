import { describe, expect, it } from 'vitest'
import {
  MIN_PASSWORD_LENGTH,
  describePasswordLink,
  readTokenFromSearch,
  validateNewPassword,
} from './passwordLink'

describe('readTokenFromSearch', () => {
  it('reads the token with or without the leading ?', () => {
    expect(readTokenFromSearch('?token=abc_DEF-123')).toBe('abc_DEF-123')
    expect(readTokenFromSearch('token=abc')).toBe('abc')
  })

  it('returns an empty string when there is no token', () => {
    expect(readTokenFromSearch('')).toBe('')
    expect(readTokenFromSearch('?other=1')).toBe('')
  })

  it('decodes an encoded token', () => {
    expect(readTokenFromSearch('?token=a%2Bb')).toBe('a+b')
  })
})

describe('describePasswordLink', () => {
  it('words an invitation as account activation', () => {
    const d = describePasswordLink('INVITE')
    expect(d.title).toBe('Set your password')
    expect(d.submitLabel).toBe('Activate account')
  })

  it('words everything else as a reset', () => {
    expect(describePasswordLink('RESET').title).toBe('Reset your password')
    expect(describePasswordLink(null).submitLabel).toBe('Save new password')
  })
})

describe('validateNewPassword', () => {
  it('rejects a password shorter than the minimum', () => {
    expect(validateNewPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1), 'a'.repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/at least/)
  })

  it('rejects a confirmation that differs', () => {
    expect(validateNewPassword('secret1', 'secret2')).toBe('Passwords do not match')
  })

  it('accepts a long enough matching password', () => {
    expect(validateNewPassword('secret1', 'secret1')).toBeNull()
  })
})
