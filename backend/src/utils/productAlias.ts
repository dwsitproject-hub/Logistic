/**
 * Product aliases - one spelling per product across every KLIP list, filter and snapshot.
 *
 * SAP's material description for the same product has not been stable: PO 1601000176 came in as
 * `WASTE OIL (POME)` on 2026-10-08 and as `POME` from the next import on, and SAP's own export also
 * cuts the longer one at the bracket (`WASTE OIL (POME`). Left alone, one product lands in two
 * groups: a drilldown that matches the product exactly splits the volume, and a filter option picks up
 * only one spelling. Requested 2026-10-12 as a stop-gap until the DHM integration supplies clean
 * master data.
 *
 * Canonical is `POME`, by the requester's decision: it is the name KLIP's product tabs, Oil Loss
 * options, Dashboard filter and supplier product configuration already use, so every exact match on
 * `POME` that exists today keeps working and the long spelling stops being a special case.
 *
 * Same shape as utils/dischargeDestinationAlias.ts: a many-to-one normalisation, not a display
 * rename. When SAP is cleaned up and settles on one spelling, both still land in one group.
 * Exact matches only (after trim + upper-case): RPOME, INS POME and WASTE OIL (PFAD) are other
 * materials and must not be pulled in.
 *
 * Applied where a product enters KLIP (SAP import parse, contract upsert, manual contract create), so
 * everything downstream reads the canonical value with no per-query cost. The raw SAP row keeps what
 * SAP sent. The frontend mirror is frontend/src/lib/productAlias.ts - keep the two in step.
 */

/** UPPER(TRIM(raw)) -> canonical product. The target maps to itself to stay idempotent. */
export const PRODUCT_ALIASES: Readonly<Record<string, string>> = {
  POME: 'POME',
  'WASTE OIL (POME': 'POME',
  'WASTE OIL (POME)': 'POME',
};

/**
 * Canonical product name. Anything that is not a string, and any string with no alias, comes back
 * exactly as it went in - callers rely on null staying null (`COALESCE($n, product)`).
 */
export function canonicalProductName<T>(value: T): T | string {
  if (typeof value !== 'string') return value;
  return PRODUCT_ALIASES[value.trim().toUpperCase()] ?? value;
}
