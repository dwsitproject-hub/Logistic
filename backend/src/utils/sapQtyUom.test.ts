import { describe, expect, it } from 'vitest';
import {
  isMetricTonUom,
  normalizeSapQtyToKg,
  normalizeSapUom,
  sqlNormalizeSapQtyToKgWithUom,
} from './sapQtyUom';

describe('sapQtyUom', () => {
  it('normalizes UOM strings', () => {
    expect(normalizeSapUom(' kg ')).toBe('KG');
    expect(normalizeSapUom('')).toBeNull();
    expect(normalizeSapUom(null)).toBeNull();
  });

  it('detects metric-ton UOMs', () => {
    expect(isMetricTonUom('MT')).toBe(true);
    expect(isMetricTonUom('to')).toBe(true);
    expect(isMetricTonUom('TON')).toBe(true);
    expect(isMetricTonUom('KG')).toBe(false);
    expect(isMetricTonUom('')).toBe(false);
    expect(isMetricTonUom(null)).toBe(false);
  });

  it('keeps KG/blank quantities as kg', () => {
    expect(normalizeSapQtyToKg(1000, 'KG')).toBe(1000);
    expect(normalizeSapQtyToKg(1000, '')).toBe(1000);
    expect(normalizeSapQtyToKg(1000, null)).toBe(1000);
  });

  it('converts MT quantities to kg once (no double conversion)', () => {
    expect(normalizeSapQtyToKg(1000, 'MT')).toBe(1_000_000);
    expect(normalizeSapQtyToKg(1, 'MT')).toBe(1000);
  });

  it('builds SQL that prefers explicit UOM over heuristic', () => {
    const sql = sqlNormalizeSapQtyToKgWithUom('q.val', `spd.data->'contract'->>'contract_qty_uom'`);
    expect(sql).toContain(`IN ('MT', 'TO', 'TON', 'TONS', 'T')`);
    expect(sql).toContain('* 1000');
    expect(sql).toContain(`/ 10.0`);
  });
});
