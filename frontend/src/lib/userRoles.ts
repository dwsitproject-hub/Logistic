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

/**
 * A role's display name as it reads in the UI. A name typed in capitals ("AR UPSTREAM", "CLAIM", "TAX UPSTREAM") is written as words: "AR Upstream", "Claim", "Tax Upstream".
 * Words of one or two letters stay as they are ("AR", "BC": they are initials); a name that already has any lower-case letter is the author's own wording and is left alone.
 */
export function formatRoleDisplayName(name: string | null | undefined): string {
  const text = String(name ?? '').trim()
  if (!text || /[a-z]/.test(text)) return text
  return text
    .split(/\s+/)
    .map((word) => (word.length <= 2 ? word : word.charAt(0) + word.slice(1).toLowerCase()))
    .join(' ')
}

/** ADMIN_SUPPORT follows SUPPORT on hardcoded nav role lists (not ADMIN-only pages). */
export function navRoleAllowed(itemRoles: readonly string[], userRole?: string): boolean {
  if (itemRoles.includes('ALL')) return true
  if (!userRole) return false
  if (itemRoles.includes(userRole)) return true
  return userRole === 'ADMIN_SUPPORT' && itemRoles.includes('SUPPORT')
}
