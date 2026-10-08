import type { PoolClient } from 'pg';

/**
 * A role a user can be given: it exists in the roles table and is active.
 *
 * The list used to be hard-coded in three places (a CHECK on users.role, USER_ROLES in the routes, and isValidUserRole in the
 * controller), so a role created on the Roles page could never be assigned. The roles table is the single list now.
 *
 * `usesRegionScope` is the role's own flag: whether the user's Region/Plant default filter is kept for it.
 */
export async function findAssignableRole(
  client: Pick<PoolClient, 'query'>,
  roleName: unknown,
): Promise<{ roleName: string; usesRegionScope: boolean } | null> {
  const name = String(roleName ?? '').trim();
  if (!name) return null;
  const res = await client.query(
    'SELECT role_name, uses_region_scope FROM roles WHERE role_name = $1 AND is_active = true',
    [name],
  );
  const row = res.rows[0] as { role_name: string; uses_region_scope: boolean } | undefined;
  return row ? { roleName: row.role_name, usesRegionScope: Boolean(row.uses_region_scope) } : null;
}
