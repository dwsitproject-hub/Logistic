import { describe, expect, it, vi } from 'vitest';

// the service imports the DB pool at load time; the mapper under test never touches it
vi.mock('../database/connection', () => ({ query: vi.fn(), pool: {} }));

import { mapTruckingDailyActualForApi } from './truckingRealization.service';

describe('mapTruckingDailyActualForApi', () => {
  it('carries the weighbridge times to the API (they were dropped by hand-listed fields before)', () => {
    expect(
      mapTruckingDailyActualForApi({
        progress_date: '2026-09-01',
        quantity_kg: 40070,
        quantity_delivery_kg: 40070,
        quantity_receive_kg: 40160,
        sto_number: '',
        first_time_in: '04:40',
        last_time_out: '11:05',
      }),
    ).toMatchObject({
      date: '2026-09-01',
      progress_date: '2026-09-01',
      quantity_delivery_kg: 40070,
      quantity_receive_kg: 40160,
      first_time_in: '04:40',
      last_time_out: '11:05',
    });
  });

  it('returns null times for a row that has none, and keeps the legacy quantity fallback', () => {
    const row = mapTruckingDailyActualForApi({ progress_date: '2026-09-02', quantity_kg: 1000 });
    expect(row.first_time_in).toBeNull();
    expect(row.last_time_out).toBeNull();
    expect(row.quantity_delivery_kg).toBe(1000);
    expect(row.sto_number).toBe('');
  });
});
