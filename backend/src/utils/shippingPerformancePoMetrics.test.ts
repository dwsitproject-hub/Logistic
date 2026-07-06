import { describe, expect, it } from 'vitest';
import {
  aggregateShippingPerfPoLines,
  isShippingPerfB2bChildRow,
  mergePoMetricsFromRows,
  poOutstandingActualKg,
  poOutstandingPlanningKg,
  resolvePoFulfilledKg,
} from './shippingPerformancePoMetrics';

describe('shippingPerformancePoMetrics', () => {
  it('resolvePoFulfilledKg follows incoterm matrix', () => {
    expect(resolvePoFulfilledKg('CIF', 100, 200)).toBe(100);
    expect(resolvePoFulfilledKg('FOB', 100, 200)).toBe(200);
    expect(resolvePoFulfilledKg('EXW', 0, 200)).toBe(200);
  });

  it('detects B2B child contracts', () => {
    expect(isShippingPerfB2bChildRow({ b2b_flag: 'B2B', contract_reference_po: 'PO1' })).toBe(true);
    expect(isShippingPerfB2bChildRow({ b2b_flag: 'B2B', contract_reference_po: '' })).toBe(false);
  });

  it('aggregates STO outstanding as total contract minus total fulfilled (net)', () => {
    const lines = [
      {
        contractId: '1004030411',
        poNumber: '1641000216',
        contractQty: 800_000,
        receiveKg: 200_000,
        deliveryKg: 0,
        stoQtyKg: 500_000,
        planningKg: 100_000,
        incoterm: 'CIF',
      },
      {
        contractId: '1004030412',
        poNumber: '1641000217',
        contractQty: 800_000,
        receiveKg: 200_000,
        deliveryKg: 0,
        stoQtyKg: 500_000,
        planningKg: 50_000,
        incoterm: 'CIF',
      },
    ];
    expect(poOutstandingActualKg(lines[0]!)).toBe(600_000);
    expect(poOutstandingPlanningKg(lines[0]!)).toBe(200_000);
    const agg = aggregateShippingPerfPoLines(lines);
    expect(agg.contractQty).toBe(1_600_000);
    expect(agg.receivedQty).toBe(400_000);
    expect(agg.stoQty).toBe(1_000_000);
    expect(agg.planningQty).toBe(150_000);
    expect(agg.outstandingQtyActual).toBe(1_200_000);
    expect(agg.outstandingQtyPlanning).toBe(450_000);
  });

  it('offsets over-delivery on one PO against STO outstanding (STO 1646000083 pattern)', () => {
    const agg = aggregateShippingPerfPoLines([
      {
        contractId: '1644000150',
        poNumber: '1641000150',
        contractQty: 1_000_000,
        receiveKg: 0,
        deliveryKg: 496_432,
        stoQtyKg: 496_432,
        planningKg: 0,
        incoterm: 'FOB',
      },
      {
        contractId: '1644000216',
        poNumber: '1641000216',
        contractQty: 2_000_000,
        receiveKg: 0,
        deliveryKg: 2_005_641,
        stoQtyKg: 2_005_641,
        planningKg: 0,
        incoterm: 'FOB',
      },
    ]);
    expect(agg.stoQty).toBe(2_502_073);
    expect(agg.deliveredQty).toBe(2_502_073);
    expect(agg.outstandingQtyActual).toBe(497_927);
    expect(agg.outstandingQtyPlanning).toBe(497_927);
    expect(poOutstandingActualKg({
      contractId: '1644000150',
      poNumber: '1641000150',
      contractQty: 1_000_000,
      receiveKg: 0,
      deliveryKg: 496_432,
      stoQtyKg: 496_432,
      planningKg: 0,
      incoterm: 'FOB',
    })).toBe(503_568);
  });

  it('offsets over-planning on one PO against STO planning outstanding (net)', () => {
    const agg = aggregateShippingPerfPoLines([
      {
        contractId: 'A',
        poNumber: 'PO-A',
        contractQty: 1_000_000,
        receiveKg: 0,
        deliveryKg: 0,
        stoQtyKg: 1_000_000,
        planningKg: 1_200_000,
        incoterm: 'FOB',
      },
      {
        contractId: 'B',
        poNumber: 'PO-B',
        contractQty: 1_000_000,
        receiveKg: 0,
        deliveryKg: 0,
        stoQtyKg: 1_000_000,
        planningKg: 0,
        incoterm: 'FOB',
      },
    ]);
    expect(poOutstandingPlanningKg({
      contractId: 'A',
      poNumber: 'PO-A',
      contractQty: 1_000_000,
      receiveKg: 0,
      deliveryKg: 0,
      stoQtyKg: 1_000_000,
      planningKg: 1_200_000,
      incoterm: 'FOB',
    })).toBe(0);
    expect(agg.outstandingQtyPlanning).toBe(0);
  });

  it('subtracts SAP STO qty and KLIP shipment planning at STO level', () => {
    const agg = aggregateShippingPerfPoLines([
      {
        contractId: 'A',
        poNumber: 'PO-A',
        contractQty: 1_000_000,
        receiveKg: 0,
        deliveryKg: 400_000,
        stoQtyKg: 400_000,
        planningKg: 100_000,
        incoterm: 'FOB',
      },
      {
        contractId: 'B',
        poNumber: 'PO-B',
        contractQty: 2_000_000,
        receiveKg: 0,
        deliveryKg: 0,
        stoQtyKg: 0,
        planningKg: 50_000,
        incoterm: 'FOB',
      },
    ]);
    expect(agg.outstandingQtyActual).toBe(2_600_000);
    expect(agg.outstandingQtyPlanning).toBe(2_450_000);
  });

  it('mergePoMetricsFromRows excludes B2B child rows', () => {
    const agg = mergePoMetricsFromRows([
      {
        contract_number: 'ORIGIN',
        contract_qty: 500,
        sto_qty: 500,
        received_qty: 0,
        delivered_qty: 0,
        planning_qty: 0,
        b2b_flag: 'B2B',
        contract_reference_po: '',
      },
      {
        contract_number: 'CHILD',
        contract_qty: 300,
        sto_qty: 300,
        received_qty: 0,
        delivered_qty: 0,
        planning_qty: 0,
        b2b_flag: 'B2B',
        contract_reference_po: 'PO-ORIGIN',
      },
    ]);
    expect(agg.contractQty).toBe(500);
  });
});
