import { describe, expect, it } from 'vitest';
import { query } from '../database/connection';
import { sqlContractLiveShipmentWithoutAtcExpr, sqlLiveShipmentWithoutAtcFlagColumn } from './contractsListCycleSql';
import { sqlContractAtcFinishesExpr, sqlContractEffectivelyDoneExpr } from './contractDeliveryStatus';
import { sqlJpsAtaWhileOpen } from './shipmentAtaOverrideSql';

/**
 * PO 1001032275 (production 2026-11-16): voyage one has its ATC and a second live shipment, planned for the rest, has none. One ATC used to finish the contract, so
 * Contract Performance filed it under Close while Contracts kept it Open with 622 MT outstanding. A contract delivered in two voyages is finished once BOTH have their ATC.
 */
describe('the string of the every-voyage condition', () => {
  it('looks for a LIVE shipment of the contract whose resolved ATC is empty', () => {
    const sql = sqlContractLiveShipmentWithoutAtcExpr({ contractIdExpr: 'base.id' });
    expect(sql).toContain('s_lw.contract_id = base.id');
    expect(sql).toContain("NOT IN ('CANCELLED', 'CANCELED')");
    expect(sql).toMatch(/\) IS NULL\s*\)$/);
    // the JPS lane first, then the KLIP override, the shipment's own column and the discharge leg - the order every other spelling of the ATC has
    expect(sql).toContain(sqlJpsAtaWhileOpen('jps_ata_discharge_complete', 'sao_lw', 's_lw'));
    expect(sql.indexOf('jps_ata_discharge_complete')).toBeLessThan(sql.indexOf('sao_lw.ata_discharge_complete'));
    expect(sql.indexOf('sao_lw.ata_discharge_complete')).toBeLessThan(sql.indexOf('s_lw.ata_discharge_complete'));
    expect(sql.indexOf('s_lw.ata_discharge_complete')).toBeLessThan(sql.indexOf('vlp_lw.ata_loading_completed'));
  });

  it('can be scoped by the contract number instead of the contracts row', () => {
    const sql = sqlContractLiveShipmentWithoutAtcExpr({ contractNumberExpr: 'r.contract_number' });
    expect(sql).toContain('c_lw.contract_id = r.contract_number');
    expect(sql).not.toContain('s_lw.contract_id = r.');
  });

  it('the ATC arm adds NOT COALESCE(flag, FALSE) and stays as it was without the flag', () => {
    const flag = 'base.live_shipment_without_atc';
    expect(sqlContractAtcFinishesExpr('a.atc', 'a.sto_count', undefined, flag)).toContain(`AND NOT COALESCE((${flag}), FALSE)`);
    expect(sqlContractAtcFinishesExpr('a.atc', undefined, undefined, flag)).toContain(`NOT COALESCE((${flag}), FALSE)`);
    expect(sqlContractAtcFinishesExpr('a.atc', 'a.sto_count')).not.toContain('NOT COALESCE');
    expect(sqlContractAtcFinishesExpr('a.atc')).not.toContain('NOT COALESCE');
  });

  it('only the ATC arm carries the condition: the zero band and vessel-finished arms stay on their own', () => {
    const sql = sqlContractEffectivelyDoneExpr({
      outstandingKgExpr: 'base.os',
      atcExpr: 'base.atc',
      stoCountExpr: 'base.sto_count',
      vesselStosFinishedExpr: 'base.vsf',
      liveShipmentWithoutAtcExpr: 'base.flag',
    });
    const [zeroBand, rest] = sql.split('OR ((base.atc)');
    expect(zeroBand).not.toContain('base.flag');
    const [atcArm, vesselArm] = rest.split('OR COALESCE((base.vsf)');
    expect(atcArm).toContain('base.flag');
    expect(vesselArm).not.toContain('base.flag');
  });

  it('the row-set column is gated on an ATC being there and SAP not having closed the contract', () => {
    const col = sqlLiveShipmentWithoutAtcFlagColumn('base');
    expect(col).toContain('base.last_ata_vessel_complete_discharge IS NOT NULL');
    expect(col).toContain("NOT IN ('CLOSE', 'CLOSED', 'COMPLETED')");
    expect(col).toContain('s_lw.contract_id = base.id');
  });
});

describe('the every-voyage condition RUNS against the database', () => {
  const ATC = `COALESCE(${sqlJpsAtaWhileOpen('jps_ata_discharge_complete', 'sao', 's')}::date, sao.ata_discharge_complete::date, s.ata_discharge_complete::date, vlp.ata_loading_completed::date)`;
  const LIVE = `UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED')`;

  it('equals an independently written grouping, per contracts row and per contract number', async () => {
    const expected = await query(
      `SELECT s.contract_id::text AS id,
              BOOL_OR(${LIVE} AND ${ATC} IS NULL) AS expected_flag
         FROM shipments s
         LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
         LEFT JOIN LATERAL (
           SELECT v.ata_loading_completed FROM vessel_loading_ports v
            WHERE v.shipment_id = s.id AND COALESCE(v.is_discharge_port, FALSE) = TRUE AND v.ata_loading_completed IS NOT NULL
            ORDER BY v.ata_loading_completed DESC LIMIT 1
         ) vlp ON TRUE
        GROUP BY s.contract_id
        ORDER BY BOOL_OR(${LIVE} AND ${ATC} IS NULL) DESC, s.contract_id
        LIMIT 300`,
    );
    if (expected.rows.length === 0) return; // nothing to test against on this database
    const ids = expected.rows.map((r: { id: string }) => r.id);
    const got = await query(
      `SELECT c.id::text AS id, (${sqlContractLiveShipmentWithoutAtcExpr({ contractIdExpr: 'c.id' })}) AS flag,
              (${sqlContractLiveShipmentWithoutAtcExpr({ contractNumberExpr: 'c.contract_id' })}) AS flag_by_number
         FROM contracts c WHERE c.id = ANY($1::uuid[])`,
      [ids],
    );
    const byId = new Map(got.rows.map((r: { id: string; flag: boolean; flag_by_number: boolean }) => [r.id, r]));
    for (const e of expected.rows as Array<{ id: string; expected_flag: boolean }>) {
      const g = byId.get(e.id) as { flag: boolean; flag_by_number: boolean } | undefined;
      expect(g).toBeDefined();
      expect(g!.flag).toBe(Boolean(e.expected_flag));
      // the number form looks at every contracts row of the number, so it is true whenever the row form is
      if (g!.flag) expect(g!.flag_by_number).toBe(true);
    }
  }, 120_000);

  it('is false for a contract with no shipment at all', async () => {
    const r = await query(
      `SELECT (${sqlContractLiveShipmentWithoutAtcExpr({ contractIdExpr: 'c.id' })}) AS flag
         FROM contracts c WHERE NOT EXISTS (SELECT 1 FROM shipments s WHERE s.contract_id = c.id) LIMIT 1`,
    );
    if (r.rows.length > 0) expect(r.rows[0].flag).toBe(false);
  }, 60_000);

  it('the row-set column is valid SQL on a row set carrying id, the ATC and the import status', async () => {
    const r = await query(
      `SELECT ${sqlLiveShipmentWithoutAtcFlagColumn('base')} AS flag
         FROM (SELECT c.id, NULL::date AS last_ata_vessel_complete_discharge, 'Open'::text AS import_status FROM contracts c LIMIT 1) base`,
    );
    // no ATC on the fake row, so the CASE has nothing to evaluate
    if (r.rows.length > 0) expect(r.rows[0].flag).toBeNull();
  }, 60_000);
});
