import { describe, expect, it } from 'vitest';
import {
  sqlSapRowScopeForShipment,
  sqlShipmentOwnStoKey,
} from './shipmentEditPayload.service';

describe('shipment edit payload: SAP row must be scoped to this STO', () => {
  it("puts the shipment's own numeric STO ahead of the contract's", () => {
    const sql = sqlShipmentOwnStoKey();
    /*
     * The regression: PO 1001029907 carries STOs 1006019385 and 1006019867 on ONE contract row
     * whose sto_number is 1006019385. With c.sto_number leading, opening 1006019867 looked up the
     * sibling and showed its ATC on a STO SAP leaves NULL.
     */
    expect(sql.indexOf('s.shipment_id')).toBeLessThan(sql.indexOf('c.sto_number'));
    expect(sql).toContain("~ '^[0-9]+$'");
  });

  it('lets an explicit ?sto= hint win over everything', () => {
    const sql = sqlShipmentOwnStoKey('$2');
    expect(sql.indexOf('$2')).toBeLessThan(sql.indexOf('s.shipment_id'));
  });

  it('never makes a row belonging to a different STO eligible', () => {
    const sql = sqlSapRowScopeForShipment(sqlShipmentOwnStoKey('$2'));
    // The PO-wide arm survives only for header rows - those with no STO of their own.
    expect(sql).toMatch(/spd\.contract_number = c\.contract_id AND [\s\S]*IS NULL/);
    // ...and never unguarded, which is what handed back the newest sibling row before.
    expect(sql).not.toMatch(/OR\s+spd\.contract_number = c\.contract_id\s*$/m);
  });
});
