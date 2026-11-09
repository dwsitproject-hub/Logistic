import { describe, expect, it } from 'vitest'
import { roleLabel } from './roles'

describe('roleLabel', () => {
  it('shows the name in capitals', () => {
    expect(roleLabel({ role_name: 'AR_UPSTREAM', display_name: 'AR Upstream' })).toBe('AR UPSTREAM')
    expect(roleLabel({ role_name: 'BC', display_name: 'Bea Cukai' })).toBe('BEA CUKAI')
  })
  it('falls back to the code, also in capitals', () => {
    expect(roleLabel({ role_name: 'ADMIN', display_name: null })).toBe('ADMIN')
    expect(roleLabel({ role_name: 'logistics', display_name: '  ' })).toBe('LOGISTICS')
  })
})
