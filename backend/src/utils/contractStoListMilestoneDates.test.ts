import { describe, expect, it } from 'vitest';
import { resolveStoListMilestoneDates } from './contractStoListMilestoneDates';

describe('resolveStoListMilestoneDates', () => {
  it('maps shipment to ETA/ETC/ATA/ATC at loading and discharge ports', () => {
    expect(
      resolveStoListMilestoneDates({
        type: 'shipment',
        eta_vessel_arrival_loading_port: '2026-04-01',
        eta_discharge_complete: '2026-04-10',
        ata_arrival_loading: '2026-04-02',
        ata_discharge_complete: '2026-04-11',
      }),
    ).toEqual({
      eta: '2026-04-01',
      etc: '2026-04-10',
      ata: '2026-04-02',
      atc: '2026-04-11',
    });
  });

  it('uses daily plan start/end for trucking ETA/ETC', () => {
    const dates = resolveStoListMilestoneDates({
      type: 'trucking',
      status: 'IN_PROGRESS',
      daily_plan_start_date: '2026-04-17',
      daily_plan_end_date: '2026-04-25',
      wb_start_date: '2026-04-18',
      wb_end_date: '2026-04-20',
    });
    expect(dates.eta).toBe('2026-04-17');
    expect(dates.etc).toBe('2026-04-25');
  });

  it('uses WB start/end for trucking ATA/ATC when operation is open', () => {
    expect(
      resolveStoListMilestoneDates({
        type: 'trucking',
        status: 'IN_PROGRESS',
        wb_start_date: '2026-04-18',
        wb_end_date: '2026-04-20',
        sap_trucking_start_receive_date: '2026-05-01',
        sap_trucking_last_receive_date: '2026-05-02',
      }),
    ).toEqual({
      eta: null,
      etc: null,
      ata: '2026-04-18',
      atc: '2026-04-20',
    });
  });

  it('returns empty ATA/ATC for cancelled trucking when WB and SAP dates are missing', () => {
    expect(
      resolveStoListMilestoneDates({
        type: 'trucking',
        status: 'CANCELLED',
      }),
    ).toEqual({
      eta: null,
      etc: null,
      ata: null,
      atc: null,
    });
  });

  it('uses SAP start/last receive for trucking ATA/ATC when Completed', () => {
    expect(
      resolveStoListMilestoneDates({
        type: 'trucking',
        status: 'COMPLETED',
        wb_start_date: '2026-04-18',
        wb_end_date: '2026-04-20',
        sap_trucking_start_receive_date: '2026-05-01',
        sap_trucking_last_receive_date: '2026-05-02',
      }),
    ).toEqual({
      eta: null,
      etc: null,
      ata: '2026-05-01',
      atc: '2026-05-02',
    });
  });
});
