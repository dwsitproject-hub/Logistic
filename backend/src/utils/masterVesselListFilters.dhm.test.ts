import { describe, expect, it } from 'vitest';
import { buildMasterVesselListWhere, MASTER_VESSEL_DHM_SOURCE, parseMasterVesselListQuery } from './masterVesselListFilters';

describe('Master Vessel list: the DHM status filter', () => {
  it('reads dhm from the query, and anything it does not know is All', () => {
    expect(parseMasterVesselListQuery({ dhm: 'synced' }).dhm).toBe('synced');
    expect(parseMasterVesselListQuery({ dhm: 'not_synced' }).dhm).toBe('not_synced');
    expect(parseMasterVesselListQuery({ dhm: 'failed' }).dhm).toBe('failed');
    expect(parseMasterVesselListQuery({ dhm: "x'; DROP TABLE master_vessels" }).dhm).toBe('all');
    expect(parseMasterVesselListQuery({}).dhm).toBe('all');
  });

  it('adds nothing for All', () => {
    expect(buildMasterVesselListWhere({}).where).not.toContain('dhm_push_state');
    expect(buildMasterVesselListWhere({ dhm: 'all' }).where).not.toContain('dhm_push_state');
  });

  it("judges a vessel by dhm_id and dhm_code (it has no code_dhm) and by the pushes recorded as kind 'vessel'", () => {
    expect(MASTER_VESSEL_DHM_SOURCE).toMatchObject({ table: 'master_vessels', kind: 'vessel', idColumn: 'dhm_id', codeColumns: ['dhm_code'] });
    const { where, params } = buildMasterVesselListWhere({ dhm: 'failed' });
    expect(where).toContain("ps.entity_kind = 'vessel'");
    expect(where).toContain('ps.entity_id = master_vessels.id');
    expect(params).toEqual([]);
    const synced = buildMasterVesselListWhere({ dhm: 'synced' }).where;
    expect(synced).toContain("COALESCE(master_vessels.dhm_id::text, '') <> ''");
    expect(synced).toContain("COALESCE(master_vessels.dhm_code::text, '') <> ''");
    expect(synced).not.toContain('code_dhm');
  });

  it('keeps the other filters and their parameter numbers intact next to it', () => {
    const { where, params } = buildMasterVesselListWhere({ owners: ['A'], vesselTypes: ['BARGE'], dhm: 'not_synced' });
    expect(params).toHaveLength(2);
    expect(where).toContain('$1');
    expect(where).toContain('$2');
    expect(where).toContain('NOT EXISTS (SELECT 1 FROM dhm_push_state');
  });
});
