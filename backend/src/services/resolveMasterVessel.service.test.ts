import { describe, expect, it } from 'vitest';
import { normalizeVesselName } from '../utils/vesselNameNormalize';
import { buildProvisionalVesselCode, isProvisionalVesselCode } from '../utils/masterVesselCodeResolve';

describe('resolveMasterVessel helpers', () => {
  it('normalizes LUMINOR 9 variants to same key', () => {
    expect(normalizeVesselName('BG. LUMINOR 9')).toBe('LUMINOR 9');
    expect(normalizeVesselName('Luminor 9')).toBe('LUMINOR 9');
  });

  it('normalizes LUMINOR 8 variants to same key', () => {
    expect(normalizeVesselName('BG. LUMINOR 8')).toBe('LUMINOR 8');
    expect(normalizeVesselName('Luminor 8')).toBe('LUMINOR 8');
  });

  it('builds provisional code for unknown vessels', () => {
    const code = buildProvisionalVesselCode('LUMINOR 9');
    expect(isProvisionalVesselCode(code)).toBe(true);
  });
});

describe('masterVesselCanonicalSql', () => {
  it('exports shipment resolve expression', async () => {
    const { sqlResolveMasterVesselIdFromShipment, sqlVesselCanonicalShipmentMatch } = await import(
      '../utils/masterVesselCanonicalSql'
    );
    expect(sqlResolveMasterVesselIdFromShipment('s')).toContain('master_vessel_code_aliases');
    expect(sqlVesselCanonicalShipmentMatch('mv', 's')).toContain('normalized_vessel_name');
  });
});
