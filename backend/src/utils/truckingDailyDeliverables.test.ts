import { describe, expect, it } from 'vitest';
import { mergeDailyDeliverablesRows, normalizeAndValidateDailyDeliverables } from './truckingDailyDeliverables';

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

  it('removes existing dates listed in clearDates', () => {
    const merged = mergeDailyDeliverablesRows(
      [
        { date: '2026-07-22', quantity_delivered: 125000 },
        { date: '2026-07-23', quantity_delivered: 50000 },
      ],
      [],
      { clearDates: ['2026-07-22'] },
    );
    expect(merged).toEqual([{ date: '2026-07-23', quantity_delivered: 50000 }]);
  });

  it('applies clear then set for the same date (set wins)', () => {
    const merged = mergeDailyDeliverablesRows(
      [{ date: '2026-07-22', quantity_delivered: 125000 }],
      [{ date: '2026-07-22', quantity_delivered: 10000 }],
      { clearDates: ['2026-07-22'] },
    );
    expect(merged).toEqual([{ date: '2026-07-22', quantity_delivered: 10000 }]);
  });
});

describe('normalizeAndValidateDailyDeliverables planning upload cap', () => {
  it('rejects kg planning when capped by SAP quantity_delivered stored in MT scale', () => {
    const daily = [{ date: '2026-07-01', quantity_delivered: 250000 }];
    const capped = normalizeAndValidateDailyDeliverables({
      daily_deliverables: daily,
      startRaw: '2026-06-01',
      endRaw: '2026-12-31',
      maxQtyRaw: 250,
    });
    expect(capped.ok).toBe(false);
    if (!capped.ok) {
      expect(capped.message).toContain('quantity cannot exceed');
    }
  });

  it('accepts kg planning when max cap is skipped after OS validation', () => {
    const daily = [{ date: '2026-07-01', quantity_delivered: 250000 }];
    const uncapped = normalizeAndValidateDailyDeliverables({
      daily_deliverables: daily,
      startRaw: '2026-06-01',
      endRaw: '2026-12-31',
      maxQtyRaw: null,
    });
    expect(uncapped.ok).toBe(true);
  });

  it('accepts kg planning when capped by outstanding qty in kg', () => {
    const daily = [{ date: '2026-07-01', quantity_delivered: 250000 }];
    const capped = normalizeAndValidateDailyDeliverables({
      daily_deliverables: daily,
      startRaw: '2026-06-01',
      endRaw: '2026-12-31',
      maxQtyRaw: 250000,
      maxQtyLabel: 'Outstanding Qty (kg)',
    });
    expect(capped.ok).toBe(true);
  });
});
