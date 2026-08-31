import { describe, expect, it } from 'vitest';
import {
  resolveContractLogisticsOperationId,
  resolveContractLogisticsStoNumber,
  resolveContractLogisticsStoStatus,
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
