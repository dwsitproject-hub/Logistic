import api from '@/lib/api'

export type UserScopePage =
  | 'contracts'
  | 'shipments'
  | 'trucking'
  | 'oil-loss'
  | 'contract-performance'
  | 'shipping-performance'


export type StoredAuthUser = {
  plants?: string[]
  group_plants?: string[]
  products?: string[]
  plant?: string | null
}

const CLEARED_KEY_PREFIX = 'klip.userScopeFilters.cleared.'

/**
 * The filters a page opens with for the signed-in user. Only the Region/Plant is a default now: the product default is retired (the Users page no longer assigns products),
 * so `products` is always empty even for an account that still has a product list stored. The shape stays so the six pages that read it need no change.
 */
export function getInitialUserScopeFilters(): { products: string[]; groupPlants: string[] } {
  if (typeof window === 'undefined') return { products: [], groupPlants: [] }
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return { products: [], groupPlants: [] }
    const user = JSON.parse(raw) as StoredAuthUser
    const products: string[] = []
    const groupPlants = Array.isArray(user.group_plants)
      ? user.group_plants.map((value) => String(value).trim()).filter(Boolean)
      : []
    return { products, groupPlants }
  } catch {
    return { products: [], groupPlants: [] }
  }
}

export function markUserScopeFiltersCleared(page: UserScopePage): void {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(`${CLEARED_KEY_PREFIX}${page}`, '1')
}

export function wereUserScopeFiltersCleared(page: UserScopePage): boolean {
  if (typeof window === 'undefined') return false
  return sessionStorage.getItem(`${CLEARED_KEY_PREFIX}${page}`) === '1'
}

export async function syncAuthUserScopeFromProfile(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const stored = JSON.parse(localStorage.getItem('user') || '{}') as StoredAuthUser
    if (Array.isArray(stored.group_plants) && Array.isArray(stored.products)) return
    const res = await api.get('/auth/profile')
    const profile = res.data?.data as StoredAuthUser | undefined
    if (!profile) return
    localStorage.setItem('user', JSON.stringify({ ...stored, ...profile }))
  } catch {
    // Best effort — keep existing localStorage user payload.
  }
}
