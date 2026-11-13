import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../database/connection', () => ({ query: (...args: unknown[]) => queryMock(...args) }));
vi.mock('../dhm', () => ({
  pushNamedMasterToDhm: vi.fn(),
  productDhmExtra: vi.fn(() => ({})),
  attachDhmPushState: vi.fn(async (_kind: string, rows: unknown[]) => rows),
}));

import { buildProductListSql, getProductSummary, listProducts, productSummarySql } from './product.controller';

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

describe('buildProductListSql: the DHM status filter', () => {
  it('adds nothing for All', () => {
    const b = buildProductListSql({ withUsage: 'true' }, 20, 0);
    expect(b.dataSql).not.toContain('dhm_push_state');
    expect(b.countSql).not.toContain('dhm_push_state');
  });

  it('uses the table alias p when the usage join is on, products when it is not (a wrong alias is a Postgres error a mock never shows)', () => {
    const withUsage = buildProductListSql({ withUsage: 'true', dhm: 'failed' }, 20, 0);
    expect(withUsage.dataSql).toContain('ps.entity_id = p.id');
    expect(withUsage.countSql).toContain('ps.entity_id = p.id');
    const plain = buildProductListSql({ dhm: 'failed' }, 20, 0);
    expect(plain.dataSql).toContain('ps.entity_id = products.id');
    // usedInKlip also turns the join (and the alias) on
    expect(buildProductListSql({ usedInKlip: 'true', dhm: 'synced' }, 20, 0).dataSql).toContain('p.dhm_id');
  });

  it("judges a product by dhm_id or code_dhm and by pushes recorded as kind 'product'; Synced and Not synced both leave a failed row out", () => {
    const synced = buildProductListSql({ dhm: 'synced' }, 20, 0).dataSql;
    expect(synced).toContain("ps.entity_kind = 'product'");
    expect(synced).toContain("COALESCE(products.code_dhm::text, '') <> ''");
    expect(synced).toContain('NOT EXISTS (SELECT 1 FROM dhm_push_state');
    expect(buildProductListSql({ dhm: 'not_synced' }, 20, 0).dataSql).toContain('NOT (COALESCE(products.dhm_id');
  });

  it('keeps the search parameter and the paging parameters in order, and puts nothing the client sent inline', () => {
    const b = buildProductListSql({ search: 'cpo', dhm: "x'; DROP TABLE products" }, 20, 40);
    expect(b.dataParams).toEqual(['%cpo%', 20, 40]);
    expect(b.dataSql).toContain('LIMIT $2 OFFSET $3');
    expect(b.countParams).toEqual(['%cpo%']);
    expect(b.dataSql).not.toContain('DROP TABLE');
  });

  it('keeps the existing behaviour: no usage columns without withUsage, and usedInKlip keeps contract-used rows', () => {
    expect(buildProductListSql({}, 20, 0).dataSql).toMatch(/SELECT \* FROM products /);
    const used = buildProductListSql({ usedInKlip: 'true' }, 20, 0);
    expect(used.dataSql).toContain('u.contracts IS NOT NULL');
    expect(used.dataSql).toContain('LEFT JOIN usage u');
  });
});

describe('listProducts', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'a' }] }).mockResolvedValueOnce({ rows: [{ count: 1 }] });
  });
  it('answers items and the total from the built queries', async () => {
    const { status, body } = await call(listProducts, { page: '1', limit: '20', dhm: 'synced', withUsage: 'true' });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ items: [{ id: 'a' }], total: 1, page: 1, limit: 20 });
    expect(String(queryMock.mock.calls[0]![0])).toContain('ps.entity_id = p.id');
  });
});

describe('getProductSummary', () => {
  beforeEach(() => queryMock.mockReset());

  it('counts the DHM states over the catalog and over the used products, and the products contracts use', () => {
    const sql = productSummarySql();
    for (const alias of ['AS total', 'AS used_in_klip', 'AS synced', 'AS not_synced', 'AS failed', 'AS used_synced', 'AS used_not_synced', 'AS used_failed']) expect(sql).toContain(alias);
    // the same match as the Contracts column: upper(trim(material_code)) against what contracts carry
    expect(sql).toContain('SELECT DISTINCT upper(trim(material_code)) AS mc FROM contracts');
    expect(sql).toContain('upper(trim(products.material_code)) IN (SELECT mc FROM used_codes)');
    expect(sql).toMatch(/FROM products$/);
  });

  it('answers the numbers in the page shape', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ total: 3405, used_in_klip: 38, synced: 3400, not_synced: 3, failed: 2, used_synced: 36, used_not_synced: 1, used_failed: 1 }],
    });
    const { status, body } = await call(getProductSummary);
    expect(status).toBe(200);
    expect(body.data).toEqual({ total: 3405, usedInKlip: 38, synced: 3400, notSynced: 3, failed: 2, usedSynced: 36, usedNotSynced: 1, usedFailed: 1 });
  });

  it('fails with 500 and a plain message when the database does', async () => {
    queryMock.mockRejectedValueOnce(new Error('db down'));
    const { status, body } = await call(getProductSummary);
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('db down');
  });
});
