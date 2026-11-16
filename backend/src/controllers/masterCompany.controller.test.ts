import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn() }));
vi.mock('../dhm', () => ({ pushMasterCompanyToDhm: vi.fn(), attachDhmPushState: vi.fn(async (_kind: string, rows: unknown[]) => rows) }));

import { query } from '../database/connection';
import { getMasterCompanySummary, listMasterCompanies } from './masterCompany.controller';

function call(handler: (req: any, res: any) => Promise<void>, q: Record<string, string> = {}) {
  let status = 200;
  let body: any;
  const res: any = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  };
  return handler({ query: q } as any, res).then(() => ({ status, body }));
}

const SITE = '11111111-2222-4333-8444-555555555555';

describe('listMasterCompanies: the DHM status and Site filters', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValue({ rows: [{ count: '0' }], rowCount: 1 } as never);
  });

  it('adds nothing for All, and the same status test to the list and to the count otherwise', async () => {
    await call(listMasterCompanies, {});
    expect(vi.mocked(query).mock.calls.every((c) => !String(c[0]).includes('dhm_push_state'))).toBe(true);

    vi.mocked(query).mockClear();
    await call(listMasterCompanies, { dhm: 'failed' });
    const [list, count] = vi.mocked(query).mock.calls.map((c) => String(c[0]));
    for (const sql of [list, count]) {
      expect(sql).toContain("ps.entity_kind = 'company'");
      expect(sql).toContain('ps.entity_id = company.id');
      expect(sql).toContain("ps.status IN ('FAILED', 'CONFLICT')");
    }
  });

  it('Synced and Not synced both exclude a row whose last push failed', async () => {
    for (const dhm of ['synced', 'not_synced']) {
      vi.mocked(query).mockClear();
      await call(listMasterCompanies, { dhm });
      expect(String(vi.mocked(query).mock.calls[0]![0])).toContain('NOT EXISTS (SELECT 1 FROM dhm_push_state');
    }
  });

  it('ignores a status it does not know instead of putting it in the SQL', async () => {
    await call(listMasterCompanies, { dhm: "x'; DROP TABLE master_companies; --" });
    expect(vi.mocked(query).mock.calls.every((c) => !String(c[0]).includes('DROP TABLE'))).toBe(true);
    expect(vi.mocked(query).mock.calls.every((c) => !String(c[0]).includes('dhm_push_state'))).toBe(true);
  });

  it('filters by a Site id as a parameter (never inline) and ignores a value that is not an id', async () => {
    await call(listMasterCompanies, { site: SITE });
    const [list, count] = vi.mocked(query).mock.calls;
    expect(String(list[0])).toContain('site_filter.site_id = $1::uuid');
    expect(list[1]).toContain(SITE);
    expect(count[1]).toContain(SITE);
    expect(String(list[0])).not.toContain(SITE);

    vi.mocked(query).mockClear();
    await call(listMasterCompanies, { site: 'not-an-id' });
    expect(vi.mocked(query).mock.calls.every((c) => !String(c[0]).includes('site_filter'))).toBe(true);
  });

  it('numbers the search, Site and paging parameters without gaps when they are used together', async () => {
    await call(listMasterCompanies, { search: 'pt', site: SITE, page: '2', limit: '20' });
    const [list] = vi.mocked(query).mock.calls;
    const sql = String(list[0]);
    expect(sql).toContain('ILIKE $1');
    expect(sql).toContain('site_filter.site_id = $2::uuid');
    expect(sql).toContain('LIMIT $3 OFFSET $4');
    expect(list[1]).toEqual(['%pt%', SITE, 20, 20]);
  });
});

describe('getMasterCompanySummary', () => {
  it('answers the DHM counts, the companies KLIP uses (those with a plant) and the Sites for the filter', async () => {
    vi.mocked(query).mockReset();
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ total: 11, synced: 6, not_synced: 4, failed: 1, used_in_klip: 9 }] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 's1', site_name: 'JAKARTA', companies: '3' }] } as never);
    const { status, body } = await call(getMasterCompanySummary);
    expect(status).toBe(200);
    expect(body.data).toEqual({
      total: 11,
      synced: 6,
      notSynced: 4,
      failed: 1,
      usedInKlip: 9,
      sites: [{ id: 's1', name: 'JAKARTA', companies: 3 }],
    });
    const sql = String(vi.mocked(query).mock.calls[0]![0]);
    expect(sql).toContain('master_plants p WHERE p.company_id = master_companies.id');
    expect(sql).toContain('FROM master_companies');
  });

  it('fails with 500 and a message, not a stack, when the database does', async () => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockRejectedValue(new Error('db down'));
    const { status, body } = await call(getMasterCompanySummary);
    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toContain('db down');
  });
});
