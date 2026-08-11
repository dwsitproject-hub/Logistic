import { describe, expect, it } from 'vitest';
import {
  buildProvisionalVesselCode,
  displayVesselCode,
  isProvisionalVesselCode,
  resolveVesselCodeFromMaps,
} from './masterVesselCodeResolve';
import { normalizeVesselName, isMissingVesselCode } from './vesselNameNormalize';

describe('vesselNameNormalize', () => {
  it('normalizes BG/MT prefixes', () => {
    expect(normalizeVesselName('BG. ANDALAN 02')).toBe('ANDALAN 02');
    expect(normalizeVesselName('MT. GIAT ARMADA 02')).toBe('GIAT ARMADA 02');
  });

  it('treats #N/A as missing vessel code', () => {
    expect(isMissingVesselCode('#N/A')).toBe(true);
    expect(isMissingVesselCode('MANDALAN')).toBe(false);
  });
});

describe('masterVesselCodeResolve', () => {
  it('builds deterministic provisional codes', () => {
    expect(buildProvisionalVesselCode('ADAMAS 405')).toBe('TMP-ADAMAS405');
  });

  it('masks provisional codes for display', () => {
    expect(displayVesselCode({ vessel_code: 'TMP-ALRAI', code_status: 'PROVISIONAL' })).toBeNull();
    expect(displayVesselCode({ vessel_code: 'MANDALAN', code_status: 'OFFICIAL' })).toBe('MANDALAN');
  });

  it('resolves KLIP before SAP', () => {
    const klip = new Map([['ANDALAN 02', 'MANDALAN']]);
    const sap = new Map([['ANDALAN 02', 'MOTHER']]);
    const resolved = resolveVesselCodeFromMaps('BG. ANDALAN 02', '#N/A', klip, sap, new Map());
    expect(resolved.vessel_code).toBe('MANDALAN');
    expect(resolved.source).toBe('klip_sheet');
  });

  it('resolves SAP when not in KLIP', () => {
    const klip = new Map<string, string>();
    const sap = new Map([['ANAK LAUT 289', 'MLAUT289']]);
    const resolved = resolveVesselCodeFromMaps('BG. ANAK LAUT 289', '#N/A', klip, sap, new Map());
    expect(resolved.vessel_code).toBe('MLAUT289');
    expect(resolved.source).toBe('sap_import');
  });

  it('falls back to provisional code', () => {
    const resolved = resolveVesselCodeFromMaps('BG. ALRAI', '#N/A', new Map(), new Map(), new Map());
    expect(isProvisionalVesselCode(resolved.vessel_code)).toBe(true);
    expect(resolved.code_status).toBe('PROVISIONAL');
  });
});
