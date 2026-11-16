import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({
  query: vi.fn(),
}));
vi.mock('../dhm', () => ({ pushMasterPlantToDhm: vi.fn(), attachDhmPushState: vi.fn(async (_kind: string, rows: unknown[]) => rows) }));

import { query } from '../database/connection';
import { getMasterPlantSummary, listMasterPlants } from './masterPlant.controller';

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

describe('listMasterPlants: the DHM status and Company filters', () => {
  const COMPANY = '11111111-2222-4333-8444-555555555555';
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValue({ rows: [{ count: '0' }], rowCount: 1 } as any);
  });

  it('adds nothing for All, and the same status test to the list and to the count otherwise', async () => {
    await call(listMasterPlants, {});
    expect(vi.mocked(query).mock.calls.every((c) => !String(c[0]).includes('dhm_push_state'))).toBe(true);

    vi.mocked(query).mockClear();
    await call(listMasterPlants, { dhm: 'failed' });
    const [list, count] = vi.mocked(query).mock.calls.map((c) => String(c[0]));
    for (const sql of [list, count]) {
      expect(sql).toContain("ps.entity_kind = 'plant'");
      expect(sql).toContain("ps.status IN ('FAILED', 'CONFLICT')");
    }
  });

  it('Synced and Not synced both exclude a plant whose last push failed', async () => {
    for (const dhm of ['synced', 'not_synced']) {
      vi.mocked(query).mockClear();
      await call(listMasterPlants, { dhm });
      expect(String(vi.mocked(query).mock.calls[0]![0])).toContain('NOT EXISTS (SELECT 1 FROM dhm_push_state');
    }
  });

  it('ignores a filter value it does not know instead of putting it in the SQL', async () => {
    await call(listMasterPlants, { dhm: "x'; DROP TABLE master_plants; --" });
    expect(vi.mocked(query).mock.calls.every((c) => !String(c[0]).includes('DROP TABLE'))).toBe(true);
    expect(vi.mocked(query).mock.calls.every((c) => !String(c[0]).includes('dhm_push_state'))).toBe(true);
  });

  it('filters by a company id as a parameter, after the search parameter, and ignores a value that is not an id', async () => {
    await call(listMasterPlants, { search: 'EU22', company: COMPANY });
    const [list, count] = vi.mocked(query).mock.calls;
    expect(String(list[0])).toContain('master_plants.company_id = $2::uuid');
    expect(list[1]).toEqual(['%EU22%', COMPANY, 50, 0]);
    expect(count[1]).toEqual(['%EU22%', COMPANY]);
    expect(String(list[0])).not.toContain(COMPANY);

    vi.mocked(query).mockClear();
    await call(listMasterPlants, { company: 'not-an-id' });
    expect(vi.mocked(query).mock.calls.every((c) => !String(c[0]).includes('master_plants.company_id ='))).toBe(true);
  });
});

describe('getMasterPlantSummary', () => {
  it('answers the four DHM counts, the plants contracts are placed on, and the companies for the filter', async () => {
    vi.mocked(query).mockReset();
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ total: 148, synced: 100, not_synced: 40, failed: 8, used_in_klip: 31 }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'c1', name: 'PT. KPBN', plants: '3' }] } as any);
    const { status, body } = await call(getMasterPlantSummary);
    expect(status).toBe(200);
    expect(body.data).toEqual({
      total: 148,
      synced: 100,
      notSynced: 40,
      failed: 8,
      usedInKlip: 31,
      companies: [{ id: 'c1', name: 'PT. KPBN', plants: 3 }],
    });
    const sql = String(vi.mocked(query).mock.calls[0]![0]);
    expect(sql).toContain('FROM master_plants');
    expect(sql).toContain('EXISTS (SELECT 1 FROM contracts c WHERE c.plant_code = master_plants.plant_code)');
    expect(sql).toContain("ps.entity_kind = 'plant'");
  });

  it('fails with 500 and a message, not a stack, when the database does', async () => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockRejectedValue(new Error('db down'));
    const { status, body } = await call(getMasterPlantSummary);
    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toContain('db down');
  });
});
