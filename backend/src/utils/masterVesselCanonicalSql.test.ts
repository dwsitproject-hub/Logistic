import { describe, expect, it } from 'vitest';
import { sqlMasterVesselCanonicalLateralJoin } from './masterVesselCanonicalSql';

describe('sqlMasterVesselCanonicalLateralJoin', () => {
  it('prefers shipments.master_vessel_id when provided', () => {
    const sql = sqlMasterVesselCanonicalLateralJoin(
      'COALESCE(sp.vessel_code, sl.vessel_code_sap)',
      'COALESCE(sp.vessel_name, sl.vessel_name_sap)',
      'mv',
      'sp.master_vessel_id',
    );
    expect(sql).toContain('sp.master_vessel_id');
    expect(sql).toContain('mv.id = sp.master_vessel_id');
    expect(sql).toContain('vessel_name_master');
    expect(sql).toContain('vessel_owner_master');
    expect(sql).toContain('vessel_capacity_mt_master');
    expect(sql).toContain('vessel_type_master');
    expect(sql).toContain('vessel_terms_master');
  });

  describe('which master wins when several qualify', () => {
    const sql = sqlMasterVesselCanonicalLateralJoin(
      's.vessel_code',
      's.vessel_name',
      'mv',
      's.master_vessel_id',
    );
    const order = sql.slice(sql.indexOf('ORDER BY'));

    it('ranks the normalised name, then the code, then the id', () => {
      const nameAt = order.indexOf('mv.normalized_vessel_name = normalize_vessel_name(s.vessel_name)');
      const codeAt = order.indexOf('upper(trim(mv.vessel_code))');
      const idAt = order.indexOf('mv.id = s.master_vessel_id');
      expect(nameAt).toBeGreaterThan(-1);
      expect(codeAt).toBeGreaterThan(nameAt);
      expect(idAt).toBeGreaterThan(codeAt);
    });

    it('counts an alias match as a code match', () => {
      expect(order).toMatch(/WHEN a\.id IS NOT NULL THEN 0/);
    });

    it('keeps the id as a candidate, so it still resolves a shipment whose name and code match nothing', () => {
      expect(sql.slice(0, sql.indexOf('ORDER BY'))).toContain('mv.id = s.master_vessel_id');
    });

    it('does not rank by a name that is blank', () => {
      expect(order).toContain("NULLIF(trim(s.vessel_name), '') IS NOT NULL");
    });
  });

  it('omits id match when masterVesselIdExpr is not passed', () => {
    const sql = sqlMasterVesselCanonicalLateralJoin('s.vessel_code', 's.vessel_name');
    expect(sql).not.toMatch(/mv\.id = /);
  });
});
