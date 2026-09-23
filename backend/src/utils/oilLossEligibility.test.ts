import { describe, expect, it } from 'vitest';
import {
  isOilLossEligibleIncotermMode,
  matchesOilLossTruckSegment,
  matchesOilLossVesselSegment,
} from './oilLossEligibility';

describe('oilLossEligibility incoterm segments', () => {
  it('allows vessel segment from incoterm alone: CIF, FOB, CFR', () => {
    expect(matchesOilLossVesselSegment({ incoterm: 'CIF' })).toBe(true);
    expect(matchesOilLossVesselSegment({ incoterm: 'fob', transport_mode: 'LAND' })).toBe(true);
    expect(matchesOilLossVesselSegment({ incoterm: 'CFR', transport_mode: 'MIX', sto_type: 'T' })).toBe(true);
    expect(isOilLossEligibleIncotermMode('CIF', 'LAND')).toBe(true);
    expect(isOilLossEligibleIncotermMode('CFR')).toBe(true);
  });

  it('rejects vessel segment for trucking and unknown incoterms', () => {
    expect(matchesOilLossVesselSegment({ incoterm: 'FRC', transport_mode: 'SEA' })).toBe(false);
    expect(matchesOilLossVesselSegment({ incoterm: 'LCO' })).toBe(false);
    expect(isOilLossEligibleIncotermMode('FOR', 'SEA')).toBe(false);
    expect(isOilLossEligibleIncotermMode('')).toBe(false);
  });

  it('allows truck segment from incoterm alone: FRC, LCO', () => {
    expect(matchesOilLossTruckSegment({ incoterm: 'FRC', transport_mode: 'SEA' })).toBe(true);
    expect(matchesOilLossTruckSegment({ incoterm: 'lco', transport_mode: 'MIX' })).toBe(true);
    expect(isOilLossEligibleIncotermMode('FRC', 'SEA')).toBe(true);
    expect(isOilLossEligibleIncotermMode('LCO')).toBe(true);
  });

  it('rejects truck segment for vessel incoterms', () => {
    expect(matchesOilLossTruckSegment({ incoterm: 'CIF', transport_mode: 'LAND' })).toBe(false);
    expect(matchesOilLossTruckSegment({ incoterm: 'CFR' })).toBe(false);
    expect(isOilLossEligibleIncotermMode('FOB', 'LAND')).toBe(true);
  });
});
