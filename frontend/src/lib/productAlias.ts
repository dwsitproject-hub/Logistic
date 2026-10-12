/**
 * Product aliases - mirror of backend/src/utils/productAlias.ts. Keep the two in step.
 *
 * `POME` and `WASTE OIL (POME)` are one product (SAP changed the material description of the same PO
 * between two imports); the canonical name is `POME`. The backend stores the canonical value; this is
 * for the places that still compare a product against a hand-written option or an older cached row,
 * where one spelling would otherwise match only half of the data.
 */
const PRODUCT_ALIASES: Readonly<Record<string, string>> = {
  POME: 'POME',
  'WASTE OIL (POME': 'POME',
  'WASTE OIL (POME)': 'POME',
}

/** Canonical product name; anything without an alias comes back trimmed. */
export function canonicalProductName(value: unknown): string {
  const text = String(value ?? '').trim()
  return PRODUCT_ALIASES[text.toUpperCase()] ?? text
}

/** Same product, whichever spelling either side uses. */
export function sameProduct(a: unknown, b: unknown): boolean {
  return canonicalProductName(a) === canonicalProductName(b)
}
