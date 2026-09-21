import { describe, expect, it } from 'vitest';
import { parseFlexibleIsoDate } from './parseFlexibleIsoDate';

describe('parseFlexibleIsoDate', () => {
  it('returns null for empty values', () => {
    expect(parseFlexibleIsoDate(null)).toBeNull();
    expect(parseFlexibleIsoDate('')).toBeNull();
    expect(parseFlexibleIsoDate('   ')).toBeNull();
  });

  it('keeps ISO and Date objects', () => {
    expect(parseFlexibleIsoDate('2026-02-23')).toBe('2026-02-23');
    expect(parseFlexibleIsoDate(new Date(2026, 1, 23))).toBe('2026-02-23');
  });

  it('parses day-first Excel / SAP strings', () => {
    expect(parseFlexibleIsoDate('23.02.2026')).toBe('2026-02-23');
    expect(parseFlexibleIsoDate('23/02/2026')).toBe('2026-02-23');
    expect(parseFlexibleIsoDate('23-02-2026')).toBe('2026-02-23');
    expect(parseFlexibleIsoDate('20260223')).toBe('2026-02-23');
    expect(parseFlexibleIsoDate(20260223)).toBe('2026-02-23');
  });

  it('parses Excel serial days', () => {
    // 45321 = 2024-01-30 (Excel epoch 1899-12-30)
    expect(parseFlexibleIsoDate(45321)).toBe('2024-01-30');
    expect(parseFlexibleIsoDate('45321')).toBe('2024-01-30');
    expect(parseFlexibleIsoDate(12)).toBeNull();
  });

  it('rejects impossible calendar dates', () => {
    expect(parseFlexibleIsoDate('31.02.2026')).toBeNull();
    expect(parseFlexibleIsoDate('2026-13-01')).toBeNull();
  });
});
