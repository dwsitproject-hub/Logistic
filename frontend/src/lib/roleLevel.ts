/**
 * Roles whose users carry NO level: the Administrator and Management are not ranked, so their permissions are one set and the Users form does not ask for a level.
 * Mirrors ROLES_WITHOUT_LEVEL in backend/src/utils/rolePermissionScope.ts. Every other role is scoped per level (Dept Head / Section Head / Staff / Admin).
 */
export const ROLES_WITHOUT_LEVEL: readonly string[] = ['ADMIN', 'MANAGEMENT']

/** False for the roles in ROLES_WITHOUT_LEVEL; true for every other role and for an unknown one. */
export function roleUsesLevel(roleName: string | null | undefined): boolean {
  return !ROLES_WITHOUT_LEVEL.includes(String(roleName ?? '').trim().toUpperCase())
}
