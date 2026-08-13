import { describe, expect, it } from 'vitest';
import {
  deriveShipmentStatus,
  normalizeShipmentDetailStatus,
  sqlShipmentStatusRank,
} from './shipmentStatus';

describe('deriveShipmentStatus', () => {
  it('returns COMPLETED when ATA complete discharge exists', () => {
    expect(
      deriveShipmentStatus({
        ata_complete_discharge: '2026-01-15',
      }),
    ).toBe('COMPLETED');
  });

  it('returns COMPLETED for SAP Close contract without ATA', () => {
    expect(
      deriveShipmentStatus({
        contract_import_status: 'Close',
      }),
    ).toBe('COMPLETED');
  });

  it('returns PLANNED when no ETA, ATA, delivery qty, or closed contract (STO open)', () => {
    expect(deriveShipmentStatus({})).toBe('PLANNED');
  });

  it('returns PLANNED when Delivery Qty present and all ATA are null', () => {
    expect(
      deriveShipmentStatus({
        quantity_delivered_sap: 1_000_000,
      }),
    ).toBe('PLANNED');
    expect(
      deriveShipmentStatus({
        quantity_delivered_klip: 500_000,
      }),
    ).toBe('PLANNED');
    expect(
      deriveShipmentStatus({
        quantity_delivered: 250_000,
      }),
    ).toBe('PLANNED');
  });

  it('keeps ATA tier when Delivery Qty exists', () => {
    expect(
      deriveShipmentStatus({
        quantity_delivered_sap: 1_000_000,
        ata_arrival_at_loading_port: '2026-01-01',
      }),
    ).toBe('ARRIVED_LP');
  });

  it('maps loading-port ATA tiers', () => {
    expect(
      deriveShipmentStatus({
        ata_arrival_at_loading_port: '2026-01-01',
      }),
    ).toBe('ARRIVED_LP');
    expect(
      deriveShipmentStatus({
        ata_arrival_at_loading_port: '2026-01-01',
        ata_berthed_at_loading_port: '2026-01-02',
      }),
    ).toBe('BERTHED_LP');
    expect(
      deriveShipmentStatus({
        ata_start_loading: '2026-01-03',
      }),
    ).toBe('LOADING');
    expect(
      deriveShipmentStatus({
        ata_completed_loading: '2026-01-04',
      }),
    ).toBe('COMPLETED_LOADING');
  });

  it('maps sailed and discharge-port ATA tiers', () => {
    expect(
      deriveShipmentStatus({
        ata_sailed_from_loading_port: '2026-01-05',
      }),
    ).toBe('SAILED');
    expect(
      deriveShipmentStatus({
        ata_arrive_at_discharge_port: '2026-01-06',
      }),
    ).toBe('ARRIVED_DP');
    expect(
      deriveShipmentStatus({
        ata_berthed_at_discharge_port: '2026-01-07',
      }),
    ).toBe('BERTHED_DP');
    expect(
      deriveShipmentStatus({
        ata_start_discharging: '2026-01-08',
      }),
    ).toBe('UNLOADING');
  });

  it('latest ATA milestone wins across phases', () => {
    expect(
      deriveShipmentStatus({
        ata_arrival_at_loading_port: '2026-01-01',
        ata_sailed_from_loading_port: '2026-01-05',
        ata_arrive_at_discharge_port: '2026-01-06',
      }),
    ).toBe('ARRIVED_DP');
  });
});

describe('normalizeShipmentDetailStatus', () => {
  it('maps legacy shipment status keys', () => {
    expect(normalizeShipmentDetailStatus('IN_PROGRESS')).toBe('ARRIVED_LP');
    expect(normalizeShipmentDetailStatus('IN_TRANSIT')).toBe('SAILED');
    expect(normalizeShipmentDetailStatus('ARRIVED')).toBe('ARRIVED_DP');
  });

  it('passes through granular statuses', () => {
    expect(normalizeShipmentDetailStatus('BERTHED_LP')).toBe('BERTHED_LP');
    expect(normalizeShipmentDetailStatus('COMPLETED_LOADING')).toBe('COMPLETED_LOADING');
    expect(normalizeShipmentDetailStatus('BERTHED_DP')).toBe('BERTHED_DP');
  });
});

describe('sqlShipmentStatusRank', () => {
  it('includes granular ATA ladder statuses for SAP merge', () => {
    const sql = sqlShipmentStatusRank('EXCLUDED.status');
    expect(sql).toContain('SAILED');
    expect(sql).toContain('ARRIVED_LP');
    expect(sql).toContain('BERTHED_DP');
  });
});
