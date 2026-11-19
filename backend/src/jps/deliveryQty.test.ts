import { describe, expect, it } from 'vitest';
import { deliveryQtyCheck, hasDeliveryQty, type PoDeliveryRow } from './deliveryQty';

const row = (contract: string, po: string, qtyKg: number | null): PoDeliveryRow => ({ contract, po, qtyKg });

describe('Delivery Qty (Klip) required before Submit to Jetty', () => {
  it('counts a PO as filled only above zero: an untouched 0 or an empty field is not a quantity', () => {
    expect(hasDeliveryQty(row('C', 'P', 2000000))).toBe(true);
    expect(hasDeliveryQty(row('C', 'P', 0))).toBe(false);
    expect(hasDeliveryQty(row('C', 'P', null))).toBe(false);
  });

  it('passes when every PO has a quantity, and reports how many POs and the total', () => {
    const check = deliveryQtyCheck([row('C1', '1001033201', 2000000), row('C2', '1001033532', 2000000)])!;
    expect(check.ok).toBe(true);
    expect(check.key).toBe('delivery_qty');
    expect(check.value).toContain('2 PO');
    expect(check.value).toContain('4,000,000 kg');
  });

  it('fails when one PO has none, and names that PO (the contract when it has no PO number)', () => {
    const check = deliveryQtyCheck([row('C1', '1001033201', 2000000), row('C2', '1001033532', null), row('C3', '', 0)])!;
    expect(check.ok).toBe(false);
    expect(check.value).toContain('missing on 2 of 3 PO');
    expect(check.value).toContain('1001033532');
    expect(check.value).toContain('C3');
    expect(check.fixAt).toBe('shipment');
    expect(check.fix).toContain('Edit Shipment');
  });

  it('judges nothing when the STO has no PO row at all (another check reports the missing shipment)', () => {
    expect(deliveryQtyCheck([])).toBeNull();
  });
});
