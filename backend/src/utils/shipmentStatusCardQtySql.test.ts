import { describe, expect, it } from 'vitest';
import {
  applyShipmentStatusCardZeroGuards,
  applyShipmentStatusVesselZeroGuards,
  buildShipmentStatusCardQtyExecutionAggregateQuery,
  mergeShipmentStatusCardQtyParts,
  parseShipmentStatusContractQtyFromExecutionRow,
  parseShipmentStatusOutstandingQtyFromSqlRow,
  sumShipmentStatusOutstandingQtyKg,
} from './shipmentStatusCardQtySql';

describe('shipmentStatusCardQtySql', () => {
  it('parseShipmentStatusContractQtyFromExecutionRow maps kg fields', () => {
    const parsed = parseShipmentStatusContractQtyFromExecutionRow({
      unplanned_execution_contract_qty: '1000',
      planned_contract_qty: 2000,
      completed_contract_qty: '500',
      cancelled_contract_qty: null,
    });
    expect(parsed).toEqual({
      unplannedExecution: 1000,
      planned: 2000,
      completed: 500,
      cancelled: 0,
    });
  });

  it('parseShipmentStatusOutstandingQtyFromSqlRow maps kg fields', () => {
    const parsed = parseShipmentStatusOutstandingQtyFromSqlRow({
      at_loading_port_outstanding_qty: '3000',
      sailed_outstanding_qty: 1000,
      at_discharge_port_outstanding_qty: '2500',
    });
    expect(parsed).toEqual({
      atLoadingPort: 3000,
      sailed: 1000,
      atDischargePort: 2500,
    });
  });

  it('mergeShipmentStatusCardQtyParts combines backlog + preplanned', () => {
    const merged = mergeShipmentStatusCardQtyParts({
      execution: {
        unplannedExecution: 1000,
        planned: 2000,
        completed: 500,
        cancelled: 0,
      },
      unplannedBacklogContractQtyKg: 9000,
      preplannedContractQtyKg: 4000,
      unplannedBacklogOutstandingQtyKg: 8000,
      preplannedOutstandingQtyKg: 3500,
      outstanding: {
        unplannedExecution: 900,
        planned: 1800,
        atLoadingPort: 100,
        sailed: 200,
        atDischargePort: 300,
      },
    });
    expect(merged.statusContractQty.unplanned).toBe(9000);
    expect(merged.statusContractQty.preplanned).toBe(4000);
    expect(merged.statusContractQty.completed).toBe(500);
    expect(merged.statusOutstandingQty.unplanned).toBe(8000);
    expect(merged.statusOutstandingQty.preplanned).toBe(3500);
    expect(merged.statusOutstandingQty.planned).toBe(1800);
    expect(merged.statusOutstandingQty.atLoadingPort).toBe(100);
  });

  it('mergeShipmentStatusCardQtyParts adds completed PO-backlog contract qty', () => {
    const merged = mergeShipmentStatusCardQtyParts({
      execution: {
        unplannedExecution: 0,
        planned: 0,
        completed: 500,
        cancelled: 0,
      },
      unplannedBacklogContractQtyKg: 0,
      preplannedContractQtyKg: 0,
      completedBacklogContractQtyKg: 4000,
      unplannedBacklogOutstandingQtyKg: 0,
      preplannedOutstandingQtyKg: 0,
      outstanding: {
        unplannedExecution: 0,
        planned: 0,
        atLoadingPort: 0,
        sailed: 0,
        atDischargePort: 0,
      },
    });
    expect(merged.statusContractQty.completed).toBe(4500);
  });

  it('buildShipmentStatusCardQtyExecutionAggregateQuery includes stage filters', () => {
    const sql = buildShipmentStatusCardQtyExecutionAggregateQuery(
      'WITH shipment_base AS (SELECT 1)',
      ' AND sb.incoterm IS NOT NULL',
    );
    expect(sql).toContain('unplanned_execution_contract_qty');
    expect(sql).toContain('unplanned_execution_outstanding_qty');
    expect(sql).toContain('planned_outstanding_qty');
    expect(sql).toContain('at_loading_port_outstanding_qty');
    expect(sql).toContain("effective_status = 'PLANNED'");
    expect(sql).toContain('FALSE AS is_unplanned_execution');
    expect(sql).toContain('contract_qty');
    expect(sql).not.toMatch(/FROM enriched e[\s\S]*e\.is_contract_sap_closed/);
    expect(sql).toContain('outstanding_quantity');
  });

  it('sumShipmentStatusOutstandingQtyKg sums the six active stages', () => {
    expect(
      sumShipmentStatusOutstandingQtyKg({
        unplanned: 1000,
        preplanned: 2000,
        planned: 3000,
        atLoadingPort: 4000,
        sailed: 5000,
        atDischargePort: 6000,
      }),
    ).toBe(21000);
  });

  it('applyShipmentStatusCardZeroGuards clears OS when stage count is 0', () => {
    const guarded = applyShipmentStatusCardZeroGuards({
      counts: {
        unplanned: 1,
        preplanned: 0,
        planned: 2,
        atLoadingPort: 0,
        sailed: 0,
        atDischargePort: 3,
        completed: 0,
        cancelled: 0,
      },
      statusOutstandingQty: {
        unplanned: 100,
        preplanned: 50,
        planned: 200,
        atLoadingPort: 30,
        sailed: 40,
        atDischargePort: 60,
      },
      statusContractQty: {
        unplanned: 1,
        preplanned: 2,
        planned: 3,
        completed: 4,
        cancelled: 5,
      },
    });
    expect(guarded.statusOutstandingQty).toEqual({
      unplanned: 100,
      preplanned: 0,
      planned: 200,
      atLoadingPort: 0,
      sailed: 0,
      atDischargePort: 60,
    });
    expect(guarded.statusContractQty?.completed).toBe(0);
    expect(guarded.statusContractQty?.preplanned).toBe(0);
  });

  it('applyShipmentStatusVesselZeroGuards clears vessel lists when count is 0', () => {
    const vessels = applyShipmentStatusVesselZeroGuards(
      {
        unplanned: 0,
        preplanned: 0,
        planned: 1,
        atLoadingPort: 0,
        sailed: 0,
        atDischargePort: 0,
        completed: 2,
        cancelled: 0,
      },
      {
        unplanned: ['A'],
        preplanned: [],
        planned: ['B'],
        atLoadingPort: ['C'],
        sailed: ['D'],
        atDischargePort: ['E'],
        completed: ['F'],
        cancelled: ['G'],
      },
    );
    expect(vessels.unplanned).toEqual([]);
    expect(vessels.planned).toEqual(['B']);
    expect(vessels.sailed).toEqual([]);
    expect(vessels.completed).toEqual(['F']);
  });
});
