import { describe, expect, it } from 'vitest';
import { masterDhmConditions, masterDhmCountsSelect, masterDhmFilterClause, parseMasterDhmFilter } from './masterDhmFilter';

const SITE = { table: 'master_sites', kind: 'site' };

describe('parseMasterDhmFilter', () => {
  it('knows the four filters and treats anything else as All', () => {
    expect(parseMasterDhmFilter('synced')).toBe('synced');
    expect(parseMasterDhmFilter(' NOT_SYNCED ')).toBe('not_synced');
    expect(parseMasterDhmFilter('failed')).toBe('failed');
    expect(parseMasterDhmFilter('all')).toBe('all');
    expect(parseMasterDhmFilter('x; DROP TABLE')).toBe('all');
    expect(parseMasterDhmFilter(undefined)).toBe('all');
  });
});

describe('masterDhmConditions', () => {
  it('judges FAILED from dhm_push_state (FAILED or CONFLICT) of this kind and row', () => {
    const { failed } = masterDhmConditions(SITE);
    expect(failed).toContain("ps.entity_kind = 'site'");
    expect(failed).toContain('ps.entity_id = master_sites.id');
    expect(failed).toContain("ps.status IN ('FAILED', 'CONFLICT')");
  });
  it('judges linked from the DHM id and code columns', () => {
    const { linked } = masterDhmConditions(SITE);
    expect(linked).toContain("COALESCE(master_sites.dhm_id::text, '') <> ''");
    expect(linked).toContain("COALESCE(master_sites.code_dhm::text, '') <> ''");
  });
  it('accepts other id and code columns', () => {
    const { linked } = masterDhmConditions({ table: 'master_plants', kind: 'plant', idColumn: 'dhm_id', codeColumns: ['code_dhm', 'dhm_code'] });
    expect(linked).toContain('master_plants.dhm_code');
  });
  it('refuses an unsafe table or kind name', () => {
    expect(() => masterDhmConditions({ table: 'x; DROP', kind: 'site' })).toThrow();
    expect(() => masterDhmConditions({ table: 'master_sites', kind: "site' OR '1" })).toThrow();
  });
});

describe('masterDhmFilterClause', () => {
  it('is empty for All', () => {
    expect(masterDhmFilterClause('all', SITE)).toBe('');
  });
  it('keeps the three filters apart: failed wins over linked, so Synced and Not synced never contain a failed row', () => {
    const failed = masterDhmFilterClause('failed', SITE);
    const synced = masterDhmFilterClause('synced', SITE);
    const not = masterDhmFilterClause('not_synced', SITE);
    expect(failed).toMatch(/^EXISTS/);
    expect(synced).toMatch(/^\(NOT EXISTS[\s\S]* AND \(COALESCE/);
    expect(not).toMatch(/^\(NOT EXISTS[\s\S]* AND NOT \(COALESCE/);
  });
});

describe('masterDhmCountsSelect', () => {
  it('counts total, synced, not synced and failed in one pass', () => {
    const sql = masterDhmCountsSelect(SITE);
    for (const alias of ['AS total', 'AS synced', 'AS not_synced', 'AS failed']) expect(sql).toContain(alias);
    expect(sql.match(/COUNT\(\*\)/g)).toHaveLength(4);
  });
});
