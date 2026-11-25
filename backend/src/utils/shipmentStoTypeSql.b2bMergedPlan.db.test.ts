import { afterAll, describe, expect, it } from 'vitest';
import pool from '../database/connection';
import { shipmentListSeaDisplayStoNumberExpr, sqlKlipOwnVoyageOperationIdExpr } from './shipmentStoTypeSql';

/**
 * MT. ARCADIA, production 2026-11-25: the KLIP plan of a B2B origin was merged with the SAP row of its child (plan keeps its OP- id, takes the STO and the child contract). The Shipments list
 * shows a child's shipment under the ORIGIN (c = origin, s.contract_id = child). The STO column read "-": the "own voyage" rule looked for the STO's shell on c, the origin, which has no STO.
 *
 * Reproduced inside a transaction that is ALWAYS rolled back: the plan row of a real B2B pair is given the child's STO and the child's contract exactly as the merge does, then the display
 * expression is evaluated the way the list does (c = origin). Skipped when the database holds no such pair.
 */
describe('a KLIP plan that took the STO of its B2B child shows that STO under the origin (against the database)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('shows the STO of the child under the origin for a row that is an OP- voyage made in KLIP', async () => {
    const pick = await pool.query(
      `SELECT s.id::text AS plan_id, oc.id::text AS origin_id, c.id::text AS child_id, d.id::text AS sap_id, TRIM(d.shipment_id) AS sto
         FROM contracts c
         JOIN contract_latest_spd_snapshot chb
           ON chb.contract_number = c.contract_id AND UPPER(COALESCE(chb.b2b_flag_raw, '')) = 'B2B' AND NULLIF(TRIM(chb.contract_reference_po_raw), '') IS NOT NULL
         JOIN contracts oc ON TRIM(oc.po_number::text) = TRIM(chb.contract_reference_po_raw) AND oc.id <> c.id
         JOIN shipments s ON s.contract_id = oc.id AND UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED')
                         AND s.shipment_id LIKE 'MNL-%' AND NULLIF(TRIM(s.operation_id::text), '') ~ '^OP-' AND COALESCE(s.operation_id_source, '') IS DISTINCT FROM 'SAP_IMPORT'
         JOIN shipments d ON d.contract_id = c.id AND TRIM(d.shipment_id) ~ '^[0-9]+$' AND UPPER(COALESCE(d.status, '')) NOT IN ('CANCELLED', 'CANCELED')
         JOIN contract_stos cs ON cs.contract_id = c.id AND TRIM(cs.sto_number::text) = TRIM(d.shipment_id)
        LIMIT 1`,
    );
    if (pick.rows.length === 0) return; // nothing of this shape in this database
    const { plan_id: plan, origin_id: origin, child_id: child, sap_id: sap, sto } = pick.rows[0] as Record<string, string>;

    const display = shipmentListSeaDisplayStoNumberExpr('c', 'l', 's');
    const own = sqlKlipOwnVoyageOperationIdExpr('s', 'c');
    const evalRow = `SELECT (${display}) AS shown, (${own}) AS own_voyage
                       FROM shipments s JOIN contracts c ON c.id = $2::uuid
                       LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
                      WHERE s.id = $1::uuid`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // what the merge does: the SAP row steps aside, the plan takes the child's contract and the STO
      await client.query(`UPDATE shipments SET shipment_id = 'zz-merged-' || left(id::text, 8) WHERE id = $1::uuid`, [sap]);
      await client.query(`UPDATE shipments SET contract_id = $2::uuid, shipment_id = $3 WHERE id = $1::uuid`, [plan, child, sto]);
      const merged = (await client.query(evalRow, [plan, origin])).rows[0];
      // the scenario is only meaningful when the row is an OP- voyage of KLIP's (else the rule under test is not reached)
      expect(merged.own_voyage).not.toBeNull();
      expect(merged.shown).toBe(sto);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
