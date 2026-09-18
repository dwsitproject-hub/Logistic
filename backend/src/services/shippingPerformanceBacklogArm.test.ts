import { describe, expect, it } from 'vitest';
import {
  buildShippingPerformanceBacklogSql,
  isUnplannedBacklogRow,
} from './shippingPerformance.service';

/**
 * Outstanding Qty meant two things on two pages: the Shipments OS counts unplanned contracts and
 * this page, built from shipments, could not. CPO / Bontang read 49,107 MT here against 80,939 MT
 * there, almost all of it backlog.
 */
describe('Shipping Performance: the unplanned backlog arm', () => {
  it('takes membership from the Shipments page function, not a copy of its criteria', async () => {
    const sql = await buildShippingPerformanceBacklogSql();
    // Fingerprints of contractBacklogCoreWhereSql. If someone reimplements the rule here, these go.
    expect(sql).toContain('FROM shipments s_ns');
    expect(sql).toContain('latest_spd_contract');
    expect(sql).toContain('contract_qty_move_snapshot qm');
  });

  it('marks its rows so the averages can exclude them', async () => {
    const sql = await buildShippingPerformanceBacklogSql();
    expect(sql).toContain('AS is_unplanned_backlog');
    expect(sql).toContain("'UNPLANNED'::text                         AS status");
  });

  it('never emits a row with nothing outstanding', async () => {
    const sql = await buildShippingPerformanceBacklogSql();
    expect(sql).toMatch(/AND \(.*\) > 0/s);
  });

  it('sets outstanding_qty_aggregate equal to the row itself, so nothing is apportioned', async () => {
    // A contract with no shipment has no sibling STOs to share with; dividing it would understate.
    const sql = await buildShippingPerformanceBacklogSql();
    expect(sql).toContain('AS outstanding_qty_aggregate');
    expect(sql).toContain('1::int                                    AS po_sto_count');
  });

  it('isUnplannedBacklogRow reads the flag and tolerates the string form', () => {
    expect(isUnplannedBacklogRow({ is_unplanned_backlog: true })).toBe(true);
    expect(isUnplannedBacklogRow({ is_unplanned_backlog: 'true' })).toBe(true);
    expect(isUnplannedBacklogRow({ is_unplanned_backlog: false })).toBe(false);
    expect(isUnplannedBacklogRow({})).toBe(false);
  });
});
