/**
 * Shipments page Unplanned / sea-logistics scope — Incoterm CIF / FOB / CFR.
 * Pair with truckingIncotermScope (FRC / LCO) for land trucking.
 */

import { normalizeIncoterm } from './incotermAlias';
import { contractEffectiveIncotermExpr } from './truckingIncotermScope';

export const SHIPMENT_PAGE_SEA_INCOTERMS = ['CIF', 'FOB', 'CFR'] as const;

export type ShipmentPageSeaIncoterm = (typeof SHIPMENT_PAGE_SEA_INCOTERMS)[number];

/** Trimmed, upper-cased and de-aliased (CNF -> CFR), matching contractEffectiveIncotermExpr. */
export function normalizeShipmentSeaIncoterm(value: string | null | undefined): string {
  return normalizeIncoterm(value);
}

export function isShipmentPageSeaIncoterm(value: string | null | undefined): boolean {
  const inc = normalizeShipmentSeaIncoterm(value);
  return (SHIPMENT_PAGE_SEA_INCOTERMS as readonly string[]).includes(inc);
}

/** What the Add New Shipment modal says about a PO that belongs to another module (land trucking: FRC / LCO). */
export const SHIPMENT_OUT_OF_SCOPE_MESSAGE =
  'PO ini bukan lingkup Shipment (Incoterm CIF / FOB / CFR). PO FRC / LCO diatur di halaman Trucking.';

/** Contract-level scope using effective incoterm (contract + latest SAP fallback). */
export function buildShipmentPageSeaIncotermScopeSql(contractAlias = 'c'): string {
  const list = SHIPMENT_PAGE_SEA_INCOTERMS.map((c) => `'${c}'`).join(', ');
  return `${contractEffectiveIncotermExpr(contractAlias)} IN (${list})`;
}

/** Outer/list-row scope when `incoterm` is already selected (e.g. MAX(c.incoterm) AS incoterm). */
export function buildShipmentPageSeaIncotermColumnSql(incotermExpr: string): string {
  const list = SHIPMENT_PAGE_SEA_INCOTERMS.map((c) => `'${c}'`).join(', ');
  return `UPPER(TRIM(COALESCE(${incotermExpr}, ''))) IN (${list})`;
}
