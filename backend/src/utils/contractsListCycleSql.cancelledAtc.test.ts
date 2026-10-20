import { describe, expect, it } from 'vitest';
import { query } from '../database/connection';
import { sqlLastAtaVesselCompleteDischargeForContract } from './contractsListCycleSql';
import { sqlJpsAtaWhileOpen } from './shipmentAtaOverrideSql';

/**
 * Contract 1004032300 (production 2026-10-20): six PLANNED shipments with no ATC and one CANCELLED shipment (STO 1006020263, deleted by SAP) with a KLIP override ATC.
 * The contract's last ATC took that value, Contract Performance read "the contract has discharged" and dropped its 700 MT from Open while Shipping Performance and
 * Shipments kept it. A cancelled shipment is now set aside while the contract has a shipment that is not; a contract whose shipments are ALL cancelled keeps the
 * cancelled ATC as its only record. This runs the expression against the database and compares it with an independently written grouping.
 */
const ATC = `COALESCE(${sqlJpsAtaWhileOpen('jps_ata_discharge_complete', 'sao', 's')}::date, sao.ata_discharge_complete::date, s.ata_discharge_complete::date, vlp.ata_loading_completed::date)`;

describe('the last ATC of a contract ignores a cancelled shipment while a live one exists', () => {
  it('equals the live shipments\' ATC when there are live shipments, and the cancelled one only when there are none', async () => {
    const expected = await query(
      `SELECT s.contract_id::text AS id,
              CASE WHEN COUNT(*) FILTER (WHERE UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED')) > 0
                   THEN MAX(${ATC}) FILTER (WHERE UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED'))
                   ELSE MAX(${ATC}) END AS expected_atc,
              COUNT(*) FILTER (WHERE UPPER(COALESCE(s.status, '')) IN ('CANCELLED', 'CANCELED'))::int AS cancelled,
              COUNT(*) FILTER (WHERE UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED'))::int AS live
         FROM shipments s
         LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
         LEFT JOIN LATERAL (
           SELECT v.ata_loading_completed FROM vessel_loading_ports v
            WHERE v.shipment_id = s.id AND COALESCE(v.is_discharge_port, FALSE) = TRUE AND v.ata_loading_completed IS NOT NULL
            ORDER BY v.ata_loading_completed DESC LIMIT 1
         ) vlp ON TRUE
        GROUP BY s.contract_id
       HAVING COUNT(*) FILTER (WHERE UPPER(COALESCE(s.status, '')) IN ('CANCELLED', 'CANCELED')) > 0
        LIMIT 200`,
    );
    if (expected.rows.length === 0) return; // nothing to test against on this database
    const ids = expected.rows.map((r: { id: string }) => r.id);
    const got = await query(
      `SELECT c.id::text AS id, ${sqlLastAtaVesselCompleteDischargeForContract('c.id')} AS atc FROM contracts c WHERE c.id = ANY($1::uuid[])`,
      [ids],
    );
    const byId = new Map(got.rows.map((r: { id: string; atc: unknown }) => [r.id, r.atc]));
    const day = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : null);
    for (const e of expected.rows as Array<{ id: string; expected_atc: unknown }>) {
      expect(day(byId.get(e.id))).toBe(day(e.expected_atc));
    }
    // the case itself must be in the sample somewhere to mean anything: a contract with live shipments and a cancelled one
    expect(expected.rows.some((r: { live: number; cancelled: number }) => r.live > 0 && r.cancelled > 0)).toBe(true);
  }, 120_000);

  it('the expression still RUNS for a contract with no shipment at all', async () => {
    const r = await query(
      `SELECT ${sqlLastAtaVesselCompleteDischargeForContract('c.id')} AS atc FROM contracts c WHERE NOT EXISTS (SELECT 1 FROM shipments s WHERE s.contract_id = c.id) LIMIT 1`,
    );
    if (r.rows.length > 0) expect(r.rows[0].atc).toBeNull();
  }, 60_000);
});
