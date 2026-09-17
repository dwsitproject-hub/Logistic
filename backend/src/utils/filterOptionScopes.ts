/**
 * Which incoterms each page's filter may offer.
 *
 * The options endpoint is shared by Contracts, Contract Performance, Trucking and Shipments, and
 * returned a DISTINCT over the whole `contracts` table - so Trucking listed sea incoterms and
 * Shipments listed land ones, values a user could select and get nothing back.
 *
 * These are DOMAIN sets, chosen by the business, not a reading of the data: operations asked for
 * Trucking to offer FRC and LCO only. Worth recording that the data does not match that exactly -
 * `trucking_operations` currently holds 64 FOB, 11 CIF and 2 CFR rows, and `shipments` holds 3 LCO
 * - so those rows are not reachable through the incoterm filter. That was raised and confirmed as
 * intended; if those rows turn out to be anomalies, this is where the decision lives.
 *
 * Always intersected with what the data actually contains, so an incoterm in the set but absent
 * from the table still does not appear.
 */
export const FILTER_OPTION_SCOPES = {
  trucking: ['FRC', 'LCO'],
  shipment: ['FOB', 'CIF', 'CFR'],
} as const;

export type FilterOptionScope = keyof typeof FILTER_OPTION_SCOPES;

/** Parse the `scope` query param; anything unrecognised means "no restriction". */
export function parseFilterOptionScope(raw: unknown): FilterOptionScope | null {
  const s = String(raw ?? '').trim().toLowerCase();
  return s === 'trucking' || s === 'shipment' ? s : null;
}

/** Incoterms a scope may offer, or null when the caller wants everything. */
export function incotermsForScope(scope: FilterOptionScope | null): readonly string[] | null {
  return scope ? FILTER_OPTION_SCOPES[scope] : null;
}
