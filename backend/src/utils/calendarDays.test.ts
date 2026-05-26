import { describe, expect, it } from 'vitest';
import { computeLateIndicatorText } from './calendarDays';

describe('computeLateIndicatorText', () => {
  it('returns On Time when displayed ETA is before delivery end', () => {
    expect(
      computeLateIndicatorText('2026-05-31', null, '2026-05-20'),
    ).toBe('On Time');
  });

  it('returns Late when displayed ETA is after delivery end', () => {
    expect(
      computeLateIndicatorText('2026-05-31', null, '2026-06-05'),
    ).toBe('Late');
  });

  it('prefers actual completion over ETA', () => {
    expect(
      computeLateIndicatorText('2026-05-31', '2026-06-01', '2026-05-20'),
    ).toBe('Late');
    expect(
      computeLateIndicatorText('2026-05-31', '2026-05-20', '2026-06-01'),
    ).toBe('On Time');
  });

  it('treats same calendar day as On Time', () => {
    expect(
      computeLateIndicatorText('2026-05-31', null, '2026-05-31'),
    ).toBe('On Time');
  });
});
