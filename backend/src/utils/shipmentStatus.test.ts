import { describe, expect, it } from 'vitest';
import {
  deriveShipmentStatus,
  hasActualDate,
  isFutureDate,
  normalizeShipmentDetailStatus,
  pickDisplayedShipmentStatus,
  sqlShipmentStatusRank,
} from './shipmentStatus';

const dayOffset = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('an ATA Discharge Complete after today does not complete the shipment', () => {
  /*
   * An ATA is a time that already happened, so a future one is a data-entry mistake (2026-10-21, OP-1004032737-34122029).
   * The cell keeps showing it so it can be fixed; the status ignores it.
   */
  it('isFutureDate / hasActualDate compare calendar days, today included as actual', () => {
    expect(isFutureDate(dayOffset(1))).toBe(true);
    expect(isFutureDate(dayOffset(0))).toBe(false);
    expect(isFutureDate(dayOffset(-1))).toBe(false);
    expect(isFutureDate(null)).toBe(false);
    expect(isFutureDate('not a date')).toBe(false);
    expect(hasActualDate(dayOffset(0))).toBe(true);
    expect(hasActualDate(dayOffset(1))).toBe(false);
    expect(hasActualDate(null)).toBe(false);
    // DD/MM/YYYY (Indonesia templates) and Date instances
    expect(isFutureDate('01/01/2099')).toBe(true);
    expect(isFutureDate(new Date(2099, 0, 1))).toBe(true);
    expect(isFutureDate(new Date(2020, 0, 1))).toBe(false);
  });

  it('yesterday and today complete the shipment, tomorrow does not', () => {
    expect(deriveShipmentStatus({ ata_complete_discharge: dayOffset(-1) })).toBe('COMPLETED');
    expect(deriveShipmentStatus({ ata_complete_discharge: dayOffset(0) })).toBe('COMPLETED');
    expect(deriveShipmentStatus({ ata_complete_discharge: dayOffset(1) })).not.toBe('COMPLETED');
  });

  it('a future ATC falls back to the next rung of the ladder', () => {
    expect(
      deriveShipmentStatus({ ata_complete_discharge: dayOffset(3), ata_start_discharging: dayOffset(-1) }),
    ).toBe('UNLOADING');
    expect(
      deriveShipmentStatus({ ata_complete_discharge: dayOffset(3), ata_berthed_at_discharge_port: dayOffset(-1) }),
    ).toBe('BERTHED_DP');
    expect(deriveShipmentStatus({ ata_complete_discharge: dayOffset(3) })).toBe('PLANNED');
  });

  it('GR Close still completes the shipment whatever the ATC says', () => {
    expect(
      deriveShipmentStatus({ ata_complete_discharge: dayOffset(3), contract_import_status: 'Close' }),
    ).toBe('COMPLETED');
  });

  it('the modal does not keep a stored COMPLETED alive for a future ATC, but still never demotes otherwise', () => {
    const derived = deriveShipmentStatus({ ata_complete_discharge: dayOffset(3), ata_start_discharging: dayOffset(-1) });
    expect(pickDisplayedShipmentStatus('COMPLETED', derived, { futureAtc: true })).toBe('UNLOADING');
    // without the flag the stored status is kept, as before
    expect(pickDisplayedShipmentStatus('COMPLETED', derived)).toBe('COMPLETED');
    // GR Close: the ladder answers COMPLETED, so nothing changes
    const closed = deriveShipmentStatus({ ata_complete_discharge: dayOffset(3), contract_import_status: 'Close' });
    expect(pickDisplayedShipmentStatus('COMPLETED', closed, { futureAtc: true })).toBe('COMPLETED');
    // cancelled is never overridden
    expect(pickDisplayedShipmentStatus('CANCELLED', derived, { futureAtc: true })).toBe('CANCELLED');
  });
});

describe('deriveShipmentStatus', () => {
  /*
   * Changed deliberately 2026-09-14. ATC records that discharge finished, which is the end of the
   * voyage this status describes; waiting for SAP to close the transaction left the page reading
   * UNLOADING for days after the operators could see the vessel was done.
   */
  it('returns COMPLETED when ATA complete discharge exists, even with GR still Open', () => {
    expect(
      deriveShipmentStatus({
        ata_complete_discharge: '2026-01-15',
      }),
    ).toBe('COMPLETED');
  });

  it('still stops at UNLOADING when discharge started but did not finish', () => {
    expect(
      deriveShipmentStatus({
        ata_start_discharging: '2026-01-15',
      }),
    ).toBe('UNLOADING');
  });

  it('returns COMPLETED only for SAP GR Close, even without ATA', () => {
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
    expect(
      deriveShipmentStatus({
        ata_complete_discharge: '2026-01-09',
        contract_import_status: 'Open',
      }),
    ).toBe('COMPLETED');
    expect(
      deriveShipmentStatus({
        ata_complete_discharge: '2026-01-09',
        contract_import_status: 'Close',
      }),
    ).toBe('COMPLETED');
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
