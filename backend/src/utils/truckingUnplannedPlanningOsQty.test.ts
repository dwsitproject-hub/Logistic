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

  it('rejects total planning less than outstanding qty', () => {
    const result = validatePlanningTotalAgainstOutstandingKg(100000, 125000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failureKind).toBe('less');
      expect(result.reason).toContain('less than Outstanding Qty');
      expect(result.reason).toContain('kg');
    }
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
