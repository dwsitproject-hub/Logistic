import { describe, expect, it } from 'vitest';
import { isOilLossEligibleIncotermMode } from './oilLossEligibility';

describe('oilLossEligibility transport segments', () => {
  it('allows vessel segment: CIF/FOB with SEA, MIX, or STO V', () => {
    expect(isOilLossEligibleIncotermMode('CIF', 'SEA')).toBe(true);
    expect(isOilLossEligibleIncotermMode('FOB', 'MIX')).toBe(true);
    expect(isOilLossEligibleIncotermMode('fob', 'LAND', 'V')).toBe(true);
    expect(isOilLossEligibleIncotermMode('CIF', 'LAND')).toBe(true);
    expect(isOilLossEligibleIncotermMode('FOB', 'LAND')).toBe(false);
  });

  it('allows truck segment: FRC/CIF with LAND, MIX, or STO T', () => {
    expect(isOilLossEligibleIncotermMode('FRC', 'LAND')).toBe(true);
    expect(isOilLossEligibleIncotermMode('CIF', 'MIX')).toBe(true);
    expect(isOilLossEligibleIncotermMode('cif', 'SEA', 'T')).toBe(true);
    expect(isOilLossEligibleIncotermMode('FRC', 'SEA')).toBe(false);
  });

  it('excludes LCO, FOB+LAND-only, FRC+SEA-only, and unknown incoterms', () => {
    expect(isOilLossEligibleIncotermMode('LCO', 'SEA')).toBe(false);
    expect(isOilLossEligibleIncotermMode('CFR', 'LAND')).toBe(false);
    expect(isOilLossEligibleIncotermMode('', 'LAND')).toBe(false);
  });
});
