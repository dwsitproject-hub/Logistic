import { describe, expect, it } from 'vitest';
import {
  resolveContractLogisticsOperationId,
  resolveContractLogisticsStoNumber,
  resolveContractLogisticsStoStatus,
  resolveSharedShipmentStoDelivered,
  normalizeContractLogisticsStoType,
  summarizeContractLogisticsStoQtyByType,
  summarizeContractLogisticsStoQty,
} from './contractLogisticsStoDisplay';

describe('contractLogisticsStoDisplay', () => {
  it('returns dash when STO is missing', () => {
    expect(resolveContractLogisticsStoNumber(null)).toBe('-');
    expect(resolveContractLogisticsStoNumber('')).toBe('-');
  });

  it('does not show Operation ID as STO No', () => {
    expect(resolveContractLogisticsStoNumber('OP-SEA-030620260001')).toBe('-');
    expect(resolveContractLogisticsStoNumber('MNL-12345678-1004030411')).toBe('-');
  });

  it('shows numeric SAP STO', () => {
    expect(resolveContractLogisticsStoNumber('1586004692')).toBe('1586004692');
  });

  it('resolves operation id from row or synthetic sto_key', () => {
    expect(resolveContractLogisticsOperationId('OP-SEA-030620260001', null)).toBe(
      'OP-SEA-030620260001',
    );
    expect(
      resolveContractLogisticsOperationId(null, 'OP-SEA-030620260001'),
    ).toBe('OP-SEA-030620260001');
    expect(resolveContractLogisticsOperationId(null, '1586004692')).toBeNull();
  });

  it('summarizes real STO qtys without using contract/PO qty', () => {
    const summary = summarizeContractLogisticsStoQty([
      { sto_number: '1006018144', operation_id: 'OP-A', sto_quantity: 500_000 },
      { sto_number: '1006018145', operation_id: 'OP-B', sto_quantity: 250_000 },
      { sto_number: '1006018144', operation_id: 'OP-C', sto_quantity: 400_000 },
    ]);
    expect(summary.sto_count).toBe(2);
    expect(summary.total_sto_quantity).toBe(750_000);
  });

  it('falls back to Operation ID count and deduped SAP STO qty by PO', () => {
    const summary = summarizeContractLogisticsStoQty([
      { sto_number: '-', operation_id: 'OP-LAND-1', sto_quantity: 150_000 },
      { sto_number: '-', operation_id: 'OP-LAND-2', sto_quantity: 150_000 },
    ]);
    expect(summary.sto_count).toBe(2);
    expect(summary.total_sto_quantity).toBe(150_000);
  });

  it('shows COMPLETED when contract SAP Close without ATA milestones', () => {
    expect(
      resolveContractLogisticsStoStatus({
        contractImportStatus: 'Close',
        dbStatus: 'UNPLANNED',
        logisticsType: 'shipment',
      }),
    ).toBe('COMPLETED');
  });

  it('shows CANCELLED when SAP import status is Cancelled (even without shipment row)', () => {
    expect(
      resolveContractLogisticsStoStatus({
        contractImportStatus: 'Cancelled',
        dbStatus: null,
        logisticsType: 'shipment',
        shipmentMilestones: {
          eta_arrival_at_loading_port: '2026-01-15',
        },
      }),
    ).toBe('CANCELLED');
    expect(
      resolveContractLogisticsStoStatus({
        contractImportStatus: 'Cancelled',
        dbStatus: 'CANCELLED',
        logisticsType: 'shipment',
      }),
    ).toBe('CANCELLED');
  });

  it('ignores sticky DB CANCELLED when SAP import is still Open', () => {
    expect(
      resolveContractLogisticsStoStatus({
        contractImportStatus: 'Open',
        dbStatus: 'CANCELLED',
        logisticsType: 'shipment',
        shipmentMilestones: {
          eta_arrival_at_loading_port: '2026-01-15',
        },
      }),
    ).toBe('PLANNED');
  });

  it('maps sticky CANCELLED + GR Close to COMPLETED', () => {
    expect(
      resolveContractLogisticsStoStatus({
        contractImportStatus: 'Close',
        dbStatus: 'CANCELLED',
        logisticsType: 'shipment',
      }),
    ).toBe('COMPLETED');
  });

  it('derives shipment status when contract is still open', () => {
    expect(
      resolveContractLogisticsStoStatus({
        contractImportStatus: 'Open',
        dbStatus: 'UNPLANNED',
        logisticsType: 'shipment',
        shipmentMilestones: {
          eta_arrival_at_loading_port: '2026-01-15',
        },
      }),
    ).toBe('PLANNED');
  });
});

describe('resolveSharedShipmentStoDelivered', () => {
  const shipment = 'ship-1';
  it('shows each STO of a shared shipment its own SAP delivery, not the shipment total (PO 1011003087)', () => {
    const rows = [
      { id: shipment, sto: '1016010835', quantity_delivered: 3_000_000, sap_delivered_kg: 3_000_000 },
      { id: shipment, sto: '1016010841', quantity_delivered: 3_000_000, sap_delivered_kg: 888_240 },
      { id: shipment, sto: '1016010845', quantity_delivered: 3_000_000, sap_delivered_kg: 157_850 },
    ];
    expect(resolveSharedShipmentStoDelivered(rows).map((r) => r.quantity_delivered)).toEqual([3_000_000, 888_240, 157_850]);
  });
  it('shows 0 for a STO of a shared shipment that SAP has nothing for', () => {
    const rows = [
      { id: shipment, quantity_delivered: 3_500_000, sap_delivered_kg: 0 },
      { id: shipment, quantity_delivered: 3_500_000, sap_delivered_kg: null },
    ];
    expect(resolveSharedShipmentStoDelivered(rows).map((r) => r.quantity_delivered)).toEqual([0, 0]);
  });
  it('leaves a shipment with a single STO, and a row without a shipment, as they are', () => {
    const rows = [
      { id: 'a', quantity_delivered: 1_000, sap_delivered_kg: 500 },
      { id: null, quantity_delivered: 2_000, sap_delivered_kg: 700 },
    ];
    expect(resolveSharedShipmentStoDelivered(rows)).toEqual(rows);
  });
});

describe('summarizeContractLogisticsStoQtyByType', () => {
  it('splits a two-leg cargo into its V and T totals (PO 1011003087)', () => {
    const stos = [
      { sto_number: '1016010835', sto_quantity: 3_000_000, sto_type: 'V' },
      { sto_number: '1016010841', sto_quantity: 900_000, sto_type: 'T' },
      { sto_number: '1016010842', sto_quantity: 650_000, sto_type: 'T' },
      { sto_number: '1016010843', sto_quantity: 650_000, sto_type: 't' },
      { sto_number: '1016010844', sto_quantity: 650_000, sto_type: 'T' },
      { sto_number: '1016010845', sto_quantity: 157_850, sto_type: 'T' },
    ];
    expect(summarizeContractLogisticsStoQtyByType(stos)).toEqual([
      { sto_type: 'V', sto_count: 1, total_sto_quantity: 3_000_000 },
      { sto_type: 'T', sto_count: 5, total_sto_quantity: 3_007_850 },
    ]);
  });
  it('counts a STO once, with its largest quantity, even when two rows carry it', () => {
    const stos = [
      { sto_number: '1', sto_quantity: 100, sto_type: 'V' },
      { sto_number: '1', sto_quantity: 120, sto_type: 'V' },
      { sto_number: '2', sto_quantity: 50, sto_type: 'T' },
    ];
    expect(summarizeContractLogisticsStoQtyByType(stos)).toEqual([
      { sto_type: 'V', sto_count: 1, total_sto_quantity: 120 },
      { sto_type: 'T', sto_count: 1, total_sto_quantity: 50 },
    ]);
  });
  it('returns nothing when there is one leg only, or no STO Type at all', () => {
    expect(summarizeContractLogisticsStoQtyByType([{ sto_number: '1', sto_quantity: 100, sto_type: 'V' }])).toEqual([]);
    expect(summarizeContractLogisticsStoQtyByType([{ sto_number: '1', sto_quantity: 100 }, { sto_number: '2', sto_quantity: 5, sto_type: 'X' }])).toEqual([]);
  });
  it('normalizes the type to V or T', () => {
    expect(normalizeContractLogisticsStoType(' v ')).toBe('V');
    expect(normalizeContractLogisticsStoType('M')).toBeNull();
    expect(normalizeContractLogisticsStoType(null)).toBeNull();
  });
});
