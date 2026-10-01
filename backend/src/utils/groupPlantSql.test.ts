import { describe, expect, it } from 'vitest';
import { GROUP_PLANT_CONTRACT_C, groupPlantExpr, sqlIsTradingPlantExpr } from './groupPlantSql';

describe('groupPlantExpr', () => {
  const sql = groupPlantExpr('c.plant_code', GROUP_PLANT_CONTRACT_C);

  // Migrations 195 and 208 reloaded Master Plant without group_plant, every contract became
  // 'Blank', and Pre-Planned lost its pool. Group Plant must never depend on that column again.
  it('does not read master_plants.group_plant', () => {
    expect(sql).not.toMatch(/mp\.group_plant|\.group_plant/);
    expect(sql).not.toContain('pnc');
    expect(sql).not.toContain('pna');
  });

  it('takes the destination the Region/Site filters use: B2B child overlay, then the latest SAP row', () => {
    expect(sql).toContain('b2b_ending_child_snapshot');
    expect(sql).toContain('sap_processed_data');
    expect(sql).toContain('c.contract_id');
    expect(sql).toContain('c.po_number');
    expect(sql).toContain('UPPER(TRIM(');
  });

  it('keeps trading plants Trading, from trading_plant_codes or a HO TRADING plant type', () => {
    expect(sql).toContain('trading_plant_codes');
    expect(sql).toContain("LIKE 'HO TRADING%'");
    expect(sql).toContain("THEN 'Trading'");
  });

  it('treats the TRADING TRANSIT HO destination as Trading and a missing destination as Blank', () => {
    expect(sql).toContain("x.dest = 'TRADING TRANSIT HO'");
    expect(sql).toContain("WHEN x.dest IS NULL THEN 'Blank'");
  });

  it('checks the plant first, so a trading plant is Trading whatever its destination', () => {
    expect(sql.indexOf("THEN 'Trading'")).toBeLessThan(sql.indexOf("WHEN x.dest IS NULL THEN 'Blank'"));
  });

  it('is one scalar subquery, so the destination is evaluated once per row', () => {
    expect(sql.startsWith('(SELECT CASE')).toBe(true);
    expect(sql.match(/\) x\)$/)).not.toBeNull();
  });

  it('uses the plant reference it is given, which may itself be a SQL expression', () => {
    const resolved = groupPlantExpr("COALESCE(c.plant_code, 'X')", GROUP_PLANT_CONTRACT_C);
    expect(resolved).toContain("UPPER(TRIM(COALESCE(COALESCE(c.plant_code, 'X'), '')))");
  });

  it('takes the contract columns from the caller', () => {
    const other = groupPlantExpr('s.plant', { contractNumber: 'k.contract_no', originPo: 'k.po' });
    expect(other).toContain('k.contract_no');
    expect(other).toContain('k.po');
    expect(other).not.toContain('c.contract_id');
  });
});

describe('sqlIsTradingPlantExpr', () => {
  it('matches on the upper-cased plant code in both sources', () => {
    const sql = sqlIsTradingPlantExpr('p');
    expect(sql).toContain('tp.plant_code = p');
    expect(sql).toContain('UPPER(TRIM(mp.plant_code)) = p');
  });
});
