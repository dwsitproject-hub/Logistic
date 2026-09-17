import { describe, expect, it } from 'vitest';
import {
  isOilLossEligibleIncotermMode,
  matchesOilLossTruckSegment,
  matchesOilLossVesselSegment,
} from './oilLossEligibility';

describe('oilLossEligibility transport segments', () => {
  it('allows vessel segment: FOB/CIF with SEA or MIX+STO V', () => {
    expect(matchesOilLossVesselSegment({ incoterm: 'CIF', transport_mode: 'SEA' })).toBe(true);
    expect(matchesOilLossVesselSegment({ incoterm: 'fob', transport_mode: 'sea' })).toBe(true);
    expect(matchesOilLossVesselSegment({ incoterm: 'FOB', transport_mode: 'Mixed', sto_type: 'V' })).toBe(true);
    expect(matchesOilLossVesselSegment({ incoterm: 'CIF', transport_mode: 'MIX', sto_type: 'v' })).toBe(true);
    expect(isOilLossEligibleIncotermMode('CIF', 'SEA')).toBe(true);
    expect(isOilLossEligibleIncotermMode('FOB', 'MIX', 'V')).toBe(true);
  });

  it('rejects vessel segment when MIX without STO V or wrong incoterm', () => {
    expect(matchesOilLossVesselSegment({ incoterm: 'FOB', transport_mode: 'MIX' })).toBe(false);
    expect(matchesOilLossVesselSegment({ incoterm: 'FOB', transport_mode: 'LAND', sto_type: 'V' })).toBe(false);
    expect(matchesOilLossVesselSegment({ incoterm: 'FRC', transport_mode: 'SEA' })).toBe(false);
    expect(isOilLossEligibleIncotermMode('FOB', 'LAND')).toBe(false);
    expect(isOilLossEligibleIncotermMode('CIF', 'MIX')).toBe(false);
  });

  it('allows truck segment: FRC/LCO with LAND only', () => {
    expect(matchesOilLossTruckSegment({ incoterm: 'FRC', transport_mode: 'LAND' })).toBe(true);
    expect(matchesOilLossTruckSegment({ incoterm: 'lco', transport_mode: 'land' })).toBe(true);
    expect(isOilLossEligibleIncotermMode('FRC', 'LAND')).toBe(true);
    expect(isOilLossEligibleIncotermMode('LCO', 'LAND')).toBe(true);
  });

  it('rejects truck segment for CIF, MIX, SEA, or STO T shortcuts', () => {
    expect(matchesOilLossTruckSegment({ incoterm: 'CIF', transport_mode: 'LAND' })).toBe(false);
    expect(matchesOilLossTruckSegment({ incoterm: 'FRC', transport_mode: 'MIX' })).toBe(false);
    expect(matchesOilLossTruckSegment({ incoterm: 'FRC', transport_mode: 'LAND', sto_type: 'T' })).toBe(true);
    expect(isOilLossEligibleIncotermMode('CIF', 'MIX')).toBe(false);
    // CIF + SEA is unconditionally vessel-eligible (sto_type only disambiguates MIX); STO
    // Type is irrelevant once transport_mode is unambiguous.
    expect(isOilLossEligibleIncotermMode('cif', 'SEA', 'T')).toBe(true);
    expect(isOilLossEligibleIncotermMode('FRC', 'SEA')).toBe(false);
  });

  it('excludes unknown incoterms', () => {
    expect(isOilLossEligibleIncotermMode('CFR', 'LAND')).toBe(false);
    expect(isOilLossEligibleIncotermMode('', 'LAND')).toBe(false);
  });
});
