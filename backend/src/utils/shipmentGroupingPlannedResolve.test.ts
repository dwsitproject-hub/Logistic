import { describe, expect, it } from 'vitest';
import { matchMasterVesselForPlanning, type MasterVesselForPlanning } from './shipmentGroupingPlannedResolve';

const vessels: MasterVesselForPlanning[] = [
  {
    vesselName: 'GIAT ARMADA 02',
    vesselCode: 'V001',
    vesselOwner: 'Owner',
    vesselCapacityMt: 3000,
    vesselHullType: 'TANKER',
    charterType: 'T/C',
  },
  {
    vesselName: 'NO TERMS SHIP',
    vesselCode: 'V002',
    vesselOwner: null,
    vesselCapacityMt: null,
    vesselHullType: null,
    charterType: '',
  },
];

describe('matchMasterVesselForPlanning', () => {
  it('matches by normalized name and by code', () => {
    expect(matchMasterVesselForPlanning(vessels, 'MT. GIAT ARMADA 02')?.vesselName).toBe('GIAT ARMADA 02');
    expect(matchMasterVesselForPlanning(vessels, 'V001')?.vesselName).toBe('GIAT ARMADA 02');
  });

  it('returns the row even when Terms are missing so caller can reject', () => {
    const hit = matchMasterVesselForPlanning(vessels, 'NO TERMS SHIP');
    expect(hit?.charterType).toBe('');
  });

  it('returns null when the vessel is unknown', () => {
    expect(matchMasterVesselForPlanning(vessels, 'UNKNOWN')).toBeNull();
  });
});
