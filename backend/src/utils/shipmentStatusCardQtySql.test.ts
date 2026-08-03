import { describe, expect, it } from 'vitest';
import {
  buildShipmentStatusCardQtyExecutionAggregateQuery,
  mergeShipmentStatusCardQtyParts,
  parseShipmentStatusContractQtyFromExecutionRow,
  parseShipmentStatusOutstandingQtyFromSqlRow,
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
      outstanding: { atLoadingPort: 100, sailed: 200, atDischargePort: 300 },
    });
    expect(merged.statusContractQty.unplanned).toBe(10000);
    expect(merged.statusContractQty.preplanned).toBe(4000);
    expect(merged.statusOutstandingQty.atLoadingPort).toBe(100);
  });

  it('buildShipmentStatusCardQtyExecutionAggregateQuery includes stage filters', () => {
    const sql = buildShipmentStatusCardQtyExecutionAggregateQuery(
      'WITH shipment_base AS (SELECT 1)',
      ' AND sb.incoterm IS NOT NULL',
    );
    expect(sql).toContain('unplanned_execution_contract_qty');
    expect(sql).toContain('at_loading_port_outstanding_qty');
    expect(sql).toContain("effective_status = 'PLANNED'");
    expect(sql).toContain('is_unplanned_execution');
    expect(sql).toContain('contract_qty');
    expect(sql).not.toMatch(/FROM enriched e[\s\S]*e\.is_contract_sap_closed/);
    expect(sql).toContain('outstanding_quantity');
  });
});
