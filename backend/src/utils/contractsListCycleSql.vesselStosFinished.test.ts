import { describe, expect, it } from 'vitest';
import { query } from '../database/connection';
import { buildVesselStosFinishedCte, sqlContractVesselStosFinishedExpr } from './contractsListCycleSql';

const flat = (s: string) => s.replace(/\s+/g, ' ');

/**
 * A stored shipment status COMPLETED is not evidence that a vessel STO is finished: SAP stamps it while the contract reads Close and nothing moves it
 * back when GR reopens. Production 2026-10-20: five contracts (4,112 MT) were closed on Contract Performance and Open on Shipping Performance and
 * Shipments, which derive the stage from the ATAs and the STO's GR.
 */
describe('a vessel STO is finished by an ATC, or by status COMPLETED only while the GR of that STO is Close', () => {
  it('the per-contract form gates the COMPLETED arm on the STO GR', () => {
    const sql = flat(sqlContractVesselStosFinishedExpr('c.contract_id'));
    expect(sql).toContain("(UPPER(TRIM(COALESCE(s_vf.status, ''))) = 'COMPLETED' AND ");
    // the GR of the STO being tested (vs.sto), read on the shipment's own contract
    expect(sql).toMatch(/AND \(?[^)]*vs\.sto/);
    // the ATC arms stay ungated
    expect(sql).toContain('s_vf.ata_discharge_complete IS NOT NULL');
    expect(sql).toContain('o_vf.ata_discharge_complete IS NOT NULL');
    expect(sql).toContain('v_vf.ata_loading_completed IS NOT NULL');
  });

  it('the set-based form applies the same gate', () => {
    const sql = flat(buildVesselStosFinishedCte('vsf', 'SELECT contract_id FROM contracts'));
    expect(sql).toContain("(UPPER(TRIM(COALESCE(s_vf.status, ''))) = 'COMPLETED' AND ");
    expect(sql).toMatch(/AND \(?[^)]*l0\.sto/);
    expect(sql).toContain('s_vf.ata_discharge_complete IS NOT NULL');
  });

  it('both forms RUN against the database (a correct string proves nothing about the query)', async () => {
    const perContract = await query(
      `SELECT c.contract_id, ${sqlContractVesselStosFinishedExpr('c.contract_id')} AS finished FROM contracts c LIMIT 5`,
    );
    expect(perContract.rows.length).toBeGreaterThan(0);
    const set = await query(
      `WITH ${buildVesselStosFinishedCte('vsf', 'SELECT contract_id FROM contracts LIMIT 50')} SELECT contract_id, vessel_stos_finished FROM vsf`,
    );
    expect(Array.isArray(set.rows)).toBe(true);
  }, 120_000);
});
