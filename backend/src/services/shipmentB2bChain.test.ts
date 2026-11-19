import { afterAll, describe, expect, it } from 'vitest';
import pool from '../database/connection';
import { applyB2bChainsToDetails, loadB2bChainsForGroup, type B2bChain } from './shipmentB2bChain.service';
import { resolveShipmentEditPayload } from './shipmentEditPayload.service';

/**
 * Production STO 1006021152 (2026-11-19): SAP books the STO on the CHILD 1004033142 only; the PO table came back empty and the modal built two rows (parent 9144101942 from the list,
 * child from the shipment) for one cargo, both editable. The chain must show as its PARENT, once, carrying the child's KLIP quantities.
 */
const chain = (over: Partial<B2bChain> = {}): B2bChain => ({
  shipmentId: 'ship-1',
  child: '1004033142',
  origin: '9144101942',
  originPo: '9141001942',
  originSupplier: 'BUMI INDAWA',
  originProduct: 'CPO',
  originQtyKg: 4_500_000,
  originIncoterm: 'FOB',
  deliveredKlipKg: 4_495_000,
  receiveKlipKg: null,
  planKg: null,
  ...over,
});

describe('a B2B chain in the PO table is its parent, once', () => {
  it('lists the parent from the contract when the query returned nothing, with the child\'s KLIP quantity', () => {
    const rows = applyB2bChainsToDetails([], [chain()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      contract_number: '9144101942',
      po_number: '9141001942',
      supplier: 'BUMI INDAWA',
      contract_qty: 4_500_000,
      quantity_delivered_klip: 4_495_000,
      contract_row_id: null,
    });
  });

  it('never lists the child', () => {
    const rows = applyB2bChainsToDetails([{ contract_number: '1004033142', po_number: '1001033142' }], [chain()]);
    expect(rows.map((r) => r.contract_number)).toEqual(['9144101942']);
  });

  it('keeps the parent row the query returned and gives it the child\'s quantity only when it has none of its own', () => {
    const empty = applyB2bChainsToDetails([{ contract_number: '9144101942', quantity_delivered_klip: null }], [chain()]);
    expect(empty).toHaveLength(1);
    expect(empty[0].quantity_delivered_klip).toBe(4_495_000);
    const own = applyB2bChainsToDetails([{ contract_number: '9144101942', quantity_delivered_klip: 1000 }], [chain()]);
    expect(own[0].quantity_delivered_klip).toBe(1000);
  });

  it('leaves the other POs of the STO alone', () => {
    const rows = applyB2bChainsToDetails([{ contract_number: '1004000000', po_number: '1001000000' }], [chain()]);
    expect(rows.map((r) => r.contract_number).sort()).toEqual(['1004000000', '9144101942']);
  });

  it('with two child shipments under one parent, lists the parent once and invents no figure', () => {
    const rows = applyB2bChainsToDetails([], [chain({ shipmentId: 'a' }), chain({ shipmentId: 'b', child: '1004033999' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity_delivered_klip).toBeNull();
  });

  it('with no chain, returns the rows untouched', () => {
    const rows = [{ contract_number: 'X' }];
    expect(applyB2bChainsToDetails(rows, [])).toBe(rows);
  });
});

describe('the PO table of a real STO whose only carrier is a B2B child (against the database)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('shows the parent of the chain and not the child', async () => {
    const pick = await pool.query(
      `SELECT s.id::text AS shipment_id, c.contract_id AS child, oc.contract_id AS origin,
              TRIM(COALESCE(NULLIF(s.operation_id::text, ''), NULLIF(s.shipment_id::text, ''))) AS lookup
         FROM shipments s
         JOIN contracts c ON c.id = s.contract_id
         JOIN contract_latest_spd_snapshot chb ON chb.contract_number = c.contract_id AND UPPER(COALESCE(chb.b2b_flag_raw, '')) = 'B2B' AND NULLIF(TRIM(chb.contract_reference_po_raw), '') IS NOT NULL
         JOIN contracts oc ON TRIM(oc.po_number::text) = TRIM(chb.contract_reference_po_raw) AND oc.contract_id <> c.contract_id
        WHERE COALESCE(s.status, '') <> 'CANCELLED'
          AND NOT EXISTS (SELECT 1 FROM shipments s2 WHERE s2.contract_id = oc.id)
          AND NULLIF(TRIM(COALESCE(NULLIF(s.operation_id::text, ''), NULLIF(s.shipment_id::text, ''))), '') IS NOT NULL
        LIMIT 1`,
    );
    if (pick.rows.length === 0) return; // nothing of this shape in this database
    const { shipment_id: shipmentId, child, origin, lookup } = pick.rows[0] as { shipment_id: string; child: string; origin: string; lookup: string };

    const chains = await loadB2bChainsForGroup(lookup, shipmentId);
    expect(chains.some((c) => c.child === child && c.origin === origin)).toBe(true);

    const payload = await resolveShipmentEditPayload(shipmentId, lookup);
    const numbers = (payload?.contractDetails ?? []).map((d) => String(d.contract_number ?? '').trim());
    expect(numbers).toContain(origin);
    expect(numbers).not.toContain(child);
    expect(numbers.filter((n) => n === origin)).toHaveLength(1);
    // the parent row is one the modal lets you type on: its quantity goes to the child's shipment
    const parentRow = (payload?.contractDetails ?? []).find((d) => String(d.contract_number ?? '').trim() === origin);
    expect(parentRow?.klip_qty_editable).not.toBe(false);
  });
});
