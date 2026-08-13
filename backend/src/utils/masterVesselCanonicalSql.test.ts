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
  });

  it('omits id match when masterVesselIdExpr is not passed', () => {
    const sql = sqlMasterVesselCanonicalLateralJoin('s.vessel_code', 's.vessel_name');
    expect(sql).not.toMatch(/mv\.id = /);
  });
});
