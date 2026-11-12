import { describe, expect, it } from 'vitest';
import { SYNC_PRODUCT_MATERIALS_SQL } from './productMaterials';
import { PRODUCT_ALIASES, canonicalProductName, sqlCanonicalProductName } from './productAlias';

const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('the SQL form of the product alias', () => {
  it('has an arm for every alias and falls back to the value itself', () => {
    const sql = flat(sqlCanonicalProductName('x.name'));
    for (const [from, to] of Object.entries(PRODUCT_ALIASES)) expect(sql).toContain(`WHEN '${from}' THEN '${to}'`);
    expect(sql.startsWith('COALESCE(CASE UPPER(TRIM(x.name))')).toBe(true);
    expect(sql.endsWith(', x.name)')).toBe(true);
  });

  it('agrees with the TypeScript function on the spellings that matter (POME = WASTE OIL (POME))', () => {
    // evaluate the CASE the way Postgres would: UPPER(TRIM(v)) against the arms, else v itself
    const evalSql = (v: string) => {
      const sql = flat(sqlCanonicalProductName('v'));
      const arms = [...sql.matchAll(/WHEN '([^']*)' THEN '([^']*)'/g)];
      const hit = arms.find((m) => m[1] === v.trim().toUpperCase());
      return hit ? hit[2] : v;
    };
    for (const v of ['POME', 'pome', ' WASTE OIL (POME) ', 'WASTE OIL (POME', 'CPO', 'RPOME', 'INS POME', 'WASTE OIL (PFAD)']) {
      expect(evalSql(v), v).toBe(canonicalProductName(v));
    }
  });
});

describe('recording the SAP materials in product_materials', () => {
  const sql = flat(SYNC_PRODUCT_MATERIALS_SQL);

  it('reads one row per material (newest contract first), trimmed, and ignores contracts without one', () => {
    expect(sql).toContain('SELECT DISTINCT ON (UPPER(TRIM(c.material_code)))');
    expect(sql).toContain("WHERE NULLIF(TRIM(c.material_code), '') IS NOT NULL");
    expect(sql).toContain('ORDER BY UPPER(TRIM(c.material_code)), c.updated_at DESC NULLS LAST');
  });

  it('links the broad Master Product by name through the alias (POME = WASTE OIL (POME)), on both sides', () => {
    expect(sql).toContain(`UPPER(TRIM(${flat(sqlCanonicalProductName('p.product_name'))})) = UPPER(TRIM(${flat(sqlCanonicalProductName('s.product_label'))}))`);
  });

  it('upserts on the unique expression index, so a material is recorded once whatever its spelling', () => {
    expect(sql).toContain('ON CONFLICT (upper(trim(material_code))) DO UPDATE SET');
  });

  it('never changes a link a person set, and fills an empty one only', () => {
    expect(sql).toContain("WHEN product_materials.product_link_source = 'USER' THEN product_materials.product_id");
    expect(sql).toContain('ELSE COALESCE(product_materials.product_id, EXCLUDED.product_id)');
  });

  it('never touches the DHM commodity of the material: that is the DHM sync\'s', () => {
    const update = sql.slice(sql.indexOf('DO UPDATE SET'), sql.indexOf('WHERE product_materials.material_description'));
    expect(update).not.toMatch(/code_dhm|dhm_id|dhm_version|dhm_payload|dhm_is_deleted|dhm_updated_at/);
  });

  it('writes only what changed, so an import that brings nothing new rewrites nothing', () => {
    const where = sql.slice(sql.indexOf('WHERE product_materials.material_description'));
    expect(where).toContain('product_materials.material_description IS DISTINCT FROM');
    expect(where).toContain('product_materials.product_label IS DISTINCT FROM');
    expect(where).toContain("product_materials.product_link_source <> 'USER' AND product_materials.product_id IS NULL AND EXCLUDED.product_id IS NOT NULL");
  });
});
