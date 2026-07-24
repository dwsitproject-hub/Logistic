import api from '@/lib/api'
import {
  canViewContractPerformancePage,
  canViewPermission,
  canViewShippingPerformancePage,
  seedPermissionsCache,
  type PermFlags,
} from '@/components/PermissionsContext'
import { NAV_ITEMS, type NavItem } from '@/lib/navigationConfig'

export type NavAccessContext = {
  byKey: Record<string, PermFlags>
  loaded: boolean
  userRole?: string
}

export function parsePermissionsResponse(
  raw: Record<string, Record<string, boolean | undefined>>,
): Record<string, PermFlags> {
  const next: Record<string, PermFlags> = {}
  for (const [k, v] of Object.entries(raw)) {
    next[k] = {
      canView: !!v?.canView,
      canCreate: !!v?.canCreate,
      canEdit: !!v?.canEdit,
      canDelete: !!v?.canDelete,
    }
  }
  return next
}

export async function loadUserPermissionsByKey(): Promise<Record<string, PermFlags>> {
  const res = await api.get('/roles/my-permissions')
  const raw = (res.data?.data?.permissions ?? {}) as Record<string, Record<string, boolean | undefined>>
  return parsePermissionsResponse(raw)
}

export function canViewNavItem(item: NavItem, userRole: string | undefined, perms: NavAccessContext): boolean {
  const roleOk = item.roles.includes('ALL') || (userRole != null && item.roles.includes(userRole))
  if (!roleOk) return false
  if (!perms.loaded) return false
  if (item.href === '/contract-performance') {
    return canViewContractPerformancePage(perms) === true
  }
  if (item.href === '/shipping-performance') {
    return canViewShippingPerformancePage(perms) === true
  }
  return canViewPermission(perms, item.permissionKey)
}

export function filterNavigationItems(
  items: NavItem[],
  userRole: string | undefined,
  perms: NavAccessContext,
): NavItem[] {
  return items.filter((item) => canViewNavItem(item, userRole, perms))
}

export function getFirstAccessibleRoute(
  userRole: string | undefined,
  perms: NavAccessContext,
  items: NavItem[] = NAV_ITEMS,
): string | null {
  const allowed = filterNavigationItems(items, userRole, perms)
  return allowed[0]?.href ?? null
}

/** True when pathname is a registered nav route the user may open (includes sub-paths). */
export function isPathAccessible(pathname: string, allowed: NavItem[]): boolean {
  if (pathname === '/unauthorized') return true
  return allowed.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
}

export async function resolvePostAuthRedirect(userRole?: string, userId?: string): Promise<string | null> {
  const byKey = await loadUserPermissionsByKey()
  if (userId) {
    seedPermissionsCache(userId, byKey)
  }
  const perms: NavAccessContext = { byKey, loaded: true, userRole }
  return getFirstAccessibleRoute(userRole, perms)
}

export type StoredAuthUser = {
  id?: string
  role?: string
  is_first_login?: boolean
}

/**
 * Shared post-login/post-SSO redirect: resolves the user's first accessible page
 * and navigates there, clearing the stored session on failure. Used by both the
 * username/password login page and the Downstream Hub SSO callback page.
 */
export async function redirectAfterAuth(
  user: StoredAuthUser,
  router: { push: (route: string) => void },
  setError: (msg: string) => void,
): Promise<void> {
  try {
    const route = await resolvePostAuthRedirect(user.role, user.id)
    if (!route) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      setError('Your account has no accessible pages. Contact your administrator.')
      return
    }
    router.push(route)
  } catch {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setError('Failed to load your permissions. Please try again.')
  }
}
