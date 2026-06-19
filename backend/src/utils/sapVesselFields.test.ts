import { describe, expect, it } from 'vitest';
import { hasCompleteSapVesselIdentity, resolveSapVesselIdentity } from './sapVesselFields';

describe('resolveSapVesselIdentity', () => {
  it('reads vessel code and name from shipment and raw fallbacks', () => {
    const identity = resolveSapVesselIdentity(
      { vessel_name: 'MV ALPHA' },
      {},
      { 'Vessel Code': 'V001' },
    );
    expect(identity.vessel_name).toBe('MV ALPHA');
    expect(identity.vessel_code).toBe('V001');
    expect(hasCompleteSapVesselIdentity(identity)).toBe(true);
  });

  it('returns incomplete identity when either field is missing', () => {
    const identity = resolveSapVesselIdentity({}, {}, { 'Vessel Name': 'MV BETA' });
    expect(hasCompleteSapVesselIdentity(identity)).toBe(false);
  });
});
