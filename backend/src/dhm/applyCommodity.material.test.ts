import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn() }));
vi.mock('./versionGuard', async (importActual) => ({
  ...(await importActual<typeof import('./versionGuard')>()),
  shouldApplyDhmRecord: vi.fn().mockResolvedValue(true),
}));
vi.mock('./masterReplica', async (importActual) => ({
  ...(await importActual<typeof import('./masterReplica')>()),
  persistMasterReplica: vi.fn().mockResolvedValue(undefined),
  rememberDhmOrganization: vi.fn().mockResolvedValue(undefined),
}));

import { query } from '../database/connection';
import { persistMasterReplica } from './masterReplica';
import { applyDhmMasterRecord } from './applyMaster';
import type { DhmRecord } from './types';

/**
 * DHM holds one commodity per SAP material (material_code unique, the same short_name allowed): three commodities named CPO with three material codes, each with its own DataHub code.
 * KLIP records each at material level (product_materials) and must not let the later ones take the broad product's single DHM link from the first.
 */
const ID_A = '11111111-1111-1111-1111-111111111111';
const ID_B = '22222222-2222-2222-2222-222222222222';
const commodity = (id: string, code: string, material: string | null, name = 'CPO'): DhmRecord => ({
  id,
  version: 1,
  isDeleted: false,
  data: { code, short_name: name, long_name: `CRUDE PALM OIL ${material ?? ''}`.trim(), type: 'liquid', ...(material ? { material_code: material } : {}) },
  updatedAt: '2026-11-12T00:00:00.000Z',
});

/** Rows the lookups find. `byName` is the product row of that name; `linkedToOther` says its dhm_id belongs to a different commodity. */
function mockDb(opts: { byDhmId?: boolean; byName?: boolean; siblingLinked?: boolean; holder?: boolean } = {}) {
  vi.mocked(query).mockImplementation((async (sql: string) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (s.includes('FROM product_materials WHERE ((')) return { rows: opts.holder ? [{ id: 'other-material' }] : [], rowCount: opts.holder ? 1 : 0 };
    if (s.includes('INSERT INTO product_materials')) return { rows: [], rowCount: 1 };
    if (s.includes('SELECT id FROM products WHERE dhm_id = $1::uuid')) return { rows: opts.byDhmId ? [{ id: 'product-cpo' }] : [], rowCount: opts.byDhmId ? 1 : 0 };
    if (s.includes('SELECT id FROM products WHERE code_dhm = $1')) return { rows: [], rowCount: 0 };
    if (s.includes('SELECT id FROM products WHERE upper(trim(material_code))')) return { rows: [], rowCount: 0 };
    if (s.includes('AND dhm_id IS NOT NULL AND ($2::uuid IS NULL OR dhm_id <> $2::uuid)')) return { rows: opts.siblingLinked ? [{ id: 'product-cpo' }] : [], rowCount: opts.siblingLinked ? 1 : 0 };
    if (s.includes('SELECT id FROM products WHERE upper(trim(product_name)) = upper(trim($1))')) return { rows: opts.byName ? [{ id: 'product-cpo' }] : [], rowCount: opts.byName ? 1 : 0 };
    if (s.startsWith('INSERT INTO products')) return { rows: [{ id: 'product-new' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }) as never);
}
const sqls = () => vi.mocked(query).mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' '));
const materialUpserts = () => vi.mocked(query).mock.calls.filter((c) => String(c[0]).includes('INSERT INTO product_materials'));
const productWrites = () => sqls().filter((s) => s.startsWith('UPDATE products') || s.startsWith('INSERT INTO products'));

describe('applyDhmMasterRecord(commodity): a commodity of a SAP material is recorded at material level', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(persistMasterReplica).mockClear();
  });

  it('stores the commodity under its material code, with its own DataHub code and dhm id', async () => {
    mockDb({ byName: false });
    await applyDhmMasterRecord('commodity', commodity(ID_A, 'CMD-0006', '8010-10.11102'));
    const calls = materialUpserts();
    expect(calls).toHaveLength(1);
    const params = calls[0][1] as unknown[];
    expect(params[0]).toBe('8010-10.11102'); // material_code
    expect(params[3]).toBe('CMD-0006'); // code_dhm
    expect(params[4]).toBe(ID_A); // dhm_id
    expect(params[2]).toBe('CPO'); // product_label: the short_name, to find the broad product
  });

  it('keeps SAP\'s description and any link a person set: the DHM side only adds its own columns', async () => {
    mockDb();
    await applyDhmMasterRecord('commodity', commodity(ID_A, 'CMD-0006', '8010-10.11102'));
    const sql = sqls().find((s) => s.includes('INSERT INTO product_materials'))!;
    expect(sql).toContain('material_description = COALESCE(product_materials.material_description, EXCLUDED.material_description)');
    expect(sql).toContain("WHEN product_materials.product_link_source = 'USER' THEN product_materials.product_id");
    expect(sql).toContain('ON CONFLICT (upper(trim(material_code))) DO UPDATE SET');
  });

  it('records nothing at material level for a commodity without a material code (the old product-level commodity)', async () => {
    mockDb({ byName: true });
    await applyDhmMasterRecord('commodity', commodity(ID_A, 'CMD-0006', null));
    expect(materialUpserts()).toHaveLength(0);
    // and the product is updated as before
    expect(productWrites().some((s) => s.startsWith('UPDATE products'))).toBe(true);
  });
});

describe('applyDhmMasterRecord(commodity): several commodities share one short_name', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(persistMasterReplica).mockClear();
  });

  it('a SIBLING commodity (the name\'s product is linked to another commodity) stays at material level: the product row is not touched', async () => {
    mockDb({ byDhmId: false, byName: true, siblingLinked: true });
    await applyDhmMasterRecord('commodity', commodity(ID_B, 'CMD-0100', '8010-10.11121'));
    expect(materialUpserts()).toHaveLength(1);
    expect(productWrites()).toEqual([]);
    expect(persistMasterReplica).not.toHaveBeenCalled();
  });

  it('the commodity the product IS linked to still updates the product row (matched by its dhm id)', async () => {
    mockDb({ byDhmId: true, byName: true, siblingLinked: true });
    await applyDhmMasterRecord('commodity', commodity(ID_A, 'CMD-0006', '8010-10.11102'));
    expect(materialUpserts()).toHaveLength(1);
    expect(productWrites().some((s) => s.startsWith('UPDATE products'))).toBe(true);
    expect(persistMasterReplica).toHaveBeenCalledTimes(1);
  });

  it('the FIRST commodity of a name, with no product linked yet, links it as before', async () => {
    mockDb({ byDhmId: false, byName: true, siblingLinked: false });
    await applyDhmMasterRecord('commodity', commodity(ID_A, 'CMD-0006', '8010-10.11102'));
    expect(materialUpserts()).toHaveLength(1);
    expect(productWrites().some((s) => s.startsWith('UPDATE products'))).toBe(true);
  });

  it('a commodity whose code another material already holds is not stored at material level and does not fail the record', async () => {
    mockDb({ holder: true, byName: true });
    await expect(applyDhmMasterRecord('commodity', commodity(ID_A, 'CMD-0006', '8010-10.11102'))).resolves.toBe(true);
    expect(materialUpserts()).toHaveLength(0);
  });

  it('a failure while storing the material does not fail the record: the product is still applied', async () => {
    mockDb({ byName: true });
    const base = vi.mocked(query).getMockImplementation()!;
    vi.mocked(query).mockImplementation((async (sql: string, params?: unknown[]) => {
      if (String(sql).includes('INSERT INTO product_materials')) throw new Error('boom');
      return base(sql, params);
    }) as never);
    await expect(applyDhmMasterRecord('commodity', commodity(ID_A, 'CMD-0006', '8010-10.11102'))).resolves.toBe(true);
    expect(productWrites().some((s) => s.startsWith('UPDATE products'))).toBe(true);
  });
});
