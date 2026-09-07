import { describe, expect, it } from 'vitest';
import { KLIP_QTY_STORAGE_UOM, normalizeSapQtyToKg } from './sapQtyUom';

/**
 * contracts.unit used to be a hardcoded 'MT' while quantity_ordered is normalised to kg, so a
 * SAP row in MT was stored 1000x larger than its label claimed. The label must follow the
 * normaliser, which is what this constant is for.
 */
describe('KLIP_QTY_STORAGE_UOM', () => {
  it('names the unit normalizeSapQtyToKg actually produces', () => {
    expect(KLIP_QTY_STORAGE_UOM).toBe('KG');
    expect(normalizeSapQtyToKg(1000, 'MT')).toBe(1_000_000);
    expect(normalizeSapQtyToKg(1_000_000, 'KG')).toBe(1_000_000);
  });

  it('is what the SAP contract upsert writes, on both write paths', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.promises.readFile('src/services/sapDataDistribution.service.ts', 'utf8'),
    );
    /** No bare 'MT' literal may sit in the contracts INSERT column values again. */
    expect(src).not.toContain("$10::numeric, 'MT'");
    expect(src).toContain("'${KLIP_QTY_STORAGE_UOM}'");
    expect(src).toContain('unit = EXCLUDED.unit');
  });
});
