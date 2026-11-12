import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn() }));
vi.mock('../middleware/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../dhm', () => ({ attachDhmPushState: vi.fn(), productDhmExtra: vi.fn(), pushNamedMasterToDhm: vi.fn() }));

import { query } from '../database/connection';
import { logAudit } from '../middleware/audit';
import { linkProductMaterial, listProductMaterials } from './product.controller';

const MAT = '11111111-1111-1111-1111-111111111111';
const PROD = '22222222-2222-2222-2222-222222222222';

function res() {
  const r: { statusCode: number; body: unknown; status: (n: number) => typeof r; json: (b: unknown) => typeof r } = {
    statusCode: 200,
    body: undefined,
    status(n) { r.statusCode = n; return r; },
    json(b) { r.body = b; return r; },
  };
  return r;
}
const flat = (s: unknown) => String(s).replace(/\s+/g, ' ');
const sqls = () => vi.mocked(query).mock.calls.map((c) => flat(c[0]));

describe('GET /products/materials', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValue({ rows: [{ total: 42, unlinked: 5, no_dhm: 42 }], rowCount: 1 } as never);
  });

  it('lists every material with its product, DHM code and the contracts that carry it, unlinked ones first', async () => {
    const r = res();
    await listProductMaterials({ query: {} } as never, r as never);
    const list = sqls()[0];
    expect(list).toContain('FROM product_materials m LEFT JOIN products p ON p.id = m.product_id');
    expect(list).toContain('m.code_dhm');
    expect(list).toContain('COALESCE(cc.n, 0)::int AS contracts');
    expect(list).toContain('ORDER BY (m.product_id IS NULL) DESC');
    // no filter without a status or a search (the only WHERE is the contracts count's own)
    expect(list).not.toContain('ILIKE');
    expect(list).not.toContain('WHERE m.');
    expect(list).not.toContain('IS NULL ORDER BY');
    const body = r.body as { success: boolean; data: { summary: unknown; products: unknown } };
    expect(body.success).toBe(true);
    expect(body.data.summary).toEqual({ total: 42, unlinked: 5, no_dhm: 42 });
    expect(Array.isArray(body.data.products)).toBe(true);
  });

  it('filters: unlinked = no Master Product yet, no_dhm = no DHM code yet, search spans code, description, product and DHM code', async () => {
    await listProductMaterials({ query: { status: 'unlinked' } } as never, res() as never);
    expect(sqls()[0]).toContain('WHERE m.product_id IS NULL');
    vi.mocked(query).mockClear();
    await listProductMaterials({ query: { status: 'no_dhm' } } as never, res() as never);
    expect(sqls()[0]).toContain("WHERE NULLIF(TRIM(m.code_dhm), '') IS NULL");
    vi.mocked(query).mockClear();
    await listProductMaterials({ query: { search: '8010-10' } } as never, res() as never);
    const withSearch = sqls()[0];
    expect(withSearch).toContain('m.material_code ILIKE $1 OR m.material_description ILIKE $1 OR p.product_name ILIKE $1 OR m.product_label ILIKE $1 OR m.code_dhm ILIKE $1');
    expect(vi.mocked(query).mock.calls[0][1]).toEqual(['%8010-10%']);
  });
});

describe('PUT /products/materials/:id: link a SAP material to a Master Product', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(logAudit).mockClear();
  });

  const body = (product_id: unknown) => ({ params: { id: MAT }, body: { product_id }, user: { id: 'u1', role: 'ADMIN' } });

  it('refuses an id that is not a uuid, and a product id that is not one, before touching the database', async () => {
    const a = res();
    await linkProductMaterial({ ...body(PROD), params: { id: 'nope' } } as never, a as never);
    expect(a.statusCode).toBe(400);
    const b = res();
    await linkProductMaterial(body('not-a-uuid') as never, b as never);
    expect(b.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('404s a product or a material that does not exist', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // the product
    const a = res();
    await linkProductMaterial(body(PROD) as never, a as never);
    expect(a.statusCode).toBe(404);
    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ 1: 1 }], rowCount: 1 } as never).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // product ok, material missing
    const b = res();
    await linkProductMaterial(body(PROD) as never, b as never);
    expect(b.statusCode).toBe(404);
  });

  it('marks the link as a PERSON\'s (USER), so the SAP import never changes it again, and audits it with the before and after', async () => {
    const before = { id: MAT, product_id: null, product_name: null };
    const after = { id: MAT, product_id: PROD, product_name: 'CPO' };
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ 1: 1 }], rowCount: 1 } as never) // product exists
      .mockResolvedValueOnce({ rows: [before], rowCount: 1 } as never) // before
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never) // update
      .mockResolvedValueOnce({ rows: [after], rowCount: 1 } as never); // after
    const r = res();
    await linkProductMaterial(body(PROD) as never, r as never);
    const update = sqls().find((s) => s.startsWith('UPDATE product_materials'))!;
    expect(update).toContain("product_link_source = 'USER'");
    expect(update).toContain('product_id = $2');
    expect(vi.mocked(query).mock.calls.find((c) => flat(c[0]).startsWith('UPDATE product_materials'))![1]).toEqual([MAT, PROD]);
    expect(logAudit).toHaveBeenCalledWith(expect.anything(), 'UPDATE', 'PRODUCT_MATERIAL', MAT, before, after);
    expect((r.body as { data: unknown }).data).toEqual(after);
  });

  it('taking the link off (product_id null) is allowed, and is still a person\'s choice', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ id: MAT }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: MAT, product_id: null }], rowCount: 1 } as never);
    const r = res();
    await linkProductMaterial(body(null) as never, r as never);
    expect(r.statusCode).toBe(200);
    const call = vi.mocked(query).mock.calls.find((c) => flat(c[0]).startsWith('UPDATE product_materials'))!;
    expect(call[1]).toEqual([MAT, null]);
    expect(flat(call[0])).toContain("product_link_source = 'USER'");
  });

  it('a failed audit does not fail the link', async () => {
    vi.mocked(logAudit).mockRejectedValueOnce(new Error('audit down'));
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ 1: 1 }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: MAT }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: MAT }], rowCount: 1 } as never);
    const r = res();
    await linkProductMaterial(body(PROD) as never, r as never);
    expect(r.statusCode).toBe(200);
  });
});
