import { describe, expect, it } from 'vitest';
import { mergeDailyDeliverablesRows } from './truckingDailyDeliverables';

describe('mergeDailyDeliverablesRows', () => {
  it('preserves existing dates and overrides matching dates from upload', () => {
    const merged = mergeDailyDeliverablesRows(
      [
        { date: '2026-06-01', quantity_delivered: 1000 },
        { date: '2026-06-02', quantity_delivered: 2000 },
      ],
      [{ date: '2026-06-02', quantity_delivered: 2500 }],
    );
    expect(merged).toEqual([
      { date: '2026-06-01', quantity_delivered: 1000 },
      { date: '2026-06-02', quantity_delivered: 2500 },
    ]);
  });
});
