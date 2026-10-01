import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({
  query: vi.fn(),
}));
vi.mock('../dhm', () => ({ pushMasterPlantToDhm: vi.fn() }));

import { query } from '../database/connection';
import { listMasterPlants } from './masterPlant.controller';

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
  return listMasterPlants({ query: search ? { search } : {} } as any, res).then(() => ({ status, body }));
}

describe('listMasterPlants', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValue({ rows: [{ count: '0' }], rowCount: 1 } as any);
  });

  // The Edit Shipment modal looks a plant up by code (search=EU22). The search clause reads
  // linked_site.site_name, but the COUNT query had no such join, so every search with text was
  // "missing FROM-clause entry for table linked_site" and the API answered 500.
  it('gives the count query every table the search clause reads', async () => {
    await run('EU22');
    const sqls = vi.mocked(query).mock.calls.map((call) => String(call[0]));
    expect(sqls).toHaveLength(2);
    for (const sql of sqls) {
      expect(sql).toContain('linked_site.site_name ILIKE');
      expect(sql).toContain('LEFT JOIN master_sites AS linked_site ON linked_site.id = master_plants.site_id');
      // the company a plant points at (master_plants.company_id) is searched too, so the count needs that join as well
      expect(sql).toContain('linked_company.company_name ILIKE');
      expect(sql).toContain('LEFT JOIN master_companies AS linked_company ON linked_company.id = master_plants.company_id');
    }
  });

  it('returns the name of the linked company next to the text of the plant itself', async () => {
    await run();
    const list = String(vi.mocked(query).mock.calls[0]![0]);
    expect(list).toContain('master_plants.company_id');
    expect(list).toContain('linked_company.company_name AS linked_company_name');
    expect(list).toContain('linked_company.company_code AS linked_company_code');
  });

  it('passes the same search parameter to both queries', async () => {
    await run('EU22');
    const [list, count] = vi.mocked(query).mock.calls;
    expect(count![1]).toEqual(['%EU22%']);
    expect(list![1]).toEqual(['%EU22%', 50, 0]);
  });

  it('answers 200 with an item list for a search', async () => {
    const { status, body } = await run('EU22');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});
