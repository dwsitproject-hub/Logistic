/**
 * What a Master Product row sends to DHM as a `commodity`.
 *
 * DHM's catalog (checked 2026-10-26) asks for material_code (required, unique), short_name (required), long_name
 * (required), type (required, one of DHM_COMMODITY_TYPES) and optionally material_group, hs_code and uom. Empty values
 * are left out; toDhmCatalogPayload then reports the required ones that are missing, so a product without a
 * material_code is not sent and the push is noted as failed ("DHM commodity needs material_code").
 *
 * The product list endpoint, the create/update controller and the bulk Sync button all build the payload here, so the
 * three cannot drift apart again.
 */

/**
 * The values DHM accepts for a commodity `type` today. The Hub's Integrator edits this list, not KLIP, so it is only
 * used to fill the dropdown; the live catalog stays the judge and answers 400 for a value it does not know.
 */
export const DHM_COMMODITY_TYPES = ['liquid', 'solid', 'Fuel, Greases, & Lub', 'Chemical', 'Civil Supplies (Building)'] as const;

function text(value: unknown): string {
  return String(value ?? '').trim();
}

export function productDhmExtra(row: Record<string, unknown>): Record<string, string> {
  const name = text(row.product_name);
  const pairs: Array<[string, string]> = [
    // The product name is the DHM short name (as before); the products.short_name column is not used for the push.
    ['short_name', name],
    ['long_name', text(row.long_name)],
    ['type', text(row.commodity_type)],
    ['material_code', text(row.material_code)],
    ['material_group', text(row.material_group)],
    ['hs_code', text(row.hs_code)],
    ['uom', text(row.uom)],
  ];
  const extra: Record<string, string> = {};
  for (const [key, value] of pairs) if (value) extra[key] = value;
  return extra;
}
