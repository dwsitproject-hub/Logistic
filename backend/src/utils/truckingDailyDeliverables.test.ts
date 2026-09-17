import { describe, expect, it } from 'vitest';
import {
  mergeDailyDeliverablesRows,
  normalizeAndValidateDailyDeliverables,
  prepareAuthoritativePlanningMerge,
  sumDailyDeliverablesKg,
} from './truckingDailyDeliverables';

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

describe('prepareAuthoritativePlanningMerge', () => {
  it('drops stale planning outside upload and keeps only locked actuals + incoming', () => {
    const merged = prepareAuthoritativePlanningMerge(
      [
        { date: '2026-07-01', quantity_delivered: 250000 },
        { date: '2026-08-07', quantity_delivered: 60000 },
        { date: '2026-08-10', quantity_delivered: 45000 },
      ],
      [
        { date: '2026-08-07', quantity_delivered: 60000 },
        { date: '2026-08-10', quantity_delivered: 45000 },
        { date: '2026-08-12', quantity_delivered: 60000 },
      ],
      { lockedDates: new Set(['2026-07-01']) },
    );
    expect(merged).toEqual([
      { date: '2026-07-01', quantity_delivered: 250000 },
      { date: '2026-08-07', quantity_delivered: 60000 },
      { date: '2026-08-10', quantity_delivered: 45000 },
      { date: '2026-08-12', quantity_delivered: 60000 },
    ]);
    expect(sumDailyDeliverablesKg(merged)).toBe(415000);
  });

  it('matches file total when no locked actuals (drops all legacy planning)', () => {
    const merged = prepareAuthoritativePlanningMerge(
      [
        { date: '2026-07-01', quantity_delivered: 250000 },
        { date: '2026-08-07', quantity_delivered: 500000 },
      ],
      [
        { date: '2026-08-07', quantity_delivered: 250000 },
        { date: '2026-08-08', quantity_delivered: 250000 },
      ],
      { lockedDates: new Set() },
    );
    expect(sumDailyDeliverablesKg(merged)).toBe(500000);
  });

  it('honours clearDates after authoritative strip', () => {
    const merged = prepareAuthoritativePlanningMerge(
      [{ date: '2026-08-07', quantity_delivered: 500000 }],
      [],
      { lockedDates: new Set(), clearDates: ['2026-08-07'] },
    );
    expect(merged).toEqual([]);
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
