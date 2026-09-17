import { describe, expect, it } from 'vitest';
import { mergeSapPortQuality, mergeSapPortValue } from './vesselLoadingPortsFromSap.service';

/**
 * The SAP sync fills gaps only. It must never overwrite a figure a user typed, but it must be able
 * to repair a quality reading that was stored as 0.00 from the wrong sibling STO
 * (STO 1016010973 sat at FFA 0.00 while SAP reported 4.841).
 */
describe('mergeSapPortValue (dates, quantities, rates)', () => {
  it('fills when nothing is stored', () => {
    expect(mergeSapPortValue(4.841, null)).toBe(4.841);
    expect(mergeSapPortValue('2026-07-08', undefined)).toBe('2026-07-08');
    expect(mergeSapPortValue(120, '')).toBe(120);
  });

  it('never overwrites a stored value', () => {
    expect(mergeSapPortValue(4.841, 3.2)).toBe(3.2);
    expect(mergeSapPortValue('2026-07-08', '2026-07-01')).toBe('2026-07-01');
  });

  it('treats a stored ZERO as a real entry — quantities may legitimately be 0', () => {
    expect(mergeSapPortValue(5000, 0)).toBe(0);
    expect(mergeSapPortValue(5000, '0')).toBe('0');
  });

  it('keeps the stored value when SAP has nothing', () => {
    expect(mergeSapPortValue(null, 3.2)).toBe(3.2);
    expect(mergeSapPortValue(undefined, null)).toBeNull();
  });
});

describe('mergeSapPortQuality (FFA, M&I, DOBI, RED, D&S, Stone)', () => {
  it('repairs a stored 0 — SAP writes absent readings as 0.000, so 0 means never populated', () => {
    expect(mergeSapPortQuality(4.841, 0)).toBe(4.841);
    expect(mergeSapPortQuality(0.371, '0.00')).toBe(0.371);
    expect(mergeSapPortQuality(4.841, null)).toBe(4.841);
  });

  it('never overwrites a real stored reading', () => {
    expect(mergeSapPortQuality(4.841, 3.9)).toBe(3.9);
  });

  it('does not wipe a stored reading when SAP itself has nothing', () => {
    expect(mergeSapPortQuality(null, 3.9)).toBe(3.9);
    expect(mergeSapPortQuality(undefined, 3.9)).toBe(3.9);
  });

  it('leaves 0 as 0 when SAP also reports 0', () => {
    // Both empty-ish: nothing to fill, and the row must not churn.
    expect(Number(mergeSapPortQuality(0, 0))).toBe(0);
  });

  it('reproduces the reported case end to end', () => {
    const stored = { quality_ffa: 0, quality_mi: 0, quantity_at_loading_port: 0 };
    const fromSap = { quality_ffa: 4.841, quality_mi: 0.371, quantity_at_loading_port: 12500 };
    expect(mergeSapPortQuality(fromSap.quality_ffa, stored.quality_ffa)).toBe(4.841);
    expect(mergeSapPortQuality(fromSap.quality_mi, stored.quality_mi)).toBe(0.371);
    // Quantity keeps the stored 0 — it could be a deliberate entry.
    expect(mergeSapPortValue(fromSap.quantity_at_loading_port, stored.quantity_at_loading_port)).toBe(0);
  });
});
