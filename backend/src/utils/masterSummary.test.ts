import { describe, expect, it } from 'vitest';
import { masterSummarySql, toMasterSummaryCounts } from './masterSummary';

const SITE = { table: 'master_sites', kind: 'site' };

describe('masterSummarySql', () => {
  it('counts the four DHM numbers and the rows KLIP uses over the whole table', () => {
    const sql = masterSummarySql(SITE, 'EXISTS (SELECT 1 FROM master_plants p WHERE p.site_id = master_sites.id)');
    for (const alias of ['AS total', 'AS synced', 'AS not_synced', 'AS failed', 'AS used_in_klip']) expect(sql).toContain(alias);
    expect(sql).toContain('COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM master_plants p');
    expect(sql).toMatch(/FROM master_sites$/);
    expect(sql).not.toContain('WHERE 1=1');
  });
  it('is 0 for a master that nothing "uses"', () => {
    expect(masterSummarySql(SITE, null)).toContain('0::int AS used_in_klip');
  });
});

describe('toMasterSummaryCounts', () => {
  it('maps the SQL row to the page shape, with zeros for what is missing', () => {
    expect(toMasterSummaryCounts({ total: 5, synced: 3, not_synced: 1, failed: 1, used_in_klip: 4 })).toEqual({ total: 5, synced: 3, notSynced: 1, failed: 1, usedInKlip: 4 });
    expect(toMasterSummaryCounts(undefined)).toEqual({ total: 0, synced: 0, notSynced: 0, failed: 0, usedInKlip: 0 });
  });
});
