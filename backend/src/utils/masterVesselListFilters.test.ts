import { describe, expect, it } from 'vitest';
import {
  buildMasterVesselListWhere,
  buildMasterVesselOrderBy,
  parseMasterVesselListQuery,
  parseMultiQueryParam,
} from './masterVesselListFilters';

describe('masterVesselListFilters', () => {
  it('parseMultiQueryParam supports comma and repeated values', () => {
    expect(parseMultiQueryParam('A,B')).toEqual(['A', 'B']);
    expect(parseMultiQueryParam(['A', 'B,C'])).toEqual(['A', 'B', 'C']);
  });

  it('buildMasterVesselListWhere adds owner and type filters', () => {
    const { where, params } = buildMasterVesselListWhere({
      owners: ['Owner A'],
      vesselTypes: ['BARGE', 'TANKER'],
    });
    expect(where).toContain('vessel_owner');
    expect(where).toContain('vessel_type');
    expect(params).toHaveLength(2);
  });

  it('buildMasterVesselListWhere handles heating blank OR true', () => {
    const { where } = buildMasterVesselListWhere({ heating: ['blank', 'yes'] });
    expect(where).toContain('heating IS NULL');
    expect(where).toContain('heating = true');
  });

  it('buildMasterVesselListWhere handles terms blank OR V/C', () => {
    const { where, params } = buildMasterVesselListWhere({ terms: ['blank', 'V/C'] });
    expect(where).toContain('terms IS NULL');
    expect(where).toContain('terms = ANY');
    expect(params[0]).toEqual(['V/C']);
  });

  it('parseMasterVesselListQuery maps query object', () => {
    const parsed = parseMasterVesselListQuery({
      search: 'LUMINOR',
      owners: 'A,B',
      heating: 'yes,blank',
    });
    expect(parsed.search).toBe('LUMINOR');
    expect(parsed.owners).toEqual(['A', 'B']);
    expect(parsed.heating).toEqual(['yes', 'blank']);
  });

  it('buildMasterVesselOrderBy defaults to vessel_name asc', () => {
    expect(buildMasterVesselOrderBy()).toContain('vessel_name ASC');
  });

  it('buildMasterVesselOrderBy supports desc on capacity', () => {
    expect(buildMasterVesselOrderBy('vessel_capacity_mt', 'desc')).toContain(
      'vessel_capacity_mt DESC',
    );
  });

  it('parseMasterVesselListQuery maps sort params', () => {
    const parsed = parseMasterVesselListQuery({ sortKey: 'vessel_code', sortDir: 'desc' });
    expect(parsed.sortKey).toBe('vessel_code');
    expect(parsed.sortDir).toBe('desc');
  });
});
