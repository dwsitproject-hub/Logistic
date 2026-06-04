import { describe, expect, it } from 'vitest';
import {
  computeLateIndicatorText,
  isLegacyTradeCycleOnTime,
  isOpenConditionBOnTime,
  openDueDateTradeCycleDays,
} from './calendarDays';

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

describe('open drilldown Condition B (Open summary, empty standard ETA)', () => {
  const today = new Date(Date.UTC(2026, 5, 10));

  it('Trade Cycle = today − due date delivery end (calendar days)', () => {
    expect(openDueDateTradeCycleDays('2026-06-05', today)).toBe(5);
    expect(openDueDateTradeCycleDays('2026-06-15', today)).toBe(-5);
    expect(openDueDateTradeCycleDays('2026-06-10', today)).toBe(0);
  });

  it('On Time when today < due end (Trade Cycle < 0); Late when today >= due end', () => {
    expect(isOpenConditionBOnTime(-5)).toBe(true);
    expect(isOpenConditionBOnTime(0)).toBe(false);
    expect(isOpenConditionBOnTime(3)).toBe(false);
  });

  it('legacy Condition A keeps <= 0 as On Time', () => {
    expect(isLegacyTradeCycleOnTime(0)).toBe(true);
    expect(isLegacyTradeCycleOnTime(1)).toBe(false);
  });
});
