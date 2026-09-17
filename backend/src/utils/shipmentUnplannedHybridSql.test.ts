import { describe, expect, it } from 'vitest';
import { OUTSTANDING_QTY_ZERO_TOLERANCE_KG } from './qtyZeroTolerance';
import {
  buildUnplannedContractBacklogCountQuery,
  buildUnplannedContractBacklogPageQuery,
  buildUnplannedContractBacklogTableCountCte,
  buildUnplannedExecutionVesselNamesQuery,
  appendContractScopeToolbarFilters,
  appendUnplannedContractBacklogGlobalSearch,
  unplannedContractBacklogBaseWhereSql,
  unplannedShipmentExecutionOuterSql,
  completedContractBacklogBaseWhereSql,
  grClosedContractBacklogBaseWhereSql,
  sqlBacklogCompletedGateSql,
  BACKLOG_OS_COMPLETED_MAX_KG,
} from './shipmentUnplannedHybridSql';

describe('shipmentUnplannedHybridSql', () => {
  it('requires no shipment row for contract backlog', () => {
    const sql = unplannedContractBacklogBaseWhereSql('c', 'l');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('s_ns.contract_id = c.id');
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('cs_self.contract_id = c.id');
    expect(sql).toContain('IS DISTINCT FROM');
  });

  it('limits contract backlog to CIF/FOB/CFR incoterms (not SEA/MIX or STO Type T)', () => {
    const sql = unplannedContractBacklogBaseWhereSql('c', 'l');
    expect(sql).toContain("IN ('CIF', 'FOB', 'CFR')");
    expect(sql).not.toContain("IN ('SEA', 'MIX')");
    expect(sql).not.toMatch(/=\s*'T'/);
  });

  it('uses FOB Type V scoped SAP closed check for contract backlog', () => {
    const sql = unplannedContractBacklogBaseWhereSql('c', 'l');
    expect(sql).toContain("<> 'FOB'");
    expect(sql).toContain("= 'V'");
    expect(sql).toContain('NOT (');
  });

  it('builds contract backlog count query with contract qty in the same scan', async () => {
    const text = await buildUnplannedContractBacklogCountQuery('AND c.contract_date >= $1', '');
    expect(text).toContain('unplanned_contract_backlog');
    expect(text).toContain('latest_spd_contract');
    expect(text).toContain('COUNT(*)::bigint AS c');
    expect(text).toContain('AS contract_qty_kg');
    expect(text).toContain('AS outstanding_qty_kg');
    expect(text).toContain('LEFT JOIN qty_move qm');
    expect(text).toContain(`> ${OUTSTANDING_QTY_ZERO_TOLERANCE_KG}`);
  });

  it('builds contract backlog page query with contract ext no and outstanding qty', async () => {
    const text = await buildUnplannedContractBacklogPageQuery('AND c.contract_date >= $1', '', 20, 0);
    expect(text).toContain('qty_move');
    expect(text).toContain('contract_ext_no_raw');
    expect(text).toContain('source_type_raw');
    expect(text).toContain('Contract Ext No');
    expect(text).toContain('AS outstanding_quantity');
    expect(text).toContain('c.quantity_ordered AS contract_qty');
    expect(text).not.toContain('NULL::text AS contract_ext_no');
    expect(text).toContain('AS quantity_receive');
    expect(text).toContain('AS quantity_delivered_sap');
    expect(text).toContain('qm.quantity_receive');
    expect(text).toContain('qm.quantity_delivery');
    expect(text).not.toContain('0::numeric AS quantity_delivered');
    expect(text).not.toContain('NULL::numeric AS quantity_receive');
    expect(text).not.toContain('NULL::numeric AS quantity_delivered_sap');
  });

  it('applies server sort on contract backlog page query', async () => {
    const text = await buildUnplannedContractBacklogPageQuery(
      '',
      '',
      20,
      0,
      'po_numbers',
      'ASC',
    );
    expect(text).toContain('c.po_number ASC');
  });

  it('accepts sortKey=status without ORDER BY string literal or missing column', async () => {
    const text = await buildUnplannedContractBacklogPageQuery('', '', 20, 0, 'status', 'ASC');
    expect(text).not.toMatch(/ORDER BY[\s\S]{0,80}'UNPLANNED'/);
    expect(text).toContain('c.contract_date ASC NULLS LAST, c.contract_id ASC');
  });

  it('builds summary table count CTE', () => {
    const cte = buildUnplannedContractBacklogTableCountCte('AND 1=1');
    expect(cte).toContain('unplanned_contract_backlog_table');
    expect(cte).toContain('preplanned_contract_table');
    expect(cte).toContain('preplanned_group_count');
    expect(cte).toContain('COUNT(DISTINCT pg.id)');
  });

  it('excludes ACCEPTED-unlinked (Preplanned) contracts from Unplanned backlog', () => {
    const sql = unplannedContractBacklogBaseWhereSql('c', 'l');
    expect(sql).toContain("pg.status = 'ACCEPTED'");
    expect(sql).toContain('pg.shipment_id IS NULL');
  });

  it('applies product multi filter on contract scope', () => {
    const { sql, params } = appendContractScopeToolbarFilters(
      { product: { type: 'multi', values: ['CPO'] } },
      1,
    );
    expect(sql).toContain('c.product');
    expect(sql).toContain('ANY($1');
    expect(params).toEqual([['CPO']]);
  });

  it('applies supplier multi filter on contract scope', () => {
    const { sql, params } = appendContractScopeToolbarFilters(
      { supplier: { type: 'multi', values: ['PT ABC'] } },
      1,
    );
    expect(sql).toContain('c.supplier');
    expect(params).toEqual([['PT ABC']]);
  });

  it('limits unplanned shipment execution to CIF/FOB/CFR', () => {
    const sql = unplannedShipmentExecutionOuterSql('');
    expect(sql).toContain("'CIF'");
    expect(sql).toContain("'FOB'");
    expect(sql).toContain("'CFR'");
  });

  it('appendUnplannedContractBacklogGlobalSearch matches PO via ILIKE', () => {
    const { sql, params } = appendUnplannedContractBacklogGlobalSearch('1001031130', 3);
    expect(sql).toContain('c.po_number');
    expect(sql).toContain('ILIKE');
    expect(params).toEqual(['%1001031130%']);
  });
});

describe('buildAllHybridContractBacklogQuery', () => {
  it('counts unplanned and preplanned contract backlog together', async () => {
    const { buildAllHybridContractBacklogCountQuery } = await import('./shipmentUnplannedHybridSql');
    const text = await buildAllHybridContractBacklogCountQuery('', '');
    expect(text).toContain('unplanned_contract_backlog');
    expect(text).toContain('preplanned_contract_backlog');
    expect(text).toContain('all_contract_backlog');
    expect(text).toContain('AS outstanding_qty_kg');
    expect(text).not.toContain('qty_move');
  });

  it('pages flat contract rows with both UNPLANNED and PREPLANNED statuses', async () => {
    const { buildAllHybridContractBacklogPageQuery } = await import('./shipmentUnplannedHybridSql');
    const text = await buildAllHybridContractBacklogPageQuery('', '', 20, 0);
    expect(text).toContain('UNPLANNED');
    expect(text).toContain('PREPLANNED');
    expect(text).toContain('COMPLETED');
    expect(text).toContain(`<= ${OUTSTANDING_QTY_ZERO_TOLERANCE_KG}`);
    expect(text).toContain('pre_planned_group_id');
    expect(text).toContain('paged_contracts');
    expect(text).toContain('ORDER BY contract_date DESC NULLS LAST, contract_number ASC');
    expect(text).toContain('LIMIT 20 OFFSET 0');
    expect(text).toContain('qm.quantity_receive');
    expect(text).toContain('qm.quantity_delivery');
    expect(text).not.toContain('0::numeric AS quantity_delivered');
    expect(text).not.toContain('NULL::numeric AS quantity_receive');
    expect(text).toContain('AS plant_code');
    expect(text).toContain("spd.data->'raw'->>'Plant Code'");
  });

  it('scopes qty_move to paged contracts for contract_date sort', async () => {
    const { buildAllHybridContractBacklogPageQuery } = await import('./shipmentUnplannedHybridSql');
    const text = await buildAllHybridContractBacklogPageQuery('', '', 20, 0, 'contract_date', 'ASC');
    expect(text).toContain('paged_contracts');
    expect(text).toContain("SELECT contract_id FROM paged_contracts");
  });

  it('computes qty_move before LIMIT when sorting ALL-hybrid backlog by outstanding qty', async () => {
    const { buildAllHybridContractBacklogPageQuery } = await import('./shipmentUnplannedHybridSql');
    const text = await buildAllHybridContractBacklogPageQuery('', '', 20, 0, 'outstanding_quantity', 'DESC');
    expect(text).not.toContain('paged_contracts');
    expect(text).toContain('qty_move');
    expect(text).toContain('ORDER BY outstanding_quantity DESC');
    expect(text).toContain('LIMIT 20 OFFSET 0');
  });

  it('computes qty_move before LIMIT when sorting ALL-hybrid backlog by delivery qty', async () => {
    const { buildAllHybridContractBacklogPageQuery } = await import('./shipmentUnplannedHybridSql');
    const text = await buildAllHybridContractBacklogPageQuery('', '', 20, 0, 'quantity_delivered', 'DESC');
    expect(text).not.toContain('paged_contracts');
    expect(text).toContain('ORDER BY quantity_delivered DESC');
  });

  it('projects status on ALL-hybrid candidates so sortKey=status is valid SQL', async () => {
    const { buildAllHybridContractBacklogPageQuery } = await import('./shipmentUnplannedHybridSql');
    const text = await buildAllHybridContractBacklogPageQuery('', '', 20, 0, 'status', 'ASC');
    expect(text).toContain("'UNPLANNED'::text AS status");
    expect(text).toContain("'PREPLANNED'::text AS status");
    expect(text).toContain('ORDER BY status ASC NULLS LAST');
    expect(text).not.toMatch(/ORDER BY[\s\S]{0,80}'UNPLANNED'/);
  });

  it('buildUnplannedExecutionVesselNamesQuery scopes to hybrid execution rows only', () => {
    const text = buildUnplannedExecutionVesselNamesQuery(
      'WITH shipment_base AS (SELECT 1)',
      unplannedShipmentExecutionOuterSql(''),
    );
    expect(text).toContain('unplanned_vessel_names');
    expect(text).toContain('is_contract_sap_closed');
    expect(text).toContain('sap_presence');
    expect(text).toContain("'CIF'");
  });
});

describe('buildPreplannedContractsPageQuery', () => {
  it('paginates by group_id and includes pre_planned_group_id on rows', async () => {
    const { buildPreplannedContractsPageQuery } = await import('./shipmentUnplannedHybridSql');
    const text = await buildPreplannedContractsPageQuery('', '', 20, 0);
    expect(text).toContain('preplanned_groups_page');
    expect(text).toContain('pre_planned_group_id');
    expect(text).toContain('GROUP BY pre_planned_group_id');
    expect(text).not.toMatch(/preplanned_contracts[\s\S]*LIMIT 20 OFFSET 0[\s\S]*SELECT \* FROM preplanned_contracts/);
  });
});

describe('completed contract backlog OS gate', () => {
  it('keeps Unplanned page rows with remaining OS above the shared tolerance', async () => {
    const { buildUnplannedContractBacklogPageQuery } = await import('./shipmentUnplannedHybridSql');
    const text = await buildUnplannedContractBacklogPageQuery('', '', 20, 0);
    expect(text).toContain(`> ${OUTSTANDING_QTY_ZERO_TOLERANCE_KG}`);
  });

  it('selects Completed backlog as COMPLETED when remaining OS is within the shared tolerance', async () => {
    const {
      buildCompletedContractBacklogCountQuery,
      buildCompletedContractBacklogPageQuery,
    } = await import('./shipmentUnplannedHybridSql');
    const countSql = await buildCompletedContractBacklogCountQuery('', '');
    expect(countSql).toContain('completed_contract_backlog');
    expect(countSql).toContain(`<= ${OUTSTANDING_QTY_ZERO_TOLERANCE_KG}`);
    const pageSql = await buildCompletedContractBacklogPageQuery('', '', 20, 0);
    expect(pageSql).toContain("'COMPLETED'::text");
    expect(pageSql).toContain(`<= ${OUTSTANDING_QTY_ZERO_TOLERANCE_KG}`);
  });
});

describe('cancelled contract backlog', () => {
  it('selects Cancelled SEA POs without shipment and forces zero OS', async () => {
    const {
      buildCancelledContractBacklogCountQuery,
      buildCancelledContractBacklogPageQuery,
      cancelledContractBacklogBaseWhereSql,
    } = await import('./shipmentUnplannedHybridSql');
    const whereSql = cancelledContractBacklogBaseWhereSql('c', 'l');
    expect(whereSql).toContain("'CANCELLED', 'CANCELED', 'CANCEL'");
    expect(whereSql).toContain('NOT EXISTS');
    expect(whereSql).toContain('s_ns.contract_id = c.id');
    const countSql = await buildCancelledContractBacklogCountQuery('', '');
    expect(countSql).toContain('cancelled_contract_backlog');
    expect(countSql).toContain('0::numeric AS outstanding_qty_kg');
    const pageSql = await buildCancelledContractBacklogPageQuery('', '', 20, 0);
    expect(pageSql).toContain("'CANCELLED'::text");
    expect(pageSql).toContain('cancelled_contract_backlog');
  });
});

/**
 * A GR-closed sea PO with no shipment row used to reach neither half of the page: the execution
 * half needs a shipments row, and the backlog half folded GR-Close in with Cancelled. It stayed
 * visible on the Contract page, which has no such gate, so it read as a bug rather than a rule.
 */
describe('GR-closed contract backlog', () => {
  it('keeps GR-closed contracts out of the open arms and inside the completed one', () => {
    const unplanned = unplannedContractBacklogBaseWhereSql('c', 'l');
    const completed = completedContractBacklogBaseWhereSql('c', 'l');
    const grClosed = grClosedContractBacklogBaseWhereSql('c', 'l');

    // The open arm still refuses anything SAP-inactive - that is what keeps the arms disjoint.
    expect(unplanned).toContain('Close');
    // The completed arm no longer refuses a closed contract, only a cancelled one.
    expect(completed).not.toBe(unplanned);
    // The GR-closed arm is the completed one narrowed to closed contracts. Compared on collapsed
    // whitespace, because both are assembled from indented template literals.
    const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();
    expect(flat(grClosed)).toContain(flat(completed));
    expect(flat(grClosed).length).toBeGreaterThan(flat(completed).length);
  });

  it('still requires the sea scope and the absence of a shipment row', () => {
    const grClosed = grClosedContractBacklogBaseWhereSql('c', 'l');
    expect(grClosed).toContain("IN ('CIF', 'FOB', 'CFR')");
    expect(grClosed).toContain('NOT EXISTS');
    expect(grClosed).toContain('FROM shipments s_ns');
  });

  it('admits a closed contract even when outstanding qty is above the completed threshold', () => {
    // SAP closes on receipt, not on the last kilogram, so an OS-only gate would put these rows
    // straight back into the hole this change exists to fill.
    const gate = sqlBacklogCompletedGateSql('c');
    expect(gate).toContain(' OR ');
    expect(gate).toContain(String(BACKLOG_OS_COMPLETED_MAX_KG));
  });
});
