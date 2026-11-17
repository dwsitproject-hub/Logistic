import { describe, expect, it } from 'vitest'
import { roleUsesLevel } from './roleLevel'

describe('roleUsesLevel', () => {
  it('is false for Administrator and Management, in any case', () => {
    expect(roleUsesLevel('ADMIN')).toBe(false)
    expect(roleUsesLevel('management')).toBe(false)
    expect(roleUsesLevel(' MANAGEMENT ')).toBe(false)
  })

  it('is true for every other role, a new one, and an empty value', () => {
    for (const role of ['LOGISTICS', 'TRADING', 'FINANCE', 'SUPPORT', 'ADMIN_SUPPORT', 'NEW_ROLE']) {
      expect(roleUsesLevel(role)).toBe(true)
    }
    expect(roleUsesLevel(undefined)).toBe(true)
    expect(roleUsesLevel('')).toBe(true)
  })
})
