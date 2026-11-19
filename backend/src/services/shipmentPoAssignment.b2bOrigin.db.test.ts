import { afterAll, describe, expect, it } from 'vitest';
import pool from '../database/connection';
import { b2bChildShipmentsForOrigins, contractsWithActiveSiblingShipment } from './shipmentPoAssignment.service';

/**
 * Production STO 1006021152 (2026-11-19): the PO table was empty, the modal built a row from the contract the Shipments list carries - the B2B ORIGIN 9144101942 - marked it editable,
 * and saving its Delivered Qty (Klip) answered 400 "No sibling shipment found": only the CHILD 1004033142 has a shipment. A quantity typed on an origin belongs on its child's shipment.
 * Read-only, against the database; the case is found in the data (a B2B origin without a shipment whose child has a live one) and the test is skipped when there is none.
 */
describe('a quantity typed on a B2B origin goes to its child (against the database)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('finds the child shipment of an origin that has none of its own, and unlocks the origin row', async () => {
    const pick = await pool.query(
      `SELECT o.contract_number AS origin,
              ch.contract_number AS child,
              s.id::text AS child_shipment,
              (SELECT TRIM(COALESCE(NULLIF(s.operation_id::text, ''), NULLIF(s.shipment_id::text, ''))) ) AS lookup
         FROM contract_latest_spd_snapshot o
         JOIN contracts oc ON oc.contract_id = o.contract_number
         JOIN contract_latest_spd_snapshot ch
           ON UPPER(COALESCE(ch.b2b_flag_raw, '')) = 'B2B' AND TRIM(ch.contract_reference_po_raw) = TRIM(oc.po_number::text)
         JOIN contracts cc ON cc.contract_id = ch.contract_number AND cc.contract_id <> oc.contract_id
         JOIN shipments s ON s.contract_id = cc.id AND COALESCE(s.status, '') <> 'CANCELLED'
        WHERE UPPER(COALESCE(o.b2b_flag_raw, '')) = 'B2B'
          AND NOT EXISTS (SELECT 1 FROM shipments s2 WHERE s2.contract_id = oc.id)
          AND NULLIF(TRIM(COALESCE(NULLIF(s.operation_id::text, ''), NULLIF(s.shipment_id::text, ''))), '') IS NOT NULL
        LIMIT 1`,
    );
    if (pick.rows.length === 0) return; // nothing of this shape in this database
    const { origin, child, child_shipment: shipment, lookup } = pick.rows[0] as { origin: string; child: string; child_shipment: string; lookup: string };

    const viaChild = await b2bChildShipmentsForOrigins(lookup, shipment, [origin, 'NO-SUCH-CONTRACT']);
    expect(viaChild.get(origin)).toContain(shipment);
    expect(viaChild.has('NO-SUCH-CONTRACT')).toBe(false);

    const editable = await contractsWithActiveSiblingShipment(lookup, shipment, [origin, child, 'NO-SUCH-CONTRACT']);
    expect(editable.has(child)).toBe(true);
    expect(editable.has(origin)).toBe(true);
    expect(editable.has('NO-SUCH-CONTRACT')).toBe(false);
  });

  it('says nothing for a contract that is not a B2B origin, and for no input', async () => {
    expect((await b2bChildShipmentsForOrigins('1006000000', '00000000-0000-0000-0000-000000000000', ['NO-SUCH-CONTRACT'])).size).toBe(0);
    expect((await b2bChildShipmentsForOrigins('', '00000000-0000-0000-0000-000000000000', ['X'])).size).toBe(0);
    expect((await b2bChildShipmentsForOrigins('1006000000', '00000000-0000-0000-0000-000000000000', [])).size).toBe(0);
  });
});
