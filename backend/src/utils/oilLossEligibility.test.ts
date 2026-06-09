import { describe, expect, it } from 'vitest';
import { isOilLossEligibleIncotermMode } from './oilLossEligibility';

describe('isOilLossEligibleIncotermMode', () => {
  it('allows CIF with LAND or MIX only', () => {
    expect(isOilLossEligibleIncotermMode('CIF', 'LAND')).toBe(true);
    expect(isOilLossEligibleIncotermMode('cif', 'mix')).toBe(true);
    expect(isOilLossEligibleIncotermMode('CIF', 'SEA')).toBe(false);
  });

  it('allows FOB with SEA, LAND, or MIX', () => {
    expect(isOilLossEligibleIncotermMode('FOB', 'SEA')).toBe(true);
    expect(isOilLossEligibleIncotermMode('fob', 'land')).toBe(true);
    expect(isOilLossEligibleIncotermMode('FOB', 'MIX')).toBe(true);
  });

  it('allows LCO with SEA, LAND, or MIX', () => {
    expect(isOilLossEligibleIncotermMode('LCO', 'SEA')).toBe(true);
    expect(isOilLossEligibleIncotermMode('LCO', 'LAND')).toBe(true);
    expect(isOilLossEligibleIncotermMode('lco', 'mix')).toBe(true);
  });

  it('rejects other incoterms and empty values', () => {
    expect(isOilLossEligibleIncotermMode('CFR', 'SEA')).toBe(false);
    expect(isOilLossEligibleIncotermMode('', 'LAND')).toBe(false);
    expect(isOilLossEligibleIncotermMode('CIF', '')).toBe(true);
  });
});
