import { describe, expect, it } from 'vitest';
import {
  buildMissingEtaAlertScopeClause,
  roleMaySeeMissingEtaBell,
} from './missingEtaAlertScopeSql';
import type { SessionUserPayload } from '../services/sessionAuth.service';

function baseUser(overrides: Partial<SessionUserPayload> = {}): SessionUserPayload {
  return {
    id: 'user-1',
    username: 'staff1',
    email: 'staff1@example.com',
    full_name: 'Staff User',
    role: 'LOGISTICS',
    level: 'Staff',
    transport_type: null,
    plant: null,
    plants: [],
    group_plants: [],
    products: [],
    is_active: true,
    is_first_login: false,
    ...overrides,
  };
}

describe('missingEtaAlertScopeSql', () => {
  it('returns empty scope for non-Staff levels', () => {
    expect(buildMissingEtaAlertScopeClause(baseUser({ level: 'Dept Head' }))).toEqual({
      sql: '',
      params: [],
    });
    expect(buildMissingEtaAlertScopeClause(baseUser({ level: 'Admin' }))).toEqual({
      sql: '',
      params: [],
    });
    expect(buildMissingEtaAlertScopeClause(baseUser({ level: null }))).toEqual({
      sql: '',
      params: [],
    });
  });

  it('Staff with transport_type SEA filters transport_mode prefix', () => {
    const scope = buildMissingEtaAlertScopeClause(
      baseUser({ transport_type: 'SEA' }),
    );
    expect(scope.sql).toContain('transport_mode');
    expect(scope.sql).toContain('LIKE');
    expect(scope.params).toEqual(['SEA%']);
  });

  it('Staff with transport_type ALL adds no transport filter', () => {
    const scope = buildMissingEtaAlertScopeClause(
      baseUser({ transport_type: 'ALL' }),
    );
    expect(scope.sql).not.toContain('transport_mode');
  });

  it('Staff with group_plants adds group plant filter', () => {
    const scope = buildMissingEtaAlertScopeClause(
      baseUser({ group_plants: ['PLANT-A', 'Blank'] }),
    );
    expect(scope.sql).toContain('group_plant');
    expect(scope.params).toEqual(['PLANT-A']);
  });

  it('Staff with products adds product filter', () => {
    const scope = buildMissingEtaAlertScopeClause(
      baseUser({ products: ['CPO', 'PK'] }),
    );
    expect(scope.sql).toContain('c.product');
    expect(scope.params).toEqual([['CPO', 'PK']]);
  });

  it('Staff combines transport, plant, and product when all set', () => {
    const scope = buildMissingEtaAlertScopeClause(
      baseUser({
        transport_type: 'LAND',
        group_plants: ['PLANT-B'],
        products: ['CPO'],
      }),
    );
    expect(scope.params).toEqual(['LAND%', 'PLANT-B', ['CPO']]);
  });

  it('roleMaySeeMissingEtaBell allows logistics/trading/admin/management', () => {
    expect(roleMaySeeMissingEtaBell('LOGISTICS')).toBe(true);
    expect(roleMaySeeMissingEtaBell('TRADING')).toBe(true);
    expect(roleMaySeeMissingEtaBell('ADMIN')).toBe(true);
    expect(roleMaySeeMissingEtaBell('MANAGEMENT')).toBe(true);
    expect(roleMaySeeMissingEtaBell('FINANCE')).toBe(false);
  });
});
