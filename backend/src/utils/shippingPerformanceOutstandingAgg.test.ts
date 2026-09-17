import { describe, expect, it } from 'vitest';
import {
  shippingPerfOutstandingQtyKgForAggregate,
  sumShippingPerfOutstandingQtyKg,
} from './shippingPerformanceOutstandingAgg';

describe('shippingPerfOutstandingQtyKgForAggregate', () => {
  it('keeps full OS when the PO has a single STO', () => {
    expect(
      shippingPerfOutstandingQtyKgForAggregate({
        outstanding_qty_actual: 40_000,
        po_sto_count: 1,
      }),
    ).toBe(40_000);
  });

  it('splits PO OS across sibling STOs so three 40 MT rows still sum to 40 MT', () => {
    const rows = [
      { outstanding_qty_actual: 40_000, po_sto_count: 3 },
      { outstanding_qty_actual: 40_000, po_sto_count: 3 },
      { outstanding_qty_actual: 40_000, po_sto_count: 3 },
    ];
    expect(shippingPerfOutstandingQtyKgForAggregate(rows[0]!)).toBeCloseTo(40_000 / 3);
    expect(sumShippingPerfOutstandingQtyKg(rows)).toBeCloseTo(40_000);
  });

  it('treats missing po_sto_count as a single STO', () => {
    expect(shippingPerfOutstandingQtyKgForAggregate({ outstanding_qty_actual: 10_000 })).toBe(
      10_000,
    );
  });
});

describe('shippingPerfOutstandingQtyKgForAggregate — SQL-apportioned value', () => {
  it('uses outstanding_qty_aggregate as-is instead of dividing again', () => {
    expect(
      shippingPerfOutstandingQtyKgForAggregate({
        outstanding_qty_actual: 40_000,
        outstanding_qty_aggregate: 25_000,
        po_sto_count: 3,
      }),
    ).toBe(25_000);
  });

  it('sums the apportioned shares without multiplying by sibling count', () => {
    /** PO-A spans 3 STOs (30k/3 each) and PO-B only this one (10k) => 20k on this STO. */
    const rows = [
      { outstanding_qty_actual: 40_000, outstanding_qty_aggregate: 20_000, po_sto_count: 3 },
      { outstanding_qty_actual: 30_000, outstanding_qty_aggregate: 10_000, po_sto_count: 3 },
      { outstanding_qty_actual: 30_000, outstanding_qty_aggregate: 10_000, po_sto_count: 3 },
    ];
    expect(sumShippingPerfOutstandingQtyKg(rows)).toBeCloseTo(40_000);
  });

  it('still divides by po_sto_count when the apportioned column is absent', () => {
    expect(
      shippingPerfOutstandingQtyKgForAggregate({ outstanding_qty_actual: 30_000, po_sto_count: 3 }),
    ).toBeCloseTo(10_000);
  });

  it('treats a null apportioned value as absent, not as zero', () => {
    expect(
      shippingPerfOutstandingQtyKgForAggregate({
        outstanding_qty_actual: 30_000,
        outstanding_qty_aggregate: null,
        po_sto_count: 3,
      }),
    ).toBeCloseTo(10_000);
  });
});
