import { describe, expect, it } from 'vitest';
import { fromDhmVesselData, companyCatalogExtra, externalPartyCatalogExtra, matchDhmFieldKey, toDhmCatalogPayload, toDhmNamePayload, toDhmVesselPayload } from './mapper';

describe('dhm vessel mapper', () => {
  it('maps KLIP fields to hub keys and omits local-only columns', () => {
    const payload = toDhmVesselPayload({
      vessel_code: 'MBGPSIV',
      vessel_name: 'MARINA BAY III',
      vessel_capacity_mt: 5000,
      heating: true,
      vessel_type: 'TANKER',
      lambung_type: 'DHDB',
      terms: 'V/C',
    });

    expect(payload).toEqual({
      Vessel_Name: 'MARINA BAY III',
      Vessel_Code_SAP: 'MBGPSIV',
      Vessel_Capacity_MT: 5000,
      Heater: true,
      Vessel_Type: 'tanker',
      Type_lambung: 'Double hull Double Bottom',
      Type_Charter: 'Voyage Charter',
    });
    expect(payload).not.toHaveProperty('vessel_owner');
    expect(payload).not.toHaveProperty('code');
  });

  it('includes DHM code only on PUT', () => {
    const payload = toDhmVesselPayload({ vessel_name: 'ALPHA' }, { code: 'VSL-0001' });
    expect(payload.code).toBe('VSL-0001');
    expect(payload.Vessel_Name).toBe('ALPHA');
  });

  it('maps hub data back to KLIP enums', () => {
    const mapped = fromDhmVesselData({
      code: 'VSL-0001',
      Vessel_Name: 'MARINA BAY III',
      Vessel_Code_SAP: 'MBGPSIV',
      Vessel_Capacity_MT: 5000,
      Heater: false,
      Vessel_Type: 'barge',
      Type_lambung: 'Single hull Double Bottom',
      Type_Charter: 'Time Charter',
    });
    expect(mapped).toEqual({
      dhm_code: 'VSL-0001',
      vessel_name: 'MARINA BAY III',
      vessel_code_sap: 'MBGPSIV',
      vessel_capacity_mt: 5000,
      heating: false,
      vessel_type: 'BARGE',
      lambung_type: 'SHDB',
      terms: 'T/C',
    });
  });
});

describe('dhm name mapper', () => {
  it('sends name only and never a KLIP code', () => {
    expect(toDhmNamePayload('CPO')).toEqual({ name: 'CPO' });
    expect(toDhmNamePayload('CPO')).not.toHaveProperty('code');
    expect(toDhmNamePayload('CPO')).not.toHaveProperty('code_klip');
  });

  it('adds the DHM code on update and a parent reference when present', () => {
    expect(toDhmNamePayload('PORT BATAM', { code: 'PORT-0001', extra: { site_id: 'SITE-0004' } })).toEqual({
      name: 'PORT BATAM',
      code: 'PORT-0001',
      site_id: 'SITE-0004',
    });
  });

  it('fills commodity short and long names and drops keys the catalog does not list', () => {
    const built = toDhmCatalogPayload(
      {
        fields: [
          { key: 'code', systemGenerated: true },
          { key: 'name', required: true },
          { key: 'short_name' },
          { key: 'long_name' },
          { key: 'type' },
        ],
      },
      { name: 'CPKO', code_klip: 'KPRD-0001' },
    );
    expect(built.missing).toEqual([]);
    expect(built.payload).toEqual({ name: 'CPKO', short_name: 'CPKO', long_name: 'CPKO' });
  });

  it('uses company_id when that is the site parent field', () => {
    const built = toDhmCatalogPayload(
      {
        fields: [
          { key: 'code', systemGenerated: true },
          { key: 'name', required: true },
          { key: 'company_id', required: true },
        ],
      },
      { name: 'PORT BATAM', company_id: 'ORG-0001', organization_id: 'ORG-0001' },
      { code: 'SITE-0004' },
    );
    expect(built.payload).toEqual({ name: 'PORT BATAM', company_id: 'ORG-0001', code: 'SITE-0004' });
  });

  it('sends external party group and Vendor type on the catalog fields', () => {
    const extra = externalPartyCatalogExtra(
      {
        fields: [
          { key: 'code', systemGenerated: true },
          { key: 'name', required: true },
          { key: 'Group' },
          { key: 'Type' },
        ],
      },
      'ADR',
    );
    expect(extra).toEqual({ Group: 'ADR', Type: 'Vendor' });
  });

  it('sends company SAP code as short name and linked site codes as sites', () => {
    const extra = companyCatalogExtra(
      {
        fields: [
          { key: 'code', systemGenerated: true },
          { key: 'name', required: true },
          { key: 'short_name' },
          { key: 'sites' },
        ],
      },
      'EU',
      ['SITE-BONTANG', 'SITE-BATAM'],
    );
    expect(extra).toEqual({ short_name: 'EU', sites: ['SITE-BONTANG', 'SITE-BATAM'] });
  });

  it('matches plant catalog fields by meaning', () => {
    const entity = {
      fields: [
        { key: 'code', systemGenerated: true },
        { key: 'Plant_Code_SAP' },
        { key: 'Plant_Name' },
        { key: 'Plant_Type' },
        { key: 'site_id' },
      ],
    };
    expect(matchDhmFieldKey(entity, [(key) => key.includes('sap') && key.includes('code')])).toBe('Plant_Code_SAP');
    expect(matchDhmFieldKey(entity, [(key) => key === 'plantname'])).toBe('Plant_Name');
    expect(matchDhmFieldKey(entity, [(key) => key === 'planttype'])).toBe('Plant_Type');
  });
});
