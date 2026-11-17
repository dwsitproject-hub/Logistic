import { describe, expect, it } from 'vitest';
import {
  formatRoleScopeLabel,
  normalizeRoleLevel,
  normalizeRoleTransportType,
  parseAdminRoleScopeQuery,
  parseRoleScopeQuery,
  roleUsesLevel,
  ROLES_WITHOUT_LEVEL,
  VALID_ROLE_LEVELS,
  VALID_ROLE_TRANSPORT_TYPES,
} from './rolePermissionScope';

describe('rolePermissionScope', () => {
  it('accepts all canonical levels', () => {
    for (const level of VALID_ROLE_LEVELS) {
      expect(normalizeRoleLevel(level)).toBe(level);
      expect(normalizeRoleLevel(level.toUpperCase())).toBe(level);
    }
  });

  it('accepts all transport types including ALL and MIX', () => {
    for (const transport of VALID_ROLE_TRANSPORT_TYPES) {
      expect(normalizeRoleTransportType(transport)).toBe(transport);
      expect(normalizeRoleTransportType(transport.toLowerCase())).toBe(transport);
    }
  });

  it('rejects invalid level and transport values', () => {
    expect(normalizeRoleLevel('Manager')).toBeNull();
    expect(normalizeRoleTransportType('AIR')).toBeNull();
  });

  it('parses empty query as unscoped transport when level omitted (legacy parse)', () => {
    const { scope, error } = parseRoleScopeQuery({});
    expect(error).toBeUndefined();
    expect(scope).toEqual({ level: null, transportType: null });
  });

  it('requires level for admin role editor scope', () => {
    expect(parseAdminRoleScopeQuery({}).error).toMatch(/Level is required/);
    expect(parseAdminRoleScopeQuery({ transportType: 'SEA' }).error).toMatch(/Level is required/);

    const financeStaff = parseAdminRoleScopeQuery({ level: 'Staff' });
    expect(financeStaff.error).toBeUndefined();
    expect(financeStaff.scope).toEqual({ level: 'Staff', transportType: null });
  });

  it('parses Finance/Management/Support style scoped queries', () => {
    const financeStaff = parseRoleScopeQuery({ level: 'Staff' });
    expect(financeStaff.error).toBeUndefined();
    expect(financeStaff.scope).toEqual({ level: 'Staff', transportType: null });

    const managementDeptHead = parseRoleScopeQuery({ level: 'Dept Head' });
    expect(managementDeptHead.scope.level).toBe('Dept Head');

    const supportAdmin = parseRoleScopeQuery({ level: 'Admin', transportType: 'ALL' });
    expect(supportAdmin.scope).toEqual({ level: 'Admin', transportType: 'ALL' });
  });

  it('returns validation errors for invalid query params', () => {
    expect(parseRoleScopeQuery({ level: 'Supervisor' }).error).toMatch(/Invalid level/);
    expect(parseRoleScopeQuery({ transportType: 'TRUCK' }).error).toMatch(/Invalid transport/);
  });

  it('formats scope labels for audit logs', () => {
    expect(formatRoleScopeLabel({ level: 'Admin', transportType: null })).toBe(
      'level=Admin, transport=all'
    );
    expect(formatRoleScopeLabel({ level: null, transportType: 'SEA' })).toBe(
      'level=all, transport=SEA'
    );
  });
});

describe('roles without a level (Administrator and Management)', () => {
  it('lists exactly ADMIN and MANAGEMENT', () => {
    expect([...ROLES_WITHOUT_LEVEL].sort()).toEqual(['ADMIN', 'MANAGEMENT']);
  });

  it('roleUsesLevel is false for them, in any case and with spaces, and true for the others', () => {
    expect(roleUsesLevel('ADMIN')).toBe(false);
    expect(roleUsesLevel(' management ')).toBe(false);
    for (const role of ['LOGISTICS', 'TRADING', 'FINANCE', 'SUPPORT', 'ADMIN_SUPPORT', 'SOME_NEW_ROLE']) {
      expect(roleUsesLevel(role)).toBe(true);
    }
    expect(roleUsesLevel(undefined)).toBe(true);
  });

  it('the role editor scope for them is level NULL without asking for a level, and ignores one that is sent', () => {
    expect(parseAdminRoleScopeQuery({}, 'MANAGEMENT')).toEqual({ scope: { level: null, transportType: null } });
    expect(parseAdminRoleScopeQuery({ level: 'Staff' }, 'ADMIN').scope.level).toBeNull();
    expect(parseAdminRoleScopeQuery({ level: 'Staff' }, 'ADMIN').error).toBeUndefined();
  });

  it('any other role still requires a level', () => {
    expect(parseAdminRoleScopeQuery({}, 'LOGISTICS').error).toMatch(/Level is required/);
    expect(parseAdminRoleScopeQuery({ level: 'Staff' }, 'LOGISTICS').scope.level).toBe('Staff');
    expect(parseAdminRoleScopeQuery({}).error).toMatch(/Level is required/);
  });
});
