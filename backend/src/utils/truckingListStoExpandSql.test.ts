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
    expect(sql).toContain('contract_qty_move_snapshot');
    expect(sql).toContain('COALESCE(NULLIF(spq_d.qty_kg, 0), qm.quantity_delivery_trucking)');
    expect(sql).toContain('COALESCE(NULLIF(spq_r.qty_kg, 0), qm.quantity_receive)');
  });

  it('recomputes pipeline status per operation / PO (not passthrough)', () => {
    const sql = wrapTruckingListQueryWithStoExpansion('SELECT 1 AS id');
    expect(sql).toContain('sto_line_resolved');
    expect(sql).toContain("'COMPLETED'");
    expect(sql).toContain('trucking_daily_actuals');
    expect(sql).toContain("data->'contract'->>'sto_quantity'");
    expect(sql).toContain('INNER JOIN contracts c ON c.id = e.contract_id');
    expect(sql).toContain('spd.contract_number = c.contract_id');
    expect(sql).not.toContain('spd.contract_number = k.contract_number');
    expect(sql).not.toContain('spd.contract_number = e.contract_number');
    expect(sql).toContain('INNER JOIN trucking_operations t ON t.id = e.id');
    expect(sql).toContain('is_contract_sap_closed');
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
    expect(sql).toContain('FALSE AS is_contract_sap_closed');
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
    expect(withSnap).toContain('COALESCE(');
    expect(withSnap).toContain("NULLIF(sn.stage, 'COMPLETED')");
    // Live COMPLETED (OS ≈ 0 MT / GR Close) must win over a stale snapshot stage.
    // Stale snapshot COMPLETED must not stick when live GR/OS no longer qualifies.
    expect(withSnap).toMatch(/WHEN[\s\S]*THEN 'COMPLETED'[\s\S]*ELSE COALESCE\(/);

    const withoutSnap = buildTruckingListExpansionSql(inner, { skipSapJoin: true });
    expect(withoutSnap).not.toContain('trucking_list_stage_snapshot');
  });

  /**
   * Regression: the qty-resolution CTEs (and their `grc` alias) are only emitted when
   * skipSapJoin is false. Referencing grc.is_closed on the shell path made Postgres reject the
   * whole query with 42P01 and the Trucking page rendered "No Trucking operations found" - the
   * shell is what the first paint requests, so the page was empty for every user.
   */
  it('scopes both contract_sto_lines branches to trucking_source, not the whole database', () => {
    // Unscoped, these branches enumerated every contract in the database and relied on the
    // outer join to discard the rest: a single-contract request still probed
    // sap_processed_data 15,737 times. Keep the predicate on BOTH branches.
    const sql = buildTruckingListExpansionSql('SELECT 1 AS id', { skipSapJoin: false });
    const scopeMatches = sql.match(
      /IN \(SELECT ts_scope\.contract_id FROM trucking_source ts_scope\)/g,
    );
    expect(scopeMatches?.length).toBe(2);
    expect(sql).toContain(
      'AND cs.contract_id IN (SELECT ts_scope.contract_id FROM trucking_source ts_scope)',
    );
    expect(sql).toContain(
      'AND c2.id IN (SELECT ts_scope.contract_id FROM trucking_source ts_scope)',
    );
    // The scope predicate is only sound while trucking_source is declared before this CTE.
    expect(sql.indexOf('trucking_source AS')).toBeLessThan(sql.indexOf('contract_sto_lines AS'));
  });

  it('only references the grc alias in a query that also joins gr_closed', () => {
    const inner = 'SELECT 1 AS id';
    for (const skipSapJoin of [true, false]) {
      const sql = buildTruckingListExpansionSql(inner, { skipSapJoin });
      if (sql.includes('grc.')) {
        expect(sql).toContain('LEFT JOIN gr_closed grc ON grc.contract_uuid = e.contract_id');
        expect(sql).toContain('gr_closed AS MATERIALIZED');
      }
    }
  });

  it('resolves GR-close and SAP-cancelled per contract on both paths, not inline per row', () => {
    const inner = 'SELECT 1 AS id';
    for (const skipSapJoin of [true, false]) {
      const sql = buildTruckingListExpansionSql(inner, { skipSapJoin });
      // The stage/completed expressions read the columns...
      expect(sql).toContain('COALESCE(grc.is_closed, false)');
      expect(sql).toContain('COALESCE(grc.is_cancelled, false)');
      // ...and the 26KB status expression is expanded once, inside the CTE that defines them.
      const expansions = (sql.match(/BOOL_OR\(s\.row_open\)/g) || []).length;
      expect(expansions).toBeLessThanOrEqual(2);
    }
  });
});
