import { describe, expect, it } from 'vitest';
import { buildShippingPerformanceSql } from './shippingPerformance.service';

/**
 * The B2B child exclusion used to be unconditional, and it lost whole voyages.
 *
 * SAP puts the shipment on the CHILD. The origin usually has none of its own, and a page built
 * from shipments cannot show a contract without one - so dropping the child unconditionally made
 * both halves disappear. Measured on production before the fix: 220 child contracts, 231
 * shipments, 71 distinct STOs, 6,760 MT, including MT. GIAT ARMADA 02 with seven COMPLETED
 * contracts whose actual dates never reached a single delay average.
 */
describe('Shipping Performance: the B2B child exclusion is conditional', () => {
  it('only drops a child when the origin actually has a shipment', async () => {
    const sql = await buildShippingPerformanceSql();
    const clause = sql.slice(sql.indexOf("COALESCE(l.b2b_flag, '') = 'B2B'"));
    // The exclusion must be gated on the origin having a non-cancelled shipment of its own.
    expect(clause).toContain('JOIN shipments so ON so.contract_id = o.id');
    expect(clause).toContain("NULLIF(TRIM(o.po_number::text), '') = NULLIF(TRIM(l.contract_reference_po), '')");
  });

  it('shows a kept child under its ORIGIN contract number', async () => {
    const sql = await buildShippingPerformanceSql();
    expect(sql).toContain('b2b_origin.contract_id::text');
    expect(sql).toContain(') b2b_origin ON TRUE');
    // The origin only overrides for an actual B2B child; everything else keeps its own number.
    expect(sql).toMatch(/WHEN COALESCE\(l\.b2b_flag, ''\) = 'B2B' AND l\.contract_reference_po IS NOT NULL/);
  });

  it('still excludes a child whose origin does carry a shipment, so nothing is double counted', async () => {
    const sql = await buildShippingPerformanceSql();
    // The NOT(...) wrapper has to survive - without it the gate would INCLUDE rather than exclude.
    expect(sql).toContain('AND NOT (');
    expect(sql).toContain("COALESCE(l.b2b_flag, '') = 'B2B'");
  });
});
