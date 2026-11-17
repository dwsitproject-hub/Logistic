import { describe, expect, it } from 'vitest'
import { formatRoleDisplayName, formatRoleLabel, navRoleAllowed, USER_ROLES } from './userRoles'

describe('userRoles', () => {
  it('includes ADMIN_SUPPORT', () => {
    expect(USER_ROLES).toContain('ADMIN_SUPPORT')
  })

  it('formats ADMIN_SUPPORT as ADMIN SUPPORT', () => {
    expect(formatRoleLabel('ADMIN_SUPPORT')).toBe('ADMIN SUPPORT')
    expect(formatRoleLabel('ADMIN')).toBe('ADMIN')
  })

  it('writes a role name typed in capitals as words, keeping one- and two-letter initials', () => {
    expect(formatRoleDisplayName('AR UPSTREAM')).toBe('AR Upstream')
    expect(formatRoleDisplayName('AR DOWNSTREAM')).toBe('AR Downstream')
    expect(formatRoleDisplayName('CLAIM')).toBe('Claim')
    expect(formatRoleDisplayName('TAX UPSTREAM')).toBe('Tax Upstream')
    expect(formatRoleDisplayName('TAX  DOWNSTREAM')).toBe('Tax Downstream')
    expect(formatRoleDisplayName('BC')).toBe('BC')
  })

  it('leaves a name that already has lower-case letters, and an empty one, alone', () => {
    expect(formatRoleDisplayName('Finance')).toBe('Finance')
    expect(formatRoleDisplayName('Logistics Staff')).toBe('Logistics Staff')
    expect(formatRoleDisplayName('SOLO sales')).toBe('SOLO sales')
    expect(formatRoleDisplayName('')).toBe('')
    expect(formatRoleDisplayName(null)).toBe('')
  })

  it('treats ADMIN_SUPPORT like SUPPORT for nav allowlists', () => {
    expect(navRoleAllowed(['ADMIN', 'SUPPORT'], 'ADMIN_SUPPORT')).toBe(true)
    expect(navRoleAllowed(['ADMIN'], 'ADMIN_SUPPORT')).toBe(false)
    expect(navRoleAllowed(['ALL'], 'ADMIN_SUPPORT')).toBe(true)
  })
})
