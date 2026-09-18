export const USER_ROLES = [
  'ADMIN',
  'TRADING',
  'LOGISTICS',
  'FINANCE',
  'MANAGEMENT',
  'SUPPORT',
  'ADMIN_SUPPORT',
] as const

export type UserRole = (typeof USER_ROLES)[number]

export function formatRoleLabel(role: string): string {
  return role.replace(/_/g, ' ')
}

/** ADMIN_SUPPORT follows SUPPORT on hardcoded nav role lists (not ADMIN-only pages). */
export function navRoleAllowed(itemRoles: readonly string[], userRole?: string): boolean {
  if (itemRoles.includes('ALL')) return true
  if (!userRole) return false
  if (itemRoles.includes(userRole)) return true
  return userRole === 'ADMIN_SUPPORT' && itemRoles.includes('SUPPORT')
}
