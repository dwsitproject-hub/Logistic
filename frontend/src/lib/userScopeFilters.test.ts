import { afterEach, describe, expect, it, vi } from 'vitest'
import { getInitialUserScopeFilters } from './userScopeFilters'

function signedInAs(user: unknown) {
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', { getItem: () => (user === null ? null : JSON.stringify(user)) })
}

afterEach(() => vi.unstubAllGlobals())

describe('getInitialUserScopeFilters', () => {
  it('opens pages on the Region/Plant but never on a product, even for an account that still has products stored', () => {
    signedInAs({ products: ['CPO', 'PK'], group_plants: ['BONTANG ', ''] })
    expect(getInitialUserScopeFilters()).toEqual({ products: [], groupPlants: ['BONTANG'] })
  })

  it('gives no defaults when nobody is signed in or the stored user is unreadable', () => {
    signedInAs(null)
    expect(getInitialUserScopeFilters()).toEqual({ products: [], groupPlants: [] })
    vi.stubGlobal('localStorage', { getItem: () => '{not json' })
    expect(getInitialUserScopeFilters()).toEqual({ products: [], groupPlants: [] })
  })
})
