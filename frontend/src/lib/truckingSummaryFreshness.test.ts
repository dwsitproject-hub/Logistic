import { describe, expect, it } from 'vitest';
import {
  describeTruckingSummaryFreshness,
  formatTruckingSummaryAsOf,
} from './truckingSummaryFreshness';

/**
 * The point of this note is that a viewer can tell a precomputed quantity from a live one. So the
 * cases that matter are: say nothing when it is live, say when it is not, and say something
 * different while a rebuild is pending.
 */
describe('describeTruckingSummaryFreshness', () => {
  it('says nothing when the figures were computed live', () => {
    expect(describeTruckingSummaryFreshness({ source: 'live', asOf: null })).toBeNull();
    expect(describeTruckingSummaryFreshness(null)).toBeNull();
    expect(describeTruckingSummaryFreshness(undefined)).toBeNull();
    // Absent source is treated as live: only an explicit snapshot claim earns a badge.
    expect(describeTruckingSummaryFreshness({ asOf: '2026-09-10T07:21:44Z' })).toBeNull();
  });

  it('reports the as-of time when the figures are precomputed', () => {
    const note = describeTruckingSummaryFreshness({
      source: 'snapshot',
      asOf: '2026-09-10T07:21:44.143Z',
      isStale: false,
    });
    expect(note).not.toBeNull();
    expect(note!.tone).toBe('info');
    expect(note!.label).toContain('as of');
    // The detail has to say the table below is still live, or the note reads worse than it is.
    expect(note!.detail).toContain('live');
  });

  it('marks a pending rebuild differently, because that is a stronger caveat', () => {
    const note = describeTruckingSummaryFreshness({
      source: 'snapshot',
      asOf: '2026-09-10T07:21:44.143Z',
      isStale: true,
    });
    expect(note!.tone).toBe('pending');
    expect(note!.detail).toContain('rebuild');
  });

  it('still says something useful when the timestamp is missing or unparseable', () => {
    for (const asOf of [null, undefined, '', 'not-a-date']) {
      const note = describeTruckingSummaryFreshness({ source: 'snapshot', asOf, isStale: false });
      expect(note!.label).toBe('Quantities as of the last scheduled refresh');
    }
  });

  it('formats to the minute and rejects junk', () => {
    expect(formatTruckingSummaryAsOf('not-a-date')).toBeNull();
    expect(formatTruckingSummaryAsOf(null)).toBeNull();
    expect(formatTruckingSummaryAsOf('2026-09-10T07:21:44.143Z')).not.toBeNull();
  });
});
