import { describe, expect, it } from 'vitest'
import { resolvePageTitle } from '@/lib/resolvePageTitle'

describe('resolvePageTitle', () => {
  it('uses exact nav names', () => {
    expect(resolvePageTitle('/contracts')).toBe('Contracts')
    expect(resolvePageTitle('/sap-imports')).toBe('SAP Data')
    expect(resolvePageTitle('/contract-performance')).toBe('Contract Performance')
  })

  it('uses child overrides', () => {
    expect(resolvePageTitle('/users/roles')).toBe('Roles')
    expect(resolvePageTitle('/users/activity-log')).toBe('User Activity Log')
  })

  it('falls back to longest nav prefix', () => {
    expect(resolvePageTitle('/sap-imports/abc')).toBe('SAP Data')
  })
})
