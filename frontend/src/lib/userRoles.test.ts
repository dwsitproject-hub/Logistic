import { describe, expect, it } from 'vitest'
import { formatRoleLabel, navRoleAllowed, USER_ROLES } from './userRoles'

describe('userRoles', () => {
  it('includes ADMIN_SUPPORT', () => {
    expect(USER_ROLES).toContain('ADMIN_SUPPORT')
  })

  it('formats ADMIN_SUPPORT as ADMIN SUPPORT', () => {
    expect(formatRoleLabel('ADMIN_SUPPORT')).toBe('ADMIN SUPPORT')
    expect(formatRoleLabel('ADMIN')).toBe('ADMIN')
  })

  it('treats ADMIN_SUPPORT like SUPPORT for nav allowlists', () => {
    expect(navRoleAllowed(['ADMIN', 'SUPPORT'], 'ADMIN_SUPPORT')).toBe(true)
    expect(navRoleAllowed(['ADMIN'], 'ADMIN_SUPPORT')).toBe(false)
    expect(navRoleAllowed(['ALL'], 'ADMIN_SUPPORT')).toBe(true)
  })
})
