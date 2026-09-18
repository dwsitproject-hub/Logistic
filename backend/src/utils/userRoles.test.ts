import { describe, expect, it } from 'vitest';
import { isRoleAllowed, isValidUserRole, USER_ROLES } from './userRoles';

describe('userRoles', () => {
  it('includes ADMIN_SUPPORT with the existing roles', () => {
    expect(USER_ROLES).toContain('ADMIN_SUPPORT');
    expect(USER_ROLES).toContain('SUPPORT');
    expect(USER_ROLES).toContain('ADMIN');
  });

  it('accepts ADMIN_SUPPORT as a valid user role', () => {
    expect(isValidUserRole('ADMIN_SUPPORT')).toBe(true);
    expect(isValidUserRole('SUPPORT')).toBe(true);
    expect(isValidUserRole('GUEST')).toBe(false);
  });

  it('treats ADMIN_SUPPORT like SUPPORT for route allowlists, not like ADMIN', () => {
    expect(isRoleAllowed('ADMIN_SUPPORT', ['ADMIN', 'SUPPORT'])).toBe(true);
    expect(isRoleAllowed('ADMIN_SUPPORT', ['ADMIN'])).toBe(false);
    expect(isRoleAllowed('ADMIN_SUPPORT', ['ADMIN_SUPPORT'])).toBe(true);
    expect(isRoleAllowed('SUPPORT', ['ADMIN', 'SUPPORT'])).toBe(true);
  });
});
