import { describe, expect, it } from 'vitest';
import {
  formatRoleScopeLabel,
  normalizeRoleLevel,
  normalizeRoleTransportType,
  parseAdminRoleScopeQuery,
  parseRoleScopeQuery,
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
