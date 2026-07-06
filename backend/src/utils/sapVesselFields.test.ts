import { describe, expect, it } from 'vitest';
import {
  hasCompleteSapVesselIdentity,
  resolveSapVesselIdentity,
  resolveShipmentDisplayVesselName,
} from './sapVesselFields';

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

describe('resolveShipmentDisplayVesselName', () => {
  it('prefers SAP vessel name over KLIP user input', () => {
    expect(resolveShipmentDisplayVesselName('MV SAP', 'MV KLIP')).toBe('MV SAP');
  });

  it('falls back to KLIP when SAP vessel name is null', () => {
    expect(resolveShipmentDisplayVesselName(null, 'MV KLIP')).toBe('MV KLIP');
  });

  it('uses SAP vessel name when only name is present (no code required for display)', () => {
    expect(resolveShipmentDisplayVesselName('MV ONLY SAP', '')).toBe('MV ONLY SAP');
  });
});
