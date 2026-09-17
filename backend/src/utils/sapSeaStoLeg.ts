/**
 * SAP sea-leg STO detection — FOB mixed POs with Type T (truck) + Type V (vessel).
 * CIF/CFR: incoterm alone scopes Shipments (STO Type T is not trucking).
 * Used by SAP import routing and shipment backlog import-status scoping.
 */

import { isSeaSapRowEligibleForShipmentCreation } from './seaShipmentEligibility';
import { SHIPMENT_PAGE_SEA_INCOTERMS } from './shipmentIncotermScope';

function str(v: unknown): string {
  return String(v ?? '').trim();
}

function normalizeIncoterm(value: unknown): string {
  return str(value).toUpperCase();
}

/** CIF/CFR — Shipments page uses incoterm only (no STO Type / Sea-Land gate). */
export function isShipmentPageGrPoIncoterm(incoterm: unknown): boolean {
  const inc = normalizeIncoterm(incoterm);
  return inc === 'CIF' || inc === 'CFR';
}

/** FOB — only GR-STO incoterm on Shipments page (LCO is Trucking-only). */
export function isShipmentPageFobIncoterm(incoterm: unknown): boolean {
  return normalizeIncoterm(incoterm) === 'FOB';
}

function hasMeaningfulVessel(v: unknown): boolean {
  const s = str(v);
  if (!s) return false;
  const lower = s.toLowerCase();
  if (lower === 'null' || lower === 'n/a' || lower === '-' || lower === '—') return false;
  if (/^\s*0+(\.0+)?\s*$/.test(s)) return false;
  return true;
}

/** Normalized STO Type from parsed SAP row (T / V / blank). */
export function resolveSapStoTypeFromParsedData(parsedData: unknown): string {
  const p = parsedData as {
    raw?: Record<string, unknown>;
    contract?: { sto_type?: unknown };
    shipment?: { sto_type?: unknown };
  } | null;
  if (!p || typeof p !== 'object') return '';
  const raw = p.raw ?? {};
  return str(
    raw['STO Type'] ??
      raw['STO Type '] ??
      p.contract?.sto_type ??
      p.shipment?.sto_type ??
      '',
  ).toUpperCase();
}

/**
 * True when SAP row is a sea shipment leg (Type V, or unknown type with vessel name).
 * Type T rows are trucking legs and must not drive Shipments visibility/import status.
 */
export function isSapSeaStoLeg(parsedData: unknown): boolean {
  const p = parsedData as {
    raw?: Record<string, unknown>;
    shipment?: Record<string, unknown>;
  } | null;
  if (!p || typeof p !== 'object') return false;

  const stoType = resolveSapStoTypeFromParsedData(p);
  if (stoType === 'V') return true;
  if (stoType === 'T') return false;

  const raw = p.raw ?? {};
  const shipment = p.shipment ?? {};
  return (
    hasMeaningfulVessel(shipment.vessel_name) ||
    hasMeaningfulVessel(raw['Vessel Name']) ||
    hasMeaningfulVessel(raw.Vessel) ||
    hasMeaningfulVessel(shipment.vessel_code) ||
    hasMeaningfulVessel(raw['Vessel Code'])
  );
}

/**
 * Incoterm-tier sea leg for Shipments / SAP import.
 * - CIF/CFR: true when caller already validated incoterm (no STO Type filter).
 * - FOB: Type V / vessel fallback via isSapSeaStoLeg.
 */
export function isSapSeaStoLegForIncoterm(parsedData: unknown, incoterm: unknown): boolean {
  const inc = normalizeIncoterm(incoterm);
  if (isShipmentPageGrPoIncoterm(inc)) return true;
  if (isShipmentPageFobIncoterm(inc)) return isSapSeaStoLeg(parsedData);
  if ((SHIPMENT_PAGE_SEA_INCOTERMS as readonly string[]).includes(inc)) {
    return isSapSeaStoLeg(parsedData);
  }
  return false;
}

/** True when SAP row should materialize a Shipments execution row (STO No required). */
export function isSapShipmentMaterializeRow(parsedData: unknown, incoterm: unknown): boolean {
  if (!isSeaSapRowEligibleForShipmentCreation(parsedData)) return false;
  return isSapSeaStoLegForIncoterm(parsedData, incoterm);
}
