import { describe, expect, it } from 'vitest';
import {
  aggregateShippingPerformanceRowsBySto,
  shippingPerfStoGroupKey,
} from '../services/shippingPerformance.service';

describe('aggregateShippingPerformanceRowsBySto', () => {
  it('collapses multiple PO rows on the same STO with per-PO outstanding sums', () => {
    const rows = aggregateShippingPerformanceRowsBySto([
      {
        id: 'a',
        shipment_id: '1646000083',
        sto_number: '1646000083',
        po_number: '1641000216',
        contract_number: '1004030411',
        contract_qty: 800_000,
        sto_qty: 500_000,
        received_qty: 200_000,
        delivered_qty: 0,
        planning_qty: 100_000,
        incoterm: 'CIF',
        vessel_name: 'BG GLORY 7',
      },
      {
        id: 'b',
        shipment_id: '1646000083',
        sto_number: '1646000083',
        po_number: '1641000217',
        contract_number: '1004030412',
        contract_qty: 800_000,
        sto_qty: 500_000,
        received_qty: 200_000,
        delivered_qty: 0,
        planning_qty: 50_000,
        incoterm: 'CIF',
        vessel_name: 'BG GLORY 7',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(shippingPerfStoGroupKey(rows[0]!)).toBe('sto:1646000083');
    expect(rows[0]?.contract_qty).toBe(1_600_000);
    expect(rows[0]?.sto_qty).toBe(1_000_000);
    expect(rows[0]?.received_qty).toBe(400_000);
    expect(rows[0]?.outstanding_qty_actual).toBe(1_200_000);
    expect(rows[0]?.outstanding_qty_planning).toBe(450_000);
  });

  it('groups unplanned rows by SQL sto_key (SAP STO) when shipment_id differs', () => {
    const rows = aggregateShippingPerformanceRowsBySto([
      {
        id: 'a',
        shipment_id: '1006017437',
        sto_number: '1006017941',
        sto_key: '1006017941',
        po_numbers: '1001027917, 1001028042',
        contract_qty: 3_750_000,
        received_qty: 3_000_000,
        delivered_qty: 3_000_000,
        outstanding_qty_actual: 750_000,
        vessel_name: 'TEST VESSEL',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(shippingPerfStoGroupKey(rows[0]!)).toBe('sto:1006017941');
    expect(rows[0]?.contract_qty).toBe(3_750_000);
  });

  it('uses sto_metrics join fields when present', () => {
    const rows = aggregateShippingPerformanceRowsBySto([
      {
        id: 'a',
        shipment_id: '1646000083',
        po_numbers: '1641000216, 1641000217',
        contract_numbers: '1004030411, 1004030412',
        contract_qty: 1_600_000,
        sto_qty: 1_000_000,
        received_qty: 400_000,
        outstanding_qty_actual: 1_200_000,
        outstanding_qty_planning: 450_000,
        planning_qty: 150_000,
        delivered_qty: 0,
      },
      {
        id: 'b',
        shipment_id: '1646000083',
        po_numbers: '1641000216, 1641000217',
        contract_numbers: '1004030411, 1004030412',
        contract_qty: 1_600_000,
        sto_qty: 1_000_000,
        received_qty: 400_000,
        outstanding_qty_actual: 1_200_000,
        outstanding_qty_planning: 450_000,
        planning_qty: 150_000,
        delivered_qty: 0,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.contract_qty).toBe(1_600_000);
    expect(rows[0]?.po_number).toBe('1641000216, 1641000217');
  });
});
