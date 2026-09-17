/** Shared SAP JSON paths for vessel identity (shipments list + distribution). */

import { resolveCanonicalVesselDisplayName } from './vesselNameNormalize';

export function sqlSapVesselNameFromSpdJsonb(dataExpr: string): string {
  return `NULLIF(TRIM(COALESCE(
    ${dataExpr}->'shipment'->>'vessel_name',
    ${dataExpr}->'vessel'->>'vessel_name',
    ${dataExpr}->'raw'->>'Vessel Name',
    ${dataExpr}->'raw'->>'Vessel',
    ${dataExpr}->'raw'->>'vessel name'
  )), '')`;
}

export const SAP_VESSEL_NAME_FROM_SK_SQL = sqlSapVesselNameFromSpdJsonb('sk.data');

export const SAP_VESSEL_CODE_FROM_SK_SQL = `NULLIF(TRIM(COALESCE(
  sk.data->'shipment'->>'vessel_code',
  sk.data->'vessel'->>'vessel_code',
  sk.data->'raw'->>'Vessel Code',
  sk.data->'raw'->>'vessel code'
)), '')`;

export const SAP_VESSEL_OWNER_FROM_SK_SQL = `NULLIF(TRIM(COALESCE(
  sk.data->'shipment'->>'vessel_owner',
  sk.data->'vessel'->>'vessel_owner',
  sk.data->'raw'->>'Vessel Owner',
  sk.data->'raw'->>'Vessel Company',
  sk.data->'raw'->>'vessel owner'
)), '')`;

function pickSapText(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).replace(/\r/g, '').trim();
    if (!text || text === '0.00') continue;
    return text;
  }
  return null;
}

export type SapVesselIdentity = {
  vessel_code: string | null;
  vessel_name: string | null;
  vessel_owner: string | null;
};

/** Resolve vessel code/name/owner from normalized SAP payload objects. */
export function resolveSapVesselIdentity(
  shipment: Record<string, unknown> | null | undefined,
  vessel: Record<string, unknown> | null | undefined,
  raw: Record<string, unknown> | null | undefined,
): SapVesselIdentity {
  const ship = shipment ?? {};
  const ves = vessel ?? {};
  const rawRow = raw ?? {};

  return {
    vessel_code: pickSapText(
      ship.vessel_code,
      ves.vessel_code,
      rawRow['Vessel Code'],
      rawRow['vessel code'],
    ),
    vessel_name: pickSapText(
      ship.vessel_name,
      ship.vessel,
      ves.vessel_name,
      ves.name,
      rawRow['Vessel Name'],
      rawRow.Vessel,
      rawRow['vessel name'],
    ),
    vessel_owner: pickSapText(
      ship.vessel_owner,
      ves.vessel_owner,
      rawRow['Vessel Owner'],
      rawRow['Vessel Company'],
      rawRow['vessel owner'],
    ),
  };
}

export function canonicalVesselName(value: unknown): string | null {
  const raw = pickSapText(value);
  return raw ? resolveCanonicalVesselDisplayName(raw) : null;
}

/** True when KLIP stored a vessel name that differs from SAP (user override). */
export function hasKlipVesselNameOverride(
  vesselNameKlip: unknown,
  vesselNameSap: unknown,
): boolean {
  const klip = canonicalVesselName(vesselNameKlip);
  if (!klip) return false;
  const sap = canonicalVesselName(vesselNameSap);
  if (!sap) return true;
  return klip !== sap;
}

/** pg boolean / 't'/'f' / import-status strings — avoid Boolean('false') === true. */
export function parseContractSapClosedFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  const s = String(value).trim().toLowerCase();
  if (!s || s === 'false' || s === 'f' || s === '0' || s === 'no' || s === 'open') return false;
  return s === 'true' || s === 't' || s === '1' || s === 'yes' || s === 'close' || s === 'closed';
}

/**
 * Latest non-blank value in a grouped STO (user edit wins).
 * Lexicographic MAX() kept the old SAP name when sibling POs still had it.
 */
export function sqlLatestNonBlankAgg(expr: string, updatedAtExpr = 's.updated_at'): string {
  return `(ARRAY_AGG(${expr} ORDER BY ${updatedAtExpr} DESC NULLS LAST) FILTER (WHERE NULLIF(TRIM((${expr})::text), '') IS NOT NULL))[1]`;
}

export interface ShipmentDisplayVesselNameOptions {
  /**
   * GR Close (PO vs STO per incoterm). Closed → Master/SAP first.
   * Open → non-empty KLIP input wins, then Master/SAP.
   */
  contractSapClosed?: boolean;
}

/**
 * List / card vessel name.
 * Open + KLIP filled → KLIP. Empty KLIP or GR Close → Master, then SAP, then KLIP.
 */
export function resolveShipmentDisplayVesselName(
  vesselNameMaster: unknown,
  vesselNameSap: unknown,
  vesselNameKlip: unknown,
  options?: ShipmentDisplayVesselNameOptions,
): string | null {
  const master = canonicalVesselName(vesselNameMaster);
  const sap = canonicalVesselName(vesselNameSap);
  const klip = canonicalVesselName(vesselNameKlip);
  // Explicit Open (list overlay): KLIP if filled, else SAP then Master.
  // No options → legacy Master-first (STO preview / shipping perf).
  if (options && options.contractSapClosed !== true) {
    if (klip) return klip;
    return sap ?? master ?? klip;
  }
  return master ?? sap ?? klip;
}

export const sqlShipmentDisplayVesselName = (
  masterExpr: string,
  sapExpr: string,
  klipExpr: string,
): string => `COALESCE(
  NULLIF(TRIM(${masterExpr}), ''),
  NULLIF(TRIM(${sapExpr}), ''),
  NULLIF(TRIM(${klipExpr}), '')
)`;

/**
 * List / pipeline-card display name — matches resolveShipmentDisplayVesselName
 * when contractSapClosed is passed (Open: KLIP, else SAP then Master; Close: Master then SAP).
 */
export const sqlShipmentListDisplayVesselName = (
  masterExpr: string,
  sapExpr: string,
  klipExpr: string,
  closedExpr: string,
): string => `(CASE
  WHEN COALESCE(${closedExpr}, FALSE) IS NOT TRUE
    AND NULLIF(TRIM(${klipExpr}), '') IS NOT NULL
    THEN NULLIF(TRIM(${klipExpr}), '')
  WHEN COALESCE(${closedExpr}, FALSE) IS NOT TRUE
    THEN COALESCE(
      NULLIF(TRIM(${sapExpr}), ''),
      NULLIF(TRIM(${masterExpr}), ''),
      NULLIF(TRIM(${klipExpr}), '')
    )
  ELSE COALESCE(
    NULLIF(TRIM(${masterExpr}), ''),
    NULLIF(TRIM(${sapExpr}), ''),
    NULLIF(TRIM(${klipExpr}), '')
  )
END)`;

export function hasCompleteSapVesselIdentity(identity: SapVesselIdentity): boolean {
  return Boolean(identity.vessel_code && identity.vessel_name);
}
