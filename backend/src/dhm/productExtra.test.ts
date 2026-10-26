import { describe, expect, it } from 'vitest';
import { DHM_COMMODITY_TYPES, productDhmExtra } from './productExtra';
import { toDhmCatalogPayload } from './mapper';

// The commodity contract of DHM OpenAPI 1.7 as read from GET /v1/catalog on 2026-10-26.
const COMMODITY_ENTITY = {
  fields: [
    { key: 'code', required: false, systemGenerated: true },
    { key: 'material_code', required: true },
    { key: 'short_name', required: true },
    { key: 'long_name', required: true },
    { key: 'type', required: true },
    { key: 'material_group', required: false },
    { key: 'hs_code', required: false },
    { key: 'uom', required: false },
    { key: 'is_active', required: false },
  ],
};

describe('productDhmExtra', () => {
  it('sends every product field DHM knows, with the product name as short_name', () => {
    expect(
      productDhmExtra({
        product_name: 'CPO',
        short_name: 'ignored',
        long_name: 'Crude Palm Oil',
        commodity_type: 'liquid',
        material_code: ' 100001 ',
        material_group: 'PALM',
        hs_code: '1511.10',
        uom: 'MT',
      }),
    ).toEqual({
      short_name: 'CPO',
      long_name: 'Crude Palm Oil',
      type: 'liquid',
      material_code: '100001',
      material_group: 'PALM',
      hs_code: '1511.10',
      uom: 'MT',
    });
  });

  it('leaves out empty values', () => {
    expect(productDhmExtra({ product_name: 'CPO', long_name: '', commodity_type: null, material_code: '  ' })).toEqual({
      short_name: 'CPO',
    });
  });

  it('keeps the commodity types the live catalog lists', () => {
    expect([...DHM_COMMODITY_TYPES]).toEqual(['liquid', 'solid', 'Fuel, Greases, & Lub', 'Chemical', 'Civil Supplies (Building)']);
  });
});

describe('a product against the live commodity catalog', () => {
  it('is held back, naming the missing fields, while it has no material_code or type', () => {
    const extra = productDhmExtra({ product_name: 'CPO', long_name: 'Crude Palm Oil' });
    const built = toDhmCatalogPayload(COMMODITY_ENTITY, { name: 'CPO', ...extra });
    expect(built.missing).toEqual(['material_code', 'type']);
  });

  it('is complete once the SAP material code and the type are filled in', () => {
    const extra = productDhmExtra({ product_name: 'CPO', long_name: 'Crude Palm Oil', commodity_type: 'liquid', material_code: '100001' });
    const built = toDhmCatalogPayload(COMMODITY_ENTITY, { name: 'CPO', ...extra });
    expect(built.missing).toEqual([]);
    expect(built.payload).toMatchObject({ material_code: '100001', short_name: 'CPO', long_name: 'Crude Palm Oil', type: 'liquid' });
    expect(built.payload).not.toHaveProperty('name');
  });
});
