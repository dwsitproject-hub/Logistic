import { describe, expect, it } from 'vitest';
import {
  hasCompleteSapVesselIdentity,
  hasKlipVesselNameOverride,
  resolveSapVesselIdentity,
  resolveShipmentDisplayVesselName,
  sqlShipmentDisplayVesselName,
  sqlShipmentListDisplayVesselName,
  sqlLatestNonBlankAgg,
  parseContractSapClosedFlag,
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
  it('prefers master vessel name over SAP and KLIP when GR is closed', () => {
    expect(
      resolveShipmentDisplayVesselName('BG. ANDALAN 02', 'MV SAP', 'MV KLIP', {
        contractSapClosed: true,
      }),
    ).toBe('BG. ANDALAN 02');
  });

  it('prefers KLIP over master and SAP when contract is Open', () => {
    expect(
      resolveShipmentDisplayVesselName('BG. ANDALAN 02', 'MV SAP', 'VESSEL B', {
        contractSapClosed: false,
      }),
    ).toBe('VESSEL B');
  });

  it('falls back to SAP when Open and KLIP is empty', () => {
    expect(resolveShipmentDisplayVesselName(null, 'MV SAP', '', { contractSapClosed: false })).toBe(
      'MV SAP',
    );
  });

  it('prefers SAP over master when Open and KLIP is empty', () => {
    expect(
      resolveShipmentDisplayVesselName('BG. ANDALAN 02', 'MV SAP', '', {
        contractSapClosed: false,
      }),
    ).toBe('MV SAP');
  });

  it('falls back to SAP when master is missing and GR is closed', () => {
    expect(
      resolveShipmentDisplayVesselName(null, 'MV SAP', 'MV KLIP', { contractSapClosed: true }),
    ).toBe('MV SAP');
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

describe('hasKlipVesselNameOverride', () => {
  it('is true when KLIP name differs from SAP', () => {
    expect(hasKlipVesselNameOverride('VESSEL B', 'VESSEL A')).toBe(true);
  });

  it('is false when KLIP is empty or matches SAP', () => {
    expect(hasKlipVesselNameOverride('', 'VESSEL A')).toBe(false);
    expect(hasKlipVesselNameOverride('VESSEL A', 'VESSEL A')).toBe(false);
  });
});

describe('sqlShipmentListDisplayVesselName', () => {
  it('prefers KLIP when Open and KLIP is filled', () => {
    const sql = sqlShipmentListDisplayVesselName(
      'mv.vessel_name',
      'sa.vessel_name_sap',
      's.vessel_name',
      's.is_contract_sap_closed',
    );
    expect(sql).toContain('s.is_contract_sap_closed');
    expect(sql).toContain('s.vessel_name');
    expect(sql).toContain('IS NOT TRUE');
  });
});

describe('sqlLatestNonBlankAgg', () => {
  it('orders by updated_at so a later KLIP edit wins over MAX()', () => {
    const sql = sqlLatestNonBlankAgg('s.vessel_name');
    expect(sql).toContain('ARRAY_AGG(s.vessel_name ORDER BY s.updated_at DESC');
    expect(sql).toContain('NULLIF(TRIM((s.vessel_name)::text), \'\') IS NOT NULL');
  });
});

describe('parseContractSapClosedFlag', () => {
  it('does not treat the string false as closed', () => {
    expect(parseContractSapClosedFlag('false')).toBe(false);
    expect(parseContractSapClosedFlag('f')).toBe(false);
    expect(parseContractSapClosedFlag(false)).toBe(false);
    expect(parseContractSapClosedFlag(true)).toBe(true);
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
