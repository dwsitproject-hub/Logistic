import { describe, expect, it } from 'vitest';
import { toActivityDateOnly } from './userActivityDate';

describe('toActivityDateOnly', () => {
  it('formats Date objects as YYYY-MM-DD in UTC', () => {
    expect(toActivityDateOnly(new Date('2026-07-02T00:00:00.000Z'))).toBe('2026-07-02');
  });

  it('keeps ISO date strings', () => {
    expect(toActivityDateOnly('2026-07-02')).toBe('2026-07-02');
    expect(toActivityDateOnly('2026-07-02T00:00:00.000Z')).toBe('2026-07-02');
  });

  it('rejects unparseable date fragments', () => {
    expect(toActivityDateOnly('not-a-date')).toBe('');
  });
});
