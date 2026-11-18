import { describe, expect, it } from 'vitest';
import { buildOilLossVesselCompletedCtes } from './oilLossVesselCompletedSql';

/**
 * STO 1006019499 (MT. ARCADIA, FOB), production 2026-11-18: the row summed Delivery / Receive over the POs of the STO as the View Table lists them (a B2B child replaced by
 * its origin), but SAP books the STO's quantities on the CHILD, so two POs of 3,200 and 1,800 MT contributed nothing: R1 330% and R3 -77% while the vessel itself is
 * -0.34% / -0.30%. These tests pin how the SQL now adds the children; the numbers themselves were checked with diag-oil-loss-b2b-sto.cjs.
 */
const sql = buildOilLossVesselCompletedCtes();
const compact = (text: string) => text.replace(/\s+/g, ' ');

describe('B2B children in the Oil Loss vessel rows', () => {
  it('lists the live B2B children once, keyed by the PO of their origin, before vessel_contract_qty uses them', () => {
    const cte = sql.indexOf('b2b_children AS (');
    const use = sql.indexOf('vessel_contract_qty AS (');
    expect(cte).toBeGreaterThan(-1);
    expect(cte).toBeLessThan(use);
    const body = compact(sql.slice(cte, use));
    expect(body).toContain("UPPER(COALESCE(chb.b2b_flag_raw, '')) = 'B2B'");
    expect(body).toContain("NULLIF(TRIM(chb.contract_reference_po_raw), '') IS NOT NULL");
    expect(body).toContain('TRIM(chb.contract_reference_po_raw) AS origin_po');
    expect(body).toContain("NOT IN ('CANCELLED', 'CANCELED')");
  });

  it('computes the own and the children figures once per row, in one LATERAL', () => {
    const part = compact(sql.slice(sql.indexOf('vessel_contract_qty AS ('), sql.indexOf('vessel_qty AS (')));
    expect(part.match(/LEFT JOIN LATERAL \(/g)).toHaveLength(1);
    for (const column of ['own_delivered_kg', 'own_received_kg', 'child_delivered_kg', 'child_received_kg']) {
      expect(part.match(new RegExp(`AS ${column}(?![a-z_])`, 'g')), column).toHaveLength(1);
    }
    expect(part).toContain('WHERE bc.origin_po = TRIM(c2.po_number::text) AND bc.child_contract <> c2.contract_id');
  });

  it("adds the children's figure to the origin's own (0 when it has none), as View Shipment does, and leaves a line without children alone", () => {
    const part = compact(sql.slice(sql.indexOf('vessel_contract_qty AS ('), sql.indexOf('vessel_qty AS (')));
    expect(part).toContain(
      'NULLIF(CASE WHEN fig.child_delivered_kg IS NOT NULL THEN COALESCE(fig.own_delivered_kg::numeric, 0) + fig.child_delivered_kg ELSE fig.own_delivered_kg END, 0) AS quantity_delivery',
    );
    expect(part).toContain(
      'NULLIF(CASE WHEN fig.child_received_kg IS NOT NULL THEN COALESCE(fig.own_received_kg::numeric, 0) + fig.child_received_kg ELSE fig.own_received_kg END, 0) AS quantity_received',
    );
  });

  it("looks the children's SAP rows up by the CHILD's own contract, PO and incoterm (the origin's incoterm must not pick the arm)", () => {
    const part = compact(sql.slice(sql.indexOf('vessel_contract_qty AS ('), sql.indexOf('vessel_qty AS (')));
    expect(part).toContain('bc.child_contract');
    expect(part).toContain('bc.child_po');
    expect(part).toContain("UPPER(TRIM(COALESCE(bc.child_incoterm, '')))");
  });

  it("still looks an origin's or a normal PO's own figure up by its own contract and incoterm", () => {
    const part = compact(sql.slice(sql.indexOf('vessel_contract_qty AS ('), sql.indexOf('vessel_qty AS (')));
    expect(part).toContain("UPPER(TRIM(COALESCE(c2.incoterm, '')))");
    expect(part).toContain('spd.contract_number = c2.contract_id');
  });
});
