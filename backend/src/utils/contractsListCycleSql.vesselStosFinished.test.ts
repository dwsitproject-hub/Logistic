import { describe, expect, it } from 'vitest';
import { query } from '../database/connection';
import { buildVesselStosFinishedCte, sqlContractVesselStosFinishedExpr } from './contractsListCycleSql';

const flat = (s: string) => s.replace(/\s+/g, ' ');

/**
 * A vessel STO of a PO is finished when a shipment on it has an ATC, or the GR of THAT STO is Close.
 *
 * The GR arm used to read "stored status COMPLETED AND GR Close" (9655b952): a stored COMPLETED alone is not evidence, SAP stamps it while the contract reads Close and nothing moves it
 * back when GR reopens (production 2026-10-20, five contracts, 4,112 MT). But a Close GR needs no help from the stored status: Shipping Performance and Shipments derive the stage from
 * the ATAs and the GR and make a Close GR COMPLETED on its own, while the stored status moves only when SAP re-imports the row. BATAM 2026-10-21, 1004032751: STO 1006020594
 * (500 MT, GR Close, stored SAILED, no ATC) kept the contract Open on Contract Performance, 497.9 MT, with SP and Shipments at 19,400 MT against CP 19,897.9 MT.
 */
describe('a vessel STO is finished by an ATC, or when the GR of that STO is Close', () => {
  it('by default the GR arm needs no stored COMPLETED, in both forms', () => {
    const per = flat(sqlContractVesselStosFinishedExpr('c.contract_id'));
    const set = flat(buildVesselStosFinishedCte('vsf', 'SELECT contract_id FROM contracts'));
    expect(per).not.toContain("= 'COMPLETED' AND ");
    expect(set).not.toContain("= 'COMPLETED' AND ");
    // the GR of the STO being tested (vs.sto / l0.sto), read on the shipment's own contract
    expect(per).toMatch(/vs\.sto/);
    expect(set).toMatch(/l0\.sto/);
    // the ATC arms stay
    for (const sql of [per, set]) {
      expect(sql).toContain('s_vf.ata_discharge_complete IS NOT NULL');
      expect(sql).toContain('o_vf.ata_discharge_complete IS NOT NULL');
      expect(sql).toContain('v_vf.ata_loading_completed IS NOT NULL');
    }
  });

  it('grCloseFinishes: false is the earlier reading, stored COMPLETED AND GR Close, in both forms', () => {
    const per = flat(sqlContractVesselStosFinishedExpr('c.contract_id', { grCloseFinishes: false }));
    const set = flat(buildVesselStosFinishedCte('vsf', 'SELECT contract_id FROM contracts', { grCloseFinishes: false }));
    expect(per).toContain("(UPPER(TRIM(COALESCE(s_vf.status, ''))) = 'COMPLETED' AND ");
    expect(set).toContain("(UPPER(TRIM(COALESCE(s_vf.status, ''))) = 'COMPLETED' AND ");
  });

  it('both forms, and both readings, RUN against the database (a correct string proves nothing about the query)', async () => {
    for (const opts of [{}, { grCloseFinishes: false }]) {
      const perContract = await query(
        `SELECT c.contract_id, ${sqlContractVesselStosFinishedExpr('c.contract_id', opts)} AS finished FROM contracts c LIMIT 5`,
      );
      expect(perContract.rows.length).toBeGreaterThan(0);
      const set = await query(
        `WITH ${buildVesselStosFinishedCte('vsf', 'SELECT contract_id FROM contracts LIMIT 50', opts)} SELECT contract_id, vessel_stos_finished FROM vsf`,
      );
      expect(Array.isArray(set.rows)).toBe(true);
    }
  }, 180_000);

  it('the new reading only ADDS finished contracts: whatever the earlier reading finished is still finished', async () => {
    const r = await query(
      `WITH scope AS (SELECT contract_id FROM contracts WHERE contract_id IS NOT NULL ORDER BY contract_id LIMIT 400),
            ${buildVesselStosFinishedCte('now_rule', 'SELECT contract_id FROM scope')},
            ${buildVesselStosFinishedCte('old_rule', 'SELECT contract_id FROM scope', { grCloseFinishes: false })}
       SELECT COUNT(*) FILTER (WHERE o.vessel_stos_finished AND NOT n.vessel_stos_finished)::int AS lost,
              COUNT(*) FILTER (WHERE n.vessel_stos_finished AND NOT o.vessel_stos_finished)::int AS gained,
              COUNT(*)::int AS compared
         FROM old_rule o JOIN now_rule n ON n.contract_id = o.contract_id`,
    );
    expect(r.rows[0].lost).toBe(0);
    expect(r.rows[0].compared).toBeGreaterThan(0);
  }, 180_000);
});
