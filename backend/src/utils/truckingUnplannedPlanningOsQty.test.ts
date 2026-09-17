import { describe, expect, it } from 'vitest';
import {
  sumPlanningEntriesKg,
  validatePlanningTotalAgainstOutstandingKg,
} from './truckingUnplannedPlanningOsQty';

describe('truckingUnplannedPlanningOsQty', () => {
  it('sums planning entries in kg', () => {
    expect(sumPlanningEntriesKg([{ qtyMt: 10000 }, { qtyMt: 2500 }])).toBe(12500);
  });

  it('accepts total planning equal to outstanding qty within kg tolerance', () => {
    expect(
      validatePlanningTotalAgainstOutstandingKg(125000, 125000),
    ).toEqual({ ok: true });
    expect(
      validatePlanningTotalAgainstOutstandingKg(125000.005, 125000),
    ).toEqual({ ok: true });
  });

  it('accepts sub-MT rounding within 1 MT tolerance', () => {
    expect(validatePlanningTotalAgainstOutstandingKg(439000, 439020)).toEqual({ ok: true });
    expect(validatePlanningTotalAgainstOutstandingKg(29000, 29010)).toEqual({ ok: true });
  });

  it('accepts whole-MT template vs decimal OS within 1 MT tolerance', () => {
    expect(validatePlanningTotalAgainstOutstandingKg(439000, 438000)).toEqual({ ok: true });
    expect(validatePlanningTotalAgainstOutstandingKg(439000, 440000)).toEqual({ ok: true });
  });

  it('rejects planning vs OS when difference exceeds 1 MT', () => {
    expect(validatePlanningTotalAgainstOutstandingKg(439000, 437000).ok).toBe(false);
    expect(validatePlanningTotalAgainstOutstandingKg(439000, 441000).ok).toBe(false);
  });

  it('rejects total planning less than outstanding qty', () => {
    const result = validatePlanningTotalAgainstOutstandingKg(100000, 125000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failureKind).toBe('less');
      expect(result.reason).toContain('less than Outstanding Qty');
      expect(result.reason).toContain('MT');
    }
  });

  it('allows total planning less than outstanding when allowLess is set (clear upload)', () => {
    expect(
      validatePlanningTotalAgainstOutstandingKg(100000, 125000, { allowLess: true }),
    ).toEqual({ ok: true });
  });

  it('still rejects over-planning when allowLess is set', () => {
    const result = validatePlanningTotalAgainstOutstandingKg(130000, 125000, { allowLess: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failureKind).toBe('greater');
    }
  });

  it('ignores null qty entries when summing (clear candidates)', () => {
    expect(sumPlanningEntriesKg([{ qtyMt: 10000 }, { qtyMt: null }, { qtyMt: 2500 }])).toBe(12500);
  });

  it('rejects total planning greater than outstanding qty', () => {
    const result = validatePlanningTotalAgainstOutstandingKg(130000, 125000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failureKind).toBe('greater');
      expect(result.reason).toContain('exceeds Outstanding Qty');
    }
  });
});
