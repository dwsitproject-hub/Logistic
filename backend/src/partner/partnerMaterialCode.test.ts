import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn(), getClient: vi.fn() }));

import { query } from '../database/connection';
import { PARTNER_LINES_SQL } from './recordSql';
import { PARTNER_RULES_VERSION, partnerSourceSignature } from './refresh';

/**
 * The product a partner (KMAPS) receives carries the DataHub code of the contract's SAP MATERIAL first (product_materials: one DHM commodity per material), the broad product's second.
 * Same rule as the JPS cargo line; the name stays the broad product's.
 */
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('the partner product code follows the material', () => {
  const sql = flat(PARTNER_LINES_SQL);

  it('looks the material up by the contract\'s material_code, only a row that HAS a DHM code counts, a live one first', () => {
    expect(sql).toContain('FROM product_materials m');
    expect(sql).toContain("WHERE NULLIF(TRIM(c.material_code), '') IS NOT NULL");
    expect(sql).toContain('UPPER(TRIM(m.material_code)) = UPPER(TRIM(c.material_code))');
    expect(sql).toContain("NULLIF(TRIM(m.code_dhm), '') IS NOT NULL");
    expect(sql).toContain('ORDER BY COALESCE(m.dhm_is_deleted, FALSE), m.code_dhm');
  });

  it('uses the material\'s code whenever it has one (NULL when that commodity is deleted in DHM), else the product\'s', () => {
    expect(sql).toContain('CASE WHEN pm.has_code THEN pm.code ELSE pc.code END AS product_code');
    expect(sql).toContain("SELECT TRUE AS has_code, CASE WHEN COALESCE(m.dhm_is_deleted, FALSE) THEN NULL ELSE NULLIF(TRIM(m.code_dhm), '') END AS code");
  });

  it('looks the material up before the product, and keeps the broad product\'s name', () => {
    expect(sql.indexOf(') pm ON TRUE')).toBeGreaterThan(-1);
    expect(sql.indexOf(') pm ON TRUE')).toBeLessThan(sql.indexOf(') pc ON TRUE'));
    expect(sql).toContain('pc.name AS product_name');
  });
});

describe('a change of the rule, or of a material, makes the next run rebuild the records', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValue({ rows: [{ n: '1', m: '2026-11-12', d: '2026-11-12' }], rowCount: 1 } as never);
  });

  it('the rules version names the change', () => {
    expect(PARTNER_RULES_VERSION).toBe('2026-11-12-material-product-code');
  });

  it('product_materials is one of the tables the signature reads, so a DHM code arriving rebuilds the records', async () => {
    const signature = await partnerSourceSignature();
    expect(signature).toContain('product_materials=');
    expect(signature).toContain(`rules=${PARTNER_RULES_VERSION}`);
    const sqls = vi.mocked(query).mock.calls.map((c) => flat(String(c[0])));
    expect(sqls.some((s) => s.includes('FROM product_materials'))).toBe(true);
  });
});
