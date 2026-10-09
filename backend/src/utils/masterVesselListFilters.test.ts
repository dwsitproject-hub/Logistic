import { describe, expect, it } from 'vitest';
import {
  buildMasterVesselListWhere,
  buildMasterVesselOrderBy,
  MASTER_VESSEL_PAIR_CTE,
  MASTER_VESSEL_USED_IDS_CTE,
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

  it('buildMasterVesselOrderBy sorts DHM status by replica link', () => {
    const sql = buildMasterVesselOrderBy('dhm_status', 'desc');
    expect(sql).toContain('dhm_id IS NOT NULL');
    expect(sql).toContain('DESC');
  });

  it('klipTransaction: Yes keeps used vessels, No keeps unused, both or neither is no filter', () => {
    expect(buildMasterVesselListWhere({ klipTransaction: ['yes'] }).where).toContain('AND EXISTS (SELECT 1 FROM used_vessels');
    expect(buildMasterVesselListWhere({ klipTransaction: ['no'] }).where).toContain('AND NOT EXISTS (SELECT 1 FROM used_vessels');
    expect(buildMasterVesselListWhere({ klipTransaction: ['yes', 'no'] }).where).not.toContain('used_vessels');
    expect(buildMasterVesselListWhere({}).where).not.toContain('used_vessels');
    expect(parseMasterVesselListQuery({ klipTransaction: 'yes' }).klipTransaction).toEqual(['yes']);
  });

  it('the used-vessels CTE resolves shipments the way the rest of KLIP does and drops NULL ids', () => {
    expect(MASTER_VESSEL_USED_IDS_CTE).toContain('master_vessel_code_aliases');
    expect(MASTER_VESSEL_USED_IDS_CTE).toContain('normalize_vessel_name');
    expect(MASTER_VESSEL_USED_IDS_CTE).toContain('r.id IS NOT NULL');
    expect(buildMasterVesselOrderBy('klip_transaction', 'desc')).toContain('FROM used_vessels');
  });

  it('the pair CTE picks the pair with the newest SAP usage, falls back to the workbook date, and sorts by the pair columns', () => {
    expect(MASTER_VESSEL_PAIR_CTE).toContain('vessel_pair_sap_names');
    expect(MASTER_VESSEL_PAIR_CTE).toContain("regexp_replace(upper(s.vessel_name), '[^A-Z0-9]', '', 'g')");
    expect(MASTER_VESSEL_PAIR_CTE).toContain('DISTINCT ON (side.vessel_id)');
    expect(MASTER_VESSEL_PAIR_CTE).toContain('COALESCE(pu.last_used, p.last_contract_date) DESC NULLS LAST');
    expect(buildMasterVesselOrderBy('pair_code', 'asc')).toContain('vessel_pair_latest.pair_code ASC');
    expect(buildMasterVesselOrderBy('pair_partner_name', 'asc')).toContain('vessel_pair_latest.pair_partner_name');
  });

  it('parseMasterVesselListQuery maps sort params', () => {
    const parsed = parseMasterVesselListQuery({ sortKey: 'vessel_code', sortDir: 'desc' });
    expect(parsed.sortKey).toBe('vessel_code');
    expect(parsed.sortDir).toBe('desc');
  });
});
