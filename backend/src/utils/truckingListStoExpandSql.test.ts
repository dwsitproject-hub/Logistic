import { describe, expect, it } from 'vitest';
import {
  buildTruckingListExpansionSql,
  wrapTruckingListQueryWithStoExpansion,
} from './truckingListStoExpandSql';

describe('truckingListStoExpandSql', () => {
  it('wrapTruckingListQueryWithStoExpansion aggregates STOs at PO grain with Open→WB dual qty', () => {
    const sql = wrapTruckingListQueryWithStoExpansion('SELECT 1 AS id');
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('expanded');
    expect(sql).toContain('STRING_AGG');
    expect(sql).toContain('trucking_daily_actuals');
    expect(sql).toContain('quantity_delivery_kg');
    expect(sql).toContain('quantity_receive_kg');
    expect(sql).toContain('Quantity Delivery Trucking');
    expect(sql).toContain("= 'FRC'");
    expect(sql).toContain("= 'LCO'");
    // OS uses Contract Qty − Σ Delivery/Receive across STOs on the PO
    expect(sql).toContain('COALESCE(e.contract_qty, 0)');
    expect(sql).toContain("data->'raw'->>'PO No'");
  });

  it('recomputes pipeline status per operation / PO (not passthrough)', () => {
    const sql = wrapTruckingListQueryWithStoExpansion('SELECT 1 AS id');
    expect(sql).toContain('sto_line_resolved');
    expect(sql).toContain("'COMPLETED'");
    expect(sql).toContain('trucking_daily_actuals');
    expect(sql).toContain("data->'contract'->>'sto_quantity'");
    expect(sql).toContain('INNER JOIN contracts c ON c.id = e.contract_id');
    expect(sql).toContain('INNER JOIN trucking_operations t ON t.id = e.id');
    expect(sql).not.toMatch(/\be\.status\b/);
  });

  it('skipSapJoin shell mode avoids SAP qty_move and PO-level SAP subqueries', () => {
    const sql = wrapTruckingListQueryWithStoExpansion('SELECT 1 AS id', { skipSapJoin: true });
    expect(sql).toContain('contract_stos');
    expect(sql).not.toContain('qty_move');
    // Shell returns null qty/OS for display; stage still uses op-level outstanding.
    expect(sql).toContain('NULL::numeric AS quantity_delivered');
    expect(sql).toContain('NULL::numeric AS quantity_receive');
    expect(sql).toContain('NULL::numeric AS outstanding_quantity');
    expect(sql).toContain('e.outstanding_quantity');
    expect(sql).not.toMatch(/FROM sap_processed_data spd\s+WHERE spd\.contract_number = e\.contract_number/);
  });

  it('expansion paging restricts expanded rows to paged operation keys', () => {
    const sql = wrapTruckingListQueryWithStoExpansion('SELECT 1 AS id', {
      skipSapJoin: true,
      expansionPaging: { limit: 10, offset: 20, orderBySql: 'ts.created_at DESC' },
    });
    expect(sql).toContain('WHERE rn > 20 AND rn <= 30');
    expect(sql).toContain('INNER JOIN paged_expansion pe ON pe.operation_id = ts.id');
    // One key per operation (no sto_line in expansion_keys)
    expect(sql).toMatch(/expansion_keys AS \(\s*SELECT DISTINCT ts\.id AS operation_id/s);
  });

  it('resolves sto_line_resolved via a pre-aggregated JOIN, not a correlated per-row subquery', () => {
    const sql = wrapTruckingListQueryWithStoExpansion('SELECT 1 AS id');
    // Computed once (GROUP BY), not re-run per output row.
    expect(sql).toContain('contract_sto_lines_agg AS MATERIALIZED');
    expect(sql).toMatch(/GROUP BY contract_uuid/);
    // expanded LEFT JOINs the pre-aggregated result instead of a correlated subquery.
    expect(sql).toContain('LEFT JOIN contract_sto_lines_agg csla ON csla.contract_uuid = ts.contract_id');
    expect(sql).toContain('COALESCE(csla.agg_sto_lines,');
    // The old correlated-per-row shape (WHERE csl.contract_uuid = ts.contract_id inside the
    // SELECT list) must not reappear — that was the ~12s-of-42s regression this guards against.
    expect(sql).not.toMatch(/WHERE csl\.contract_uuid = ts\.contract_id/);
  });

  it('resolves row stage from trucking_list_stage_snapshot only when enabled', () => {
    const inner = 'SELECT 1 AS id, 2 AS contract_id';
    const withSnap = buildTruckingListExpansionSql(inner, {
      skipSapJoin: true,
      useStageSnapshot: true,
    });
    expect(withSnap).toContain('LEFT JOIN trucking_list_stage_snapshot sn');
    expect(withSnap).toContain('ON sn.operation_id = e.id');
    expect(withSnap).toContain('COALESCE(sn.stage,');
    // Live COMPLETED (OS ≈ 0 MT / GR Close) must win over a stale snapshot stage.
    expect(withSnap).toMatch(/WHEN[\s\S]*THEN 'COMPLETED'[\s\S]*ELSE COALESCE\(sn\.stage,/);

    const withoutSnap = buildTruckingListExpansionSql(inner, { skipSapJoin: true });
    expect(withoutSnap).not.toContain('trucking_list_stage_snapshot');
  });
});
