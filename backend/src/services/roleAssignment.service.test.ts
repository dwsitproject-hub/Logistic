import { describe, expect, it, vi } from 'vitest';
import { findAssignableRole } from './roleAssignment.service';

const clientReturning = (rows: Array<{ role_name: string; uses_region_scope: boolean }>) => ({
  query: vi.fn().mockResolvedValue({ rows }),
});

/**
 * A role created on the Roles page used to be unassignable: users.role had a hard-coded CHECK and the controller a hard-coded list.
 * The roles table is the list now - an active row means the role can be given, and its own flag says whether Region/Plant applies.
 */
describe('findAssignableRole', () => {
  it('accepts a role that exists and reports its Region/Plant flag', async () => {
    const client = clientReturning([{ role_name: 'BC', uses_region_scope: true }]);
    await expect(findAssignableRole(client as never, 'BC')).resolves.toEqual({ roleName: 'BC', usesRegionScope: true });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('is_active = true'), ['BC']);
  });

  it('refuses a role that is missing or inactive (the query returns no row)', async () => {
    await expect(findAssignableRole(clientReturning([]) as never, 'NOPE')).resolves.toBeNull();
  });

  it('refuses an empty or non-string role without touching the database', async () => {
    const client = clientReturning([]);
    await expect(findAssignableRole(client as never, '')).resolves.toBeNull();
    await expect(findAssignableRole(client as never, undefined)).resolves.toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('trims the role before looking it up', async () => {
    const client = clientReturning([{ role_name: 'AR_UPSTREAM', uses_region_scope: false }]);
    await findAssignableRole(client as never, '  AR_UPSTREAM ');
    expect(client.query).toHaveBeenCalledWith(expect.any(String), ['AR_UPSTREAM']);
  });
});
