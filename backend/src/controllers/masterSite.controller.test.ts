import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn() }));
vi.mock('../dhm', () => ({ pushMasterSiteToDhm: vi.fn(), attachDhmPushState: vi.fn(async (_kind: string, rows: unknown[]) => rows) }));

import { query } from '../database/connection';
import { getMasterSiteSummary, listMasterSites } from './masterSite.controller';

function run(search?: string) {
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
  return listMasterSites({ query: search ? { search } : {} } as any, res).then(() => ({ status, body }));
}

describe('listMasterSites: the Company column', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValue({ rows: [{ count: '0' }], rowCount: 1 } as never);
  });

  // After the masters were replaced from the sheet, master_sites.company_name was filled on 7 Sites and empty on
  // the rest, although every Site had its companies in master_company_sites. The column is now the links.
  it('lists every company linked to the Site, and keeps the stored text only as a fallback', async () => {
    await run();
    const sql = String(vi.mocked(query).mock.calls[0]![0]);
    expect(sql).toContain("string_agg(c.company_name, ', ' ORDER BY c.company_name)");
    expect(sql).toContain('FROM master_company_sites l');
    expect(sql).toMatch(/COALESCE\(\s*NULLIF\(\(SELECT string_agg[\s\S]*,\s*''\),\s*company_name\s*\) AS company_name/);
  });

  // The page shows a Site's companies one per row in a dialog; a name with a comma in it must not be cut in two, so the list comes as an array too.
  it('also sends the companies as a list (company_names), linked ones first and the stored text as the only fallback', async () => {
    await run();
    const sql = String(vi.mocked(query).mock.calls[0]![0]);
    expect(sql).toMatch(/NULLIF\(ARRAY\(SELECT c\.company_name[\s\S]*ORDER BY c\.company_name\), '\{\}'::text\[\]\)/);
    expect(sql).toContain('ARRAY[company_name]');
    expect(sql).toContain(') AS company_names');
  });

  it('finds a Site by the name of a company linked to it', async () => {
    await run('Priscolin');
    const [list, count] = vi.mocked(query).mock.calls.map((c) => String(c[0]));
    for (const sql of [list, count]) {
      expect(sql).toContain('search_company.company_name ILIKE $1');
      expect(sql).toContain('search_link.site_id = master_sites.id');
    }
  });

  it('passes the same search parameter to the list and to the count', async () => {
    await run('Priscolin');
    const [list, count] = vi.mocked(query).mock.calls;
    expect(count![1]).toEqual(['%Priscolin%']);
    expect(list![1]).toEqual(['%Priscolin%', 50, 0]);
  });

  it('answers 200', async () => {
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

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

describe('listMasterSites: the DHM status and Company filters', () => {
  const COMPANY = '11111111-2222-4333-8444-555555555555';
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValue({ rows: [{ count: '0' }], rowCount: 1 } as never);
  });

  it('adds nothing for All, and the same status test to the list and to the count otherwise', async () => {
    await call(listMasterSites, {});
    const all = vi.mocked(query).mock.calls.map((c) => String(c[0]));
    expect(all.every((sql) => !sql.includes('dhm_push_state'))).toBe(true);

    vi.mocked(query).mockClear();
    await call(listMasterSites, { dhm: 'failed' });
    const [list, count] = vi.mocked(query).mock.calls.map((c) => String(c[0]));
    for (const sql of [list, count]) expect(sql).toContain("ps.status IN ('FAILED', 'CONFLICT')");
  });

  it('Synced and Not synced both exclude a row whose last push failed', async () => {
    for (const dhm of ['synced', 'not_synced']) {
      vi.mocked(query).mockClear();
      await call(listMasterSites, { dhm });
      expect(String(vi.mocked(query).mock.calls[0]![0])).toContain('NOT EXISTS (SELECT 1 FROM dhm_push_state');
    }
  });

  it('ignores a filter value it does not know instead of putting it in the SQL', async () => {
    await call(listMasterSites, { dhm: "x'; DROP TABLE master_sites; --" });
    expect(vi.mocked(query).mock.calls.every((c) => !String(c[0]).includes('DROP TABLE'))).toBe(true);
    expect(vi.mocked(query).mock.calls.every((c) => !String(c[0]).includes('dhm_push_state'))).toBe(true);
  });

  it('filters by a company id as a parameter (never inline) and ignores a value that is not an id', async () => {
    await call(listMasterSites, { company: COMPANY });
    const [list, count] = vi.mocked(query).mock.calls;
    expect(String(list[0])).toContain('company_filter.company_id = $1::uuid');
    expect(list[1]).toContain(COMPANY);
    expect(count[1]).toContain(COMPANY);
    expect(String(list[0])).not.toContain(COMPANY);

    vi.mocked(query).mockClear();
    await call(listMasterSites, { company: 'not-an-id' });
    expect(vi.mocked(query).mock.calls.every((c) => !String(c[0]).includes('company_filter'))).toBe(true);
  });
});

describe('getMasterSiteSummary', () => {
  it('answers the four DHM counts, the Sites KLIP uses, and the companies for the filter', async () => {
    vi.mocked(query).mockReset();
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ total: 60, synced: 40, not_synced: 15, failed: 5, used_in_klip: 33 }] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'c1', company_name: 'PT. KPBN', sites: '3' }] } as never);
    const { status, body } = await call(getMasterSiteSummary);
    expect(status).toBe(200);
    expect(body.data).toEqual({
      total: 60,
      synced: 40,
      notSynced: 15,
      failed: 5,
      usedInKlip: 33,
      companies: [{ id: 'c1', name: 'PT. KPBN', sites: 3 }],
    });
    const sql = String(vi.mocked(query).mock.calls[0]![0]);
    expect(sql).toContain('master_plants p WHERE p.site_id = master_sites.id');
    expect(sql).toContain('master_loading_ports lp WHERE lp.site_id = master_sites.id');
  });

  it('fails with 500 and a message, not a stack, when the database does', async () => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockRejectedValue(new Error('db down'));
    const { status, body } = await call(getMasterSiteSummary);
    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toContain('db down');
  });
});
