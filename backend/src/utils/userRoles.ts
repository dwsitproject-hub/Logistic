export const USER_ROLES = [
  'ADMIN',
  'TRADING',
  'LOGISTICS',
  'FINANCE',
  'MANAGEMENT',
  'SUPPORT',
  'ADMIN_SUPPORT',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isValidUserRole(role: unknown): role is UserRole {
  return typeof role === 'string' && (USER_ROLES as readonly string[]).includes(role);
}

/**
 * ADMIN_SUPPORT follows SUPPORT for hardcoded route allowlists.
 * User-management routes stay ADMIN-only because they never list SUPPORT.
 */
export function isRoleAllowed(userRole: string, allowed: readonly string[]): boolean {
  if (allowed.includes(userRole)) return true;
  return userRole === 'ADMIN_SUPPORT' && allowed.includes('SUPPORT');
}
