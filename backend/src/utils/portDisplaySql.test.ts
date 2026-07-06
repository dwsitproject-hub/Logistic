import { describe, expect, it } from 'vitest';
import {
  sapSpdDischargePortTextExpr,
  sapSpdLoadingPortTextExpr,
} from './portDisplaySql';

describe('portDisplaySql', () => {
  it('prefers Vessel Loading Port over Vessel Loading Port 1 in SAP JSON', () => {
    const sql = sapSpdLoadingPortTextExpr('spd');
    expect(sql.indexOf("Vessel Loading Port'")).toBeLessThan(
      sql.indexOf("Vessel Loading Port 1'"),
    );
    expect(sql).toContain("Vessel Loading Port'");
  });

  it('uses Vessel Discharge Port for SAP discharge text', () => {
    const sql = sapSpdDischargePortTextExpr('spd');
    expect(sql).toContain("Vessel Discharge Port'");
  });
});
