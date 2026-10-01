import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn() }));
vi.mock('../dhm', () => ({ pushMasterSiteToDhm: vi.fn() }));

import { query } from '../database/connection';
import { listMasterSites } from './masterSite.controller';

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
