import { describe, expect, it } from 'vitest';
import {
  USER_ACTIVITY_IDLE_GAP_MS,
  computeActiveSecondsFromTimestamps,
  formatActiveDuration,
} from './userActivityTime';

describe('computeActiveSecondsFromTimestamps', () => {
  it('returns 0 for empty input', () => {
    expect(computeActiveSecondsFromTimestamps([])).toBe(0);
  });

  it('returns 60s for a single event', () => {
    expect(computeActiveSecondsFromTimestamps([new Date('2026-01-01T10:00:00Z')])).toBe(60);
  });

  it('sums gaps capped at idle threshold', () => {
    const t0 = new Date('2026-01-01T10:00:00Z');
    const t1 = new Date(t0.getTime() + 5 * 60 * 1000);
    const t2 = new Date(t0.getTime() + 20 * 60 * 1000);
    expect(computeActiveSecondsFromTimestamps([t0, t1, t2])).toBe(
      Math.round((5 * 60 * 1000 + USER_ACTIVITY_IDLE_GAP_MS + 60 * 1000) / 1000),
    );
  });
});

describe('formatActiveDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatActiveDuration(0)).toBe('0m');
    expect(formatActiveDuration(90)).toBe('1m');
    expect(formatActiveDuration(3660)).toBe('1h 1m');
  });
});
