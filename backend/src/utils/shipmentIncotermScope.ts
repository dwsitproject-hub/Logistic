/**
 * Shipments page Unplanned / sea-logistics scope — Incoterm CIF / FOB / CFR.
 * Pair with truckingIncotermScope (FRC / LCO) for land trucking.
 */

import { contractEffectiveIncotermExpr } from './truckingIncotermScope';

export const SHIPMENT_PAGE_SEA_INCOTERMS = ['CIF', 'FOB', 'CFR'] as const;

export type ShipmentPageSeaIncoterm = (typeof SHIPMENT_PAGE_SEA_INCOTERMS)[number];

export function normalizeShipmentSeaIncoterm(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

export function isShipmentPageSeaIncoterm(value: string | null | undefined): boolean {
  const inc = normalizeShipmentSeaIncoterm(value);
  return (SHIPMENT_PAGE_SEA_INCOTERMS as readonly string[]).includes(inc);
}

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
