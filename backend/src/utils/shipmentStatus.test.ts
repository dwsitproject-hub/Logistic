import { describe, expect, it } from 'vitest';
import { deriveShipmentStatus } from './shipmentStatus';

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

  it('returns UNPLANNED when no ETA, ATA, or closed contract', () => {
    expect(deriveShipmentStatus({})).toBe('UNPLANNED');
  });

  it('returns COMPLETED for SAP Close contract even with partial ATA or ETA', () => {
    expect(
      deriveShipmentStatus({
        contract_import_status: 'Close',
        ata_arrival_at_loading_port: '2026-01-01',
      }),
    ).toBe('COMPLETED');
    expect(
      deriveShipmentStatus({
        contract_import_status: 'CLOSED',
        eta_arrival_at_loading_port: '2026-02-01',
      }),
    ).toBe('COMPLETED');
  });
});
