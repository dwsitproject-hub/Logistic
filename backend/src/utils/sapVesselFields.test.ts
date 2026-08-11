import { describe, expect, it } from 'vitest';
import {
  hasCompleteSapVesselIdentity,
  resolveSapVesselIdentity,
  resolveShipmentDisplayVesselName,
  sqlShipmentDisplayVesselName,
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
  it('prefers master vessel name over SAP and KLIP', () => {
    expect(resolveShipmentDisplayVesselName('BG. ANDALAN 02', 'MV SAP', 'MV KLIP')).toBe(
      'BG. ANDALAN 02',
    );
  });

  it('falls back to SAP when master is missing', () => {
    expect(resolveShipmentDisplayVesselName(null, 'MV SAP', 'MV KLIP')).toBe('MV SAP');
  });

  it('falls back to KLIP stored name when master and SAP are missing', () => {
    expect(resolveShipmentDisplayVesselName(null, null, 'MV KLIP')).toBe('MV KLIP');
  });

  it('uses SAP when only SAP name is present', () => {
    expect(resolveShipmentDisplayVesselName('', 'MV ONLY SAP', '')).toBe('MV ONLY SAP');
  });

  it('canonicalizes SAP tug/barge compound to BG segment', () => {
    expect(
      resolveShipmentDisplayVesselName(
        'TB. AS MARINA 9 / BG. AS MARINA 12',
        'TB. AS MARINA 9 / BG. AS MARINA 12',
        'TB. AS MARINA 9 / BG. AS MARINA 12',
      ),
    ).toBe('BG. AS MARINA 12');
  });

  it('prefers clean master name over SAP compound', () => {
    expect(
      resolveShipmentDisplayVesselName(
        'BG. AS MARINA 12',
        'TB. AS MARINA 9 / BG. AS MARINA 12',
        null,
      ),
    ).toBe('BG. AS MARINA 12');
  });
});

describe('sqlShipmentDisplayVesselName', () => {
  it('builds COALESCE master, sap, klip SQL', () => {
    expect(sqlShipmentDisplayVesselName('mv.vessel_name', 'sa.vessel_name_sap', 's.vessel_name')).toContain(
      'mv.vessel_name',
    );
    expect(sqlShipmentDisplayVesselName('mv.vessel_name', 'sa.vessel_name_sap', 's.vessel_name')).toContain(
      'sa.vessel_name_sap',
    );
    expect(sqlShipmentDisplayVesselName('mv.vessel_name', 'sa.vessel_name_sap', 's.vessel_name')).toContain(
      's.vessel_name',
    );
  });
});
